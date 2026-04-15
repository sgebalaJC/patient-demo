/**
 * DrChrono CSV lookup — bulk email lookup for a list of names.
 *
 * Phase 1: admin uploads a JSON/CSV list of names. For each row we do an
 * *exact* first/last name match against DrChrono patients and return the
 * patient email. Ambiguous rows (multiple hits after exact-match filter)
 * are skipped — better to miss than misidentify.
 *
 * Architecture:
 *  - `drchronoLookupStart` (callable, admin) writes the job + rows, returns jobId
 *  - `drchronoLookupKickoff` (onDocumentCreated) runs the worker immediately
 *  - `drchronoLookupContinue` (onSchedule /2 min) resumes jobs that yielded
 *  - Worker holds a transactional run-lock keyed by `lockedAt`; budget is
 *    8 min per run, then it sets `status=paused` and yields.
 *
 *  Row-level idempotency: only rows with status=pending are picked, and
 *  status is flipped atomically before the DrChrono call.
 */

import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

const SIDECAR_URL_SECRET = defineSecret("SIDECAR_URL");
const SIDECAR_API_KEY_SECRET = defineSecret("SIDECAR_API_KEY");

const COLLECTION = "drchrono-lookups";

// Per-run budget: leave ~1 min headroom below the CF 540s timeout.
const RUN_BUDGET_MS = 8 * 60 * 1000;
// Stale-lock threshold for crashed workers.
const LOCK_STALENESS_MS = 15 * 60 * 1000;
// Polite pacing between DrChrono calls; sidecar already handles 429 backoff.
const MIN_CALL_INTERVAL_MS = 600;

// Read at call time — secrets are populated only when the function declares
// them via the `secrets:` option below.
const sidecarUrl = () => process.env.SIDECAR_URL || "";
const sidecarApiKey = () => process.env.SIDECAR_API_KEY || "";

function db() {
  return admin.firestore();
}

async function requireAdmin(auth: {uid: string} | undefined): Promise<string> {
  if (!auth) throw new HttpsError("unauthenticated", "Authentication required");
  const snap = await db().collection("users").doc(auth.uid).get();
  if (!snap.exists || snap.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  return auth.uid;
}

// ─── Name parsing & entity filter ───────────────────────────────────

const ENTITY_RE = /\b(LLC|INC|LTD|LIMITED|CORP|CO|FARM|FARMS|STABLES?|EQUINE|PARTNERS|VENTURES?|HORSES?|ENTERPRISES?|TRUST|HOLDINGS?|GROUP|ASSOCIATES?)\b/i;

interface UploadRow {
  firstName?: string;
  lastName?: string;
  name?: string;
  lfName?: string;
  usefNo?: string;
  isPrivate?: boolean;
  [k: string]: unknown;
}

interface ParsedRow {
  index: number;
  firstName: string;
  lastName: string;
  rawName: string;
  usefNo: string | null;
  isPrivate: boolean;
}

/** Extract first/last name. Prefers `lf_name` ("LAST, FIRST") for accuracy;
 *  falls back to splitting `name` on whitespace (last token = last name). */
function parseName(row: UploadRow): {firstName: string; lastName: string} | null {
  const rawFirst = (row.firstName || "").trim();
  const rawLast = (row.lastName || "").trim();
  if (rawFirst && rawLast) return {firstName: rawFirst, lastName: rawLast};

  const lf = (row.lfName || "").trim();
  if (lf && lf.includes(",")) {
    const [last, first] = lf.split(",", 2).map((s) => s.trim());
    if (last && first) return {firstName: first, lastName: last};
  }

  const name = (row.name || "").trim();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      return {
        firstName: parts.slice(0, -1).join(" "),
        lastName: parts[parts.length - 1],
      };
    }
  }
  return null;
}

function looksLikeEntity(row: UploadRow, parsed: {firstName: string; lastName: string} | null): boolean {
  const name = (row.name || "").toUpperCase();
  const lf = (row.lfName || "").toUpperCase();
  if (name && lf && name === lf) return true;
  if (ENTITY_RE.test(name) || ENTITY_RE.test(lf)) return true;
  if (parsed && (ENTITY_RE.test(parsed.firstName) || ENTITY_RE.test(parsed.lastName))) return true;
  return false;
}

// ─── Callable: start job ────────────────────────────────────────────

export const drchronoLookupStart = onCall({timeoutSeconds: 60}, async (request) => {
  const uid = await requireAdmin(request.auth);

  const rawRows = request.data?.rows as UploadRow[] | undefined;
  const sourceFilename = (request.data?.filename as string || "upload").slice(0, 200);
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new HttpsError("invalid-argument", "rows[] required");
  }
  if (rawRows.length > 10000) {
    throw new HttpsError("invalid-argument", "max 10,000 rows per job");
  }

  // Confirm DrChrono integration is enabled before creating the job.
  const cfgSnap = await db().doc("integrations/drchrono").get();
  const cfg = cfgSnap.data();
  if (!cfgSnap.exists || !cfg?.enabled || cfg.status !== "active") {
    throw new HttpsError("failed-precondition", "DrChrono integration is not connected & enabled");
  }

  // Parse + entity filter. Entities are counted but never written as rows.
  const parsedRows: ParsedRow[] = [];
  let entitySkipped = 0;
  rawRows.forEach((r, i) => {
    const parsed = parseName(r);
    if (!parsed || looksLikeEntity(r, parsed)) {
      entitySkipped += 1;
      return;
    }
    parsedRows.push({
      index: i,
      firstName: parsed.firstName.slice(0, 120),
      lastName: parsed.lastName.slice(0, 120),
      rawName: String(r.name || `${parsed.firstName} ${parsed.lastName}`).slice(0, 240),
      usefNo: r.usefNo ? String(r.usefNo).slice(0, 40) : null,
      isPrivate: Boolean(r.isPrivate),
    });
  });

  if (parsedRows.length === 0) {
    throw new HttpsError("invalid-argument", "No usable person rows after entity filter");
  }

  const jobRef = db().collection(COLLECTION).doc();
  const userDoc = await db().collection("users").doc(uid).get();
  const createdByName = [userDoc.data()?.firstName, userDoc.data()?.lastName]
    .filter(Boolean).join(" ") || uid;

  await jobRef.set({
    createdBy: uid,
    createdByName,
    sourceFilename,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "pending",
    totalRows: parsedRows.length,
    processedRows: 0,
    matchedRows: 0,
    noMatchRows: 0,
    skippedRows: 0,
    noEmailRows: 0,
    errorRows: 0,
    entitySkippedRows: entitySkipped,
    lockedAt: null,
    error: null,
  });

  // Write rows in batches of 400 (Firestore batch limit is 500).
  const rowsCol = jobRef.collection("rows");
  for (let i = 0; i < parsedRows.length; i += 400) {
    const batch = db().batch();
    for (const row of parsedRows.slice(i, i + 400)) {
      const rowRef = rowsCol.doc(String(row.index).padStart(6, "0"));
      batch.set(rowRef, {
        ...row,
        status: "pending",
        email: null,
        drchronoId: null,
        candidatesCount: null,
        errorMessage: null,
        processedAt: null,
      });
    }
    await batch.commit();
  }

  logger.info("[drchrono-lookup] job created", {
    jobId: jobRef.id, totalRows: parsedRows.length, entitySkipped, by: uid,
  });
  return {jobId: jobRef.id, totalRows: parsedRows.length, entitySkipped};
});

// ─── Worker ─────────────────────────────────────────────────────────

interface DrChronoPatient {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  is_active?: boolean;
}

interface PatientsEnvelope {
  count: number;
  next: string | null;
  previous: string | null;
  results: DrChronoPatient[];
}

/** Call the sidecar's DrChrono proxy. The sidecar handles token refresh,
 *  429 backoff, and the enabled-check. */
async function fetchPatientsViaProxy(firstName: string, lastName: string): Promise<DrChronoPatient[]> {
  const url0 = sidecarUrl();
  const key0 = sidecarApiKey();
  if (!url0 || !key0) {
    throw new Error("SIDECAR_URL / SIDECAR_API_KEY not configured");
  }
  const qs = new URLSearchParams({
    first_name: firstName,
    last_name: lastName,
    page_size: "50",
  });
  const url = `${url0}/admin-api/drchrono/patients?${qs}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {Authorization: `Bearer ${key0}`},
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sidecar error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json() as PatientsEnvelope | DrChronoPatient[];
  return Array.isArray(data) ? data : (data.results || []);
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Exact match on both first and last name, case-insensitive, whitespace-normalized. */
function filterExact(candidates: DrChronoPatient[], firstName: string, lastName: string): DrChronoPatient[] {
  const nf = normalize(firstName);
  const nl = normalize(lastName);
  return candidates.filter((p) => {
    const pf = normalize(p.first_name || "");
    const pl = normalize(p.last_name || "");
    return pf === nf && pl === nl;
  });
}

async function acquireLock(jobId: string): Promise<boolean> {
  const ref = db().doc(`${COLLECTION}/${jobId}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const d = snap.data()!;
    if (d.status === "completed" || d.status === "failed") return false;

    const lockedAtMs = d.lockedAt ? (d.lockedAt as admin.firestore.Timestamp).toMillis() : 0;
    const stale = Date.now() - lockedAtMs > LOCK_STALENESS_MS;
    if (d.status === "running" && !stale) return false;

    tx.update(ref, {
      status: "running",
      lockedAt: admin.firestore.FieldValue.serverTimestamp(),
      startedAt: d.startedAt ?? admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });
}

async function processJob(jobId: string): Promise<void> {
  const locked = await acquireLock(jobId);
  if (!locked) {
    logger.info("[drchrono-lookup] skipping — not lockable", {jobId});
    return;
  }
  const jobRef = db().doc(`${COLLECTION}/${jobId}`);
  const rowsCol = jobRef.collection("rows");
  const startedAt = Date.now();
  let processed = 0;

  try {
    while (Date.now() - startedAt < RUN_BUDGET_MS) {
      // Claim up to 25 pending rows at a time.
      const pending = await rowsCol
        .where("status", "==", "pending")
        .orderBy("index")
        .limit(25)
        .get();
      if (pending.empty) break;

      for (const rowDoc of pending.docs) {
        if (Date.now() - startedAt >= RUN_BUDGET_MS) break;

        // Atomic claim — set status to "processing" only if still pending.
        const claimed = await db().runTransaction(async (tx) => {
          const snap = await tx.get(rowDoc.ref);
          if (!snap.exists || snap.data()?.status !== "pending") return false;
          tx.update(rowDoc.ref, {status: "processing"});
          return true;
        });
        if (!claimed) continue;

        const row = rowDoc.data() as ParsedRow;
        const callStart = Date.now();
        try {
          const candidates = await fetchPatientsViaProxy(row.firstName, row.lastName);
          const exact = filterExact(candidates, row.firstName, row.lastName);

          let resultStatus: string;
          let email: string | null = null;
          let drchronoId: number | null = null;
          let errorMessage: string | null = null;

          if (exact.length === 0) {
            resultStatus = "no-match";
          } else if (exact.length > 1) {
            // Per requirement: skip on ambiguity rather than risk wrong email.
            resultStatus = "skipped-multi";
          } else {
            const p = exact[0];
            drchronoId = p.id;
            if (p.email && p.email.trim()) {
              email = p.email.trim();
              resultStatus = "matched";
            } else {
              resultStatus = "no-email";
            }
          }

          await rowDoc.ref.update({
            status: resultStatus,
            email,
            drchronoId,
            candidatesCount: candidates.length,
            exactMatchesCount: exact.length,
            errorMessage,
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          const counterField = {
            "matched": "matchedRows",
            "no-match": "noMatchRows",
            "skipped-multi": "skippedRows",
            "no-email": "noEmailRows",
          }[resultStatus] || "errorRows";

          await jobRef.update({
            processedRows: admin.firestore.FieldValue.increment(1),
            [counterField]: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lockedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          processed += 1;
        } catch (err: any) {
          await rowDoc.ref.update({
            status: "error",
            errorMessage: String(err.message || err).slice(0, 400),
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await jobRef.update({
            processedRows: admin.firestore.FieldValue.increment(1),
            errorRows: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lockedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          processed += 1;
          logger.warn("[drchrono-lookup] row failed", {jobId, err: err.message});
        }

        // Polite pacing — sidecar also has 429 backoff for real bursts.
        const elapsed = Date.now() - callStart;
        if (elapsed < MIN_CALL_INTERVAL_MS) {
          await new Promise((r) => setTimeout(r, MIN_CALL_INTERVAL_MS - elapsed));
        }
      }
    }

    // Decide whether to complete or yield for continuation.
    const remaining = await rowsCol.where("status", "==", "pending").limit(1).get();
    if (remaining.empty) {
      // Check for stuck "processing" rows too (crash recovery).
      const stuck = await rowsCol.where("status", "==", "processing").limit(1).get();
      if (stuck.empty) {
        await jobRef.update({
          status: "completed",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          lockedAt: null,
        });
        logger.info("[drchrono-lookup] job completed", {jobId, processed});
        return;
      }
    }

    // More to do — yield. The /2-min scheduler will pick this job back up.
    await jobRef.update({
      status: "paused",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lockedAt: null,
    });
    logger.info("[drchrono-lookup] job paused for continuation", {jobId, processed});
  } catch (err: any) {
    logger.error("[drchrono-lookup] worker error", {jobId, err: err.message});
    await jobRef.update({
      status: "failed",
      error: String(err.message || err).slice(0, 500),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lockedAt: null,
    });
  }
}

// ─── Triggers ───────────────────────────────────────────────────────

export const drchronoLookupKickoff = onDocumentCreated({
  document: `${COLLECTION}/{jobId}`,
  timeoutSeconds: 540,
  memory: "512MiB",
  secrets: [SIDECAR_URL_SECRET, SIDECAR_API_KEY_SECRET],
}, async (event) => {
  const jobId = event.params.jobId;
  await processJob(jobId);
});

export const drchronoLookupContinue = onSchedule({
  schedule: "every 2 minutes",
  timeoutSeconds: 540,
  memory: "512MiB",
  secrets: [SIDECAR_URL_SECRET, SIDECAR_API_KEY_SECRET],
}, async () => {
  // Find the oldest job waiting for continuation. One at a time keeps the
  // per-minute DrChrono call rate predictable across concurrent jobs.
  const snap = await db().collection(COLLECTION)
    .where("status", "in", ["paused", "running"])
    .orderBy("createdAt", "asc")
    .limit(1)
    .get();
  if (snap.empty) return;
  const job = snap.docs[0];
  await processJob(job.id);
});
