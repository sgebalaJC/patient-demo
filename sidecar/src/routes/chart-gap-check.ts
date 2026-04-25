/**
 * Chart gap-check endpoint. Invoked by the `runChartGapCheck` Cloud
 * Function with a list of criteria; returns per-criterion
 * `{met, evidence, chartRef?, confidence?}` by asking the local
 * OpenClaw agent to match the criteria against a short patient chart
 * context pulled from Firestore.
 *
 * Piggybacks on the existing gateway pipeline (`/webhook/web-chat` at
 * 127.0.0.1:GATEWAY_PORT) — same LLM routing, budget tracking, and
 * auth the chat feature uses. No separate Anthropic key.
 *
 * If the gateway is unreachable or returns an error, returns
 * `met: null` for every criterion with a clear evidence string so the
 * caller surfaces the gap instead of failing.
 */
import { readFileSync } from "fs";
import { CONFIG_PATH, GATEWAY_URL } from "../lib/paths.js";
import { getDb } from "../lib/firebase.js";

const MAX_CHART_BYTES = 12_000;

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

function loadGatewayToken(): string | null {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return config?.gateway?.auth?.token ?? null;
  } catch {
    return null;
  }
}

// Narrow projections of the Firestore documents we read here. Only the
// fields the gap-check actually consumes — anything else is intentionally
// omitted so a schema drift on unused fields doesn't matter, but a rename
// of a field we DO use shows up as a type error instead of a silent
// `undefined` reaching the prompt.
interface PatientUserDoc {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  allergies?: string[];
  medicalHistory?: string[];
}
interface IntakeFormDoc {
  responses?: Record<string, unknown>;
}
interface RefillDoc {
  medicationName?: string;
  status?: string;
}
interface ThreadMessageDoc {
  senderRole?: string;
  content?: string;
}

async function fetchPatientContext(patientId: string): Promise<string> {
  const db = getDb();
  const parts: string[] = [];

  const userSnap = await db.collection("users").doc(patientId).get();
  if (userSnap.exists) {
    const u = (userSnap.data() ?? {}) as PatientUserDoc;
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

  const formSnap = await db
    .collection("patient-intake-forms")
    .where("patientId", "==", patientId)
    .orderBy("updatedAt", "desc")
    .limit(1)
    .get();
  if (!formSnap.empty) {
    const f = (formSnap.docs[0].data() ?? {}) as IntakeFormDoc;
    if (f.responses) {
      const entries = Object.entries(f.responses).slice(0, 40);
      parts.push("INTAKE FORM:");
      for (const [k, v] of entries) {
        if (v == null || v === "") continue;
        parts.push(`  ${k}: ${String(v).slice(0, 200)}`);
      }
    }
  }

  const refillSnap = await db
    .collection("prescription-refills")
    .where("patientId", "==", patientId)
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  if (!refillSnap.empty) {
    parts.push("RECENT REFILL REQUESTS:");
    refillSnap.docs.forEach((d) => {
      const r = (d.data() ?? {}) as RefillDoc;
      parts.push(`  - ${r.medicationName || "?"} (${r.status || "?"})`);
    });
  }

  const msgSnap = await db
    .collection("thread-messages")
    .where("patientId", "==", patientId)
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  if (!msgSnap.empty) {
    parts.push("RECENT MESSAGES:");
    msgSnap.docs.forEach((d) => {
      const m = (d.data() ?? {}) as ThreadMessageDoc;
      parts.push(`  [${m.senderRole || "?"}] ${String(m.content || "").slice(0, 180)}`);
    });
  }

  return parts.join("\n").slice(0, MAX_CHART_BYTES);
}

function buildPrompt(req: GapCheckRequest, chart: string): string {
  const criteriaBlock = req.criteria
    .map((c, i) => `${i + 1}. [${c.criterionId}] (${c.category || "general"}) ${c.description}`)
    .join("\n");
  return `You are evaluating whether a patient's chart supports the prior-authorization criteria below. Do NOT chat — return only the JSON object.

For each criterion, decide based on chart evidence:
  - true     → chart clearly documents this
  - false    → chart clearly contradicts this or lacks documentation
  - null     → not enough info in the chart
Never guess past what's documented.

Return a JSON object exactly matching this schema:
{
  "results": [
    {
      "criterionId": "<id>",
      "met": true | false | null,
      "evidence": "<one sentence summarizing chart text that supports your call, or 'Not documented' if unknown>",
      "chartRef": "<short pointer to where you found it, e.g. 'intake:symptom_duration' — optional>",
      "confidence": 0.0
    }
  ]
}

PAYER: ${req.payerId}
CPT: ${req.cptCode}

CRITERIA:
${criteriaBlock}

CHART CONTEXT:
${chart || "(no chart data available)"}

Respond with ONLY the JSON object. No prose, no code fences.`;
}

function fallbackResults(req: GapCheckRequest, reason: string): CriterionOut[] {
  return req.criteria.map((c) => ({
    criterionId: c.criterionId,
    met: null,
    evidence: reason,
    confidence: 0,
  }));
}

/**
 * POST to the local OpenClaw gateway's web-chat webhook and collect the
 * streamed reply into a single string. Uses a dedicated sessionId per
 * request so the chart-gap-check reasoning doesn't pollute the agent's
 * regular chat history.
 */
async function callGateway(token: string, prompt: string, sessionId: string): Promise<string> {
  const res = await fetch(`${GATEWAY_URL}/webhook/web-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": token,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      sessionId,
      body: prompt,
      timestamp: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gateway ${res.status}: ${detail.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const chunks: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload) as { chunk?: string; done?: boolean };
        if (typeof evt.chunk === "string") chunks.push(evt.chunk);
        if (evt.done) return chunks.join("");
      } catch { /* tolerate malformed events */ }
    }
  }
  return chunks.join("");
}

function parseModelOutput(text: string, req: GapCheckRequest): CriterionOut[] {
  // Agent may add conversational preamble — find the first JSON object.
  const trimmed = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const candidate = firstBrace >= 0 && lastBrace > firstBrace
    ? trimmed.slice(firstBrace, lastBrace + 1)
    : trimmed;

  let parsed: { results?: CriterionOut[] };
  try {
    parsed = JSON.parse(candidate) as { results?: CriterionOut[] };
  } catch {
    return fallbackResults(req, "Agent returned non-JSON output — please retry.");
  }
  if (!parsed.results || !Array.isArray(parsed.results)) {
    return fallbackResults(req, "Agent response missing `results` array.");
  }
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
        evidence: "Criterion omitted from agent response.",
        confidence: 0,
      },
  );
}

/**
 * Main entry. Expects the exact shape the runChartGapCheck CF posts.
 */
export async function runChartGapCheck(request: Request): Promise<Response> {
  const body = (await request.clone().json().catch(() => null)) as GapCheckRequest | null;
  if (!body?.paId || !body?.patientId || !Array.isArray(body?.criteria)) {
    return json({ error: "paId + patientId + criteria[] required" }, 400);
  }
  if (body.criteria.length === 0) {
    return json({ results: [] });
  }

  const token = loadGatewayToken();
  if (!token) {
    return json({
      results: fallbackResults(
        body,
        "Gap check unavailable — OpenClaw gateway not configured on this host. Coordinator can fill criteria manually.",
      ),
    });
  }

  const errMsg = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

  let chart: string;
  try {
    chart = await fetchPatientContext(body.patientId);
  } catch (err) {
    return json({
      results: fallbackResults(body, `Chart fetch failed: ${errMsg(err)}`),
    });
  }

  const prompt = buildPrompt(body, chart);
  const sessionId = `chart-gap-check-${body.paId}-${Date.now()}`;
  let text: string;
  try {
    text = await callGateway(token, prompt, sessionId);
  } catch (err) {
    return json({
      results: fallbackResults(body, `Gateway call failed: ${errMsg(err)}`),
    });
  }

  return json({ results: parseModelOutput(text, body) });
}
