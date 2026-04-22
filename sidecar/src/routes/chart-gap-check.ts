/**
 * Chart gap-check endpoint. Invoked by the `runChartGapCheck` Cloud
 * Function with a list of criteria; returns per-criterion
 * `{met, evidence, chartRef?, confidence?}` by asking an LLM to match
 * the criteria against a short patient chart context pulled from
 * Firestore.
 *
 * If ANTHROPIC_API_KEY is not provisioned on the sidecar, returns
 * `met: null` for every criterion with a clear "key not configured"
 * evidence string so the caller can surface the gap instead of failing.
 */
import { getDb } from "../lib/firebase.js";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_CHART_BYTES = 12_000;

const secretClient = new SecretManagerServiceClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    || "/root/.openclaw/credentials/google-sa-key.json",
});

let _anthropicKeyCache: { value: string | null; expiresAt: number } | null = null;

async function getAnthropicKey(): Promise<string | null> {
  const now = Date.now();
  if (_anthropicKeyCache && _anthropicKeyCache.expiresAt > now) return _anthropicKeyCache.value;
  if (process.env.ANTHROPIC_API_KEY) {
    _anthropicKeyCache = { value: process.env.ANTHROPIC_API_KEY, expiresAt: now + 600_000 };
    return _anthropicKeyCache.value;
  }
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) return null;
  try {
    const [ver] = await secretClient.accessSecretVersion({
      name: `projects/${projectId}/secrets/ANTHROPIC_API_KEY/versions/latest`,
    });
    const value = ver.payload?.data?.toString("utf8") ?? null;
    _anthropicKeyCache = { value, expiresAt: now + 600_000 };
    return value;
  } catch {
    _anthropicKeyCache = { value: null, expiresAt: now + 60_000 };
    return null;
  }
}

interface CriterionIn {
  criterionId: string;
  category?: string;
  description: string;
}

interface CriterionOut {
  criterionId: string;
  met: boolean | null;
  evidence: string;
  chartRef?: string;
  confidence?: number;
}

interface GapCheckRequest {
  paId: string;
  patientId: string;
  payerId: string;
  cptCode: string;
  criteria: CriterionIn[];
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function fetchPatientContext(patientId: string): Promise<string> {
  const db = getDb();
  const parts: string[] = [];

  // Basic demographics + meta from users/{id}.
  const userSnap = await db.collection("users").doc(patientId).get();
  if (userSnap.exists) {
    const u = userSnap.data() as any;
    parts.push(
      `PATIENT: ${u.firstName || ""} ${u.lastName || ""} | DOB ${u.dateOfBirth || "unknown"} | gender ${u.gender || "unknown"}`,
    );
    if (Array.isArray(u.allergies) && u.allergies.length) {
      parts.push(`ALLERGIES: ${u.allergies.join(", ")}`);
    }
    if (Array.isArray(u.medicalHistory) && u.medicalHistory.length) {
      parts.push(`HISTORY (self-reported): ${u.medicalHistory.slice(0, 10).join("; ")}`);
    }
  }

  // Latest intake form.
  const formSnap = await db
    .collection("patient-intake-forms")
    .where("patientId", "==", patientId)
    .orderBy("updatedAt", "desc")
    .limit(1)
    .get();
  if (!formSnap.empty) {
    const f = formSnap.docs[0].data() as any;
    if (f.responses) {
      const entries = Object.entries(f.responses as Record<string, unknown>).slice(0, 40);
      parts.push("INTAKE FORM:");
      for (const [k, v] of entries) {
        if (v == null || v === "") continue;
        parts.push(`  ${k}: ${String(v).slice(0, 200)}`);
      }
    }
  }

  // Recent refills — proxy for current meds.
  const refillSnap = await db
    .collection("prescription-refills")
    .where("patientId", "==", patientId)
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  if (!refillSnap.empty) {
    parts.push("RECENT REFILL REQUESTS:");
    refillSnap.docs.forEach((d) => {
      const r = d.data() as any;
      parts.push(`  - ${r.medicationName || "?"} (${r.status || "?"})`);
    });
  }

  // Recent admin-visible messages (last 10, trimmed).
  const msgSnap = await db
    .collection("thread-messages")
    .where("patientId", "==", patientId)
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  if (!msgSnap.empty) {
    parts.push("RECENT MESSAGES:");
    msgSnap.docs.forEach((d) => {
      const m = d.data() as any;
      parts.push(`  [${m.senderRole || "?"}] ${String(m.content || "").slice(0, 180)}`);
    });
  }

  return parts.join("\n").slice(0, MAX_CHART_BYTES);
}

function buildPrompt(req: GapCheckRequest, chart: string): string {
  const criteriaBlock = req.criteria
    .map((c, i) => `${i + 1}. [${c.criterionId}] (${c.category || "general"}) ${c.description}`)
    .join("\n");
  return `You are evaluating whether a patient's chart supports the prior-authorization criteria below.

For each criterion, decide whether the chart evidence supports it:
  - "yes"      → chart clearly documents this
  - "no"       → chart clearly contradicts this or lacks documentation
  - "unknown"  → not enough info in the chart
Never guess past what's documented.

Return a JSON object exactly matching this schema:
{
  "results": [
    {
      "criterionId": "<id>",
      "met": true | false | null,      // true = yes, false = no, null = unknown
      "evidence": "<one sentence summarizing chart text that supports your call, or 'Not documented' if unknown>",
      "chartRef": "<short pointer to where you found it, e.g. 'intake:symptom_duration' — optional>",
      "confidence": 0.0                // 0.0 to 1.0 — how sure are you
    }
  ]
}

PAYER: ${req.payerId}
CPT: ${req.cptCode}

CRITERIA:
${criteriaBlock}

CHART CONTEXT:
${chart || "(no chart data available)"}

Respond with ONLY the JSON object, no prose.`;
}

function fallbackResults(req: GapCheckRequest, reason: string): CriterionOut[] {
  return req.criteria.map((c) => ({
    criterionId: c.criterionId,
    met: null,
    evidence: reason,
    confidence: 0,
  }));
}

async function callAnthropic(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text || "")
    .join("");
  return text.trim();
}

function parseModelOutput(text: string, req: GapCheckRequest): CriterionOut[] {
  // Strip code fences if present.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: { results?: CriterionOut[] };
  try {
    parsed = JSON.parse(cleaned) as { results?: CriterionOut[] };
  } catch {
    return fallbackResults(req, "Model returned non-JSON output — please retry.");
  }
  if (!parsed.results || !Array.isArray(parsed.results)) {
    return fallbackResults(req, "Model response missing `results` array.");
  }
  // Keep only criteria the caller asked about; normalize shape.
  const byId = new Map<string, CriterionOut>();
  for (const r of parsed.results) {
    if (!r || typeof r.criterionId !== "string") continue;
    byId.set(r.criterionId, {
      criterionId: r.criterionId,
      met: r.met === true ? true : r.met === false ? false : null,
      evidence: String(r.evidence || "").slice(0, 500) || "No evidence provided",
      chartRef: r.chartRef ? String(r.chartRef).slice(0, 160) : undefined,
      confidence: typeof r.confidence === "number"
        ? Math.max(0, Math.min(1, r.confidence))
        : undefined,
    });
  }
  return req.criteria.map(
    (c) =>
      byId.get(c.criterionId) || {
        criterionId: c.criterionId,
        met: null,
        evidence: "Criterion omitted from model response.",
        confidence: 0,
      },
  );
}

/**
 * Main entry. Expects the exact shape the runChartGapCheck CF POSTs.
 */
export async function runChartGapCheck(request: Request): Promise<Response> {
  const body = (await request.clone().json().catch(() => null)) as GapCheckRequest | null;
  if (!body?.paId || !body?.patientId || !Array.isArray(body?.criteria)) {
    return json({ error: "paId + patientId + criteria[] required" }, 400);
  }
  if (body.criteria.length === 0) {
    return json({ results: [] });
  }

  const apiKey = await getAnthropicKey();
  if (!apiKey) {
    return json({
      results: fallbackResults(
        body,
        "Auto-gap-check unavailable — add ANTHROPIC_API_KEY secret on the sidecar host. Coordinator can fill criteria manually.",
      ),
    });
  }

  let chart: string;
  try {
    chart = await fetchPatientContext(body.patientId);
  } catch (err: any) {
    return json({
      results: fallbackResults(body, `Chart fetch failed: ${err?.message || err}`),
    });
  }

  const prompt = buildPrompt(body, chart);
  let text: string;
  try {
    text = await callAnthropic(apiKey, prompt);
  } catch (err: any) {
    return json({
      results: fallbackResults(body, `Model call failed: ${err?.message || err}`),
    });
  }

  return json({ results: parseModelOutput(text, body) });
}
