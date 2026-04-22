// Policy fetcher + change detector.
//
// Runs daily: for every target CPT × active payer (adapterStatus:
// 'implemented'), resolves the source URL, fetches raw bytes, sha256-hashes,
// writes a snapshot if hash differs from the last known, and flips the
// payer-policies record status. Extraction is NOT done here (that's a
// separate, human-initiated pass). Fetch failures mark the record `broken`
// with the HTTP status in `brokenReason`.

import {onSchedule} from "firebase-functions/v2/scheduler";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";

const slackAlertsWebhook = defineSecret("SLACK_ALERTS_WEBHOOK_URL");
import {ALL_ADAPTERS, getAdapter} from "./adapters/index.js";
import {saveSnapshot, sha256, htmlToText, extractPdfText} from "./adapters/shared.js";
import {alertSlack, formatBrokenAlert} from "./slack-alerts.js";
import type {PayerAdapter} from "./types.js";

function db() {
  return admin.firestore();
}

type FetchOutcome =
  | {payerId: string; cptCode: string; result: "unchanged" | "new" | "updated"; hash: string}
  | {payerId: string; cptCode: string; result: "broken"; reason: string}
  | {payerId: string; cptCode: string; result: "skipped"; reason: string};

export async function runFetcher(opts: {
  payerIds?: string[];
  cptCodes?: string[];
} = {}): Promise<FetchOutcome[]> {
  const payersSnap = await db().collection("payers").where("active", "==", true).get();
  const cptSnap = await db().collection("target-cpts").where("active", "==", true).get();

  const payers = payersSnap.docs
    .map((d) => d.data() as {id: string; adapterStatus: string})
    .filter((p) => !opts.payerIds || opts.payerIds.includes(p.id));
  const cpts = cptSnap.docs
    .map((d) => (d.data() as {cptCode: string}).cptCode)
    .filter((c) => !opts.cptCodes || opts.cptCodes.includes(c));

  const outcomes: FetchOutcome[] = [];

  for (const payer of payers) {
    const adapter = getAdapter(payer.id);
    if (!adapter) {
      outcomes.push({payerId: payer.id, cptCode: "-", result: "skipped", reason: "no adapter registered"});
      continue;
    }
    if (adapter.meta.status !== "implemented") {
      outcomes.push({
        payerId: payer.id,
        cptCode: "-",
        result: "skipped",
        reason: `adapter status ${adapter.meta.status}`,
      });
      continue;
    }
    for (const cpt of cpts) {
      try {
        const outcome = await processOne(adapter, cpt);
        outcomes.push(outcome);
      } catch (err) {
        logger.error("pa.fetcher:error", {payerId: payer.id, cpt, err: String(err)});
        outcomes.push({payerId: payer.id, cptCode: cpt, result: "broken", reason: String(err)});
        await markBroken(payer.id, cpt, String(err));
      }
    }
  }

  return outcomes;
}

async function processOne(adapter: PayerAdapter, cptCode: string): Promise<FetchOutcome> {
  const payerId = adapter.meta.payerId;
  const resolution = await adapter.resolveUrl(cptCode);
  if (!resolution) {
    return {payerId, cptCode, result: "skipped", reason: "no URL mapping for CPT"};
  }
  const fetched = await adapter.fetch(resolution.url);
  if (fetched.httpStatus !== 200) {
    await markBroken(payerId, cptCode, `HTTP ${fetched.httpStatus} for ${resolution.url}`);
    return {payerId, cptCode, result: "broken", reason: `HTTP ${fetched.httpStatus}`};
  }

  const rawText = await toText(fetched.contentType, fetched.bytes);
  if (!rawText.trim()) {
    await markBroken(payerId, cptCode, "empty extracted text (image-only PDF?)");
    return {payerId, cptCode, result: "broken", reason: "empty extracted text"};
  }

  const newHash = sha256(fetched.bytes);
  const policyId = `${payerId}_${cptCode}`;
  const policyRef = db().collection("payer-policies").doc(policyId);
  const existing = await policyRef.get();
  const existingData = existing.exists ? (existing.data() as {sourceHash?: string; status?: string}) : null;

  if (existingData?.sourceHash === newHash && existingData?.status !== "broken") {
    await policyRef.set(
      {
        sourceFetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
    return {payerId, cptCode, result: "unchanged", hash: newHash};
  }

  const snapshot = await saveSnapshot(payerId, cptCode, fetched.bytes, fetched.contentType);
  const rawTextPreview = rawText.slice(0, 2000);
  const html = fetched.contentType.includes("html") ? fetched.bytes.toString("utf8") : undefined;
  const effectiveDate = adapter.parseEffectiveDate(rawText, html);
  const lastRevised = adapter.parseLastRevisedDate(rawText, html);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const isNew = !existing.exists;

  const SNAPSHOT_TEXT_LIMIT = 800_000;
  const rawTextForSnapshot = rawText.length > SNAPSHOT_TEXT_LIMIT
    ? rawText.slice(0, SNAPSHOT_TEXT_LIMIT) + "\n\n[… truncated; full text in GCS snapshot]"
    : rawText;
  await db().collection("payer-policy-snapshots").doc(`${policyId}_${newHash}`).set(
    {
      payerId,
      cptCode,
      sourceUrl: resolution.url,
      sourceHash: newHash,
      snapshotPath: snapshot.path,
      rawText: rawTextForSnapshot,
      rawTextBytes: rawText.length,
      rawTextTruncated: rawText.length > SNAPSHOT_TEXT_LIMIT,
      fetchedAt: now,
      httpStatus: fetched.httpStatus,
    },
    {merge: true}
  );

  await policyRef.set(
    {
      id: policyId,
      payerId,
      cptCode,
      sourceUrl: resolution.url,
      sourceHash: newHash,
      sourceContentType: fetched.contentType,
      sourceFetchedAt: now,
      sourceEffectiveDate: effectiveDate ? admin.firestore.Timestamp.fromDate(effectiveDate) : null,
      sourceLastRevisedDate: lastRevised ? admin.firestore.Timestamp.fromDate(lastRevised) : null,
      snapshotPath: snapshot.path,
      rawTextPreview,
      status: isNew ? "pending_review" : "pending_review",
      previousVersionId: existingData?.sourceHash
        ? `${policyId}_${existingData.sourceHash}`
        : null,
      brokenReason: admin.firestore.FieldValue.delete(),
      updatedAt: now,
      ...(isNew ? {createdAt: now} : {}),
    },
    {merge: true}
  );

  await pruneSnapshots(payerId, cptCode);

  return {payerId, cptCode, result: isNew ? "new" : "updated", hash: newHash};
}

async function pruneSnapshots(payerId: string, cptCode: string): Promise<void> {
  const q = await db()
    .collection("payer-policy-snapshots")
    .where("payerId", "==", payerId)
    .where("cptCode", "==", cptCode)
    .orderBy("fetchedAt", "desc")
    .get();
  const toDelete = q.docs.slice(5);
  if (!toDelete.length) return;
  const batch = db().batch();
  for (const d of toDelete) batch.delete(d.ref);
  await batch.commit();
}

async function markBroken(payerId: string, cptCode: string, reason: string): Promise<void> {
  const policyId = `${payerId}_${cptCode}`;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const existing = await db().collection("payer-policies").doc(policyId).get();
  const wasBroken = existing.exists && existing.data()?.status === "broken";
  await db().collection("payer-policies").doc(policyId).set(
    {
      id: policyId,
      payerId,
      cptCode,
      status: "broken",
      brokenReason: reason,
      sourceFetchedAt: now,
      updatedAt: now,
      createdAt: now,
    },
    {merge: true}
  );
  if (!wasBroken) {
    await alertSlack(formatBrokenAlert(payerId, cptCode, reason));
  }
}

async function toText(contentType: string, bytes: Buffer): Promise<string> {
  if (contentType.includes("pdf")) {
    return extractPdfText(bytes);
  }
  if (contentType.includes("json")) {
    return bytes.toString("utf8");
  }
  return htmlToText(bytes.toString("utf8"));
}

export const policyFetcherCron = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "America/Los_Angeles",
    region: "us-west1",
    memory: "1GiB",
    timeoutSeconds: 540,
    secrets: [slackAlertsWebhook],
  },
  async () => {
    const outcomes = await runFetcher();
    const summary = summarise(outcomes);
    logger.info("pa.fetcher:complete", summary);
  }
);

export const triggerPolicyRefresh = onCall(
  {region: "us-west1", memory: "1GiB", timeoutSeconds: 540, secrets: [slackAlertsWebhook]},
  async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Sign-in required");
    const {isSuperAdminEmail} = await import("../superAdmins.js");
    if (!isSuperAdminEmail(req.auth.token?.email)) {
      const userDoc = await db().collection("users").doc(req.auth.uid).get();
      if (userDoc.data()?.role !== "admin") {
        throw new HttpsError("permission-denied", "Admin access required");
      }
    }
    const {payerIds, cptCodes} = (req.data ?? {}) as {
      payerIds?: string[];
      cptCodes?: string[];
    };
    const outcomes = await runFetcher({payerIds, cptCodes});
    return {summary: summarise(outcomes), outcomes};
  }
);

function summarise(outcomes: FetchOutcome[]) {
  const byResult: Record<string, number> = {};
  for (const o of outcomes) byResult[o.result] = (byResult[o.result] ?? 0) + 1;
  return {total: outcomes.length, byResult, adapters: ALL_ADAPTERS.length};
}
