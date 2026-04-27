/**
 * retryFailedFaxes — scheduled function, every 5 minutes.
 *
 * Finds inbound-faxes rows with status=failed (or stuck pending) where
 * nextRetryAt <= now and attempts < MAX_ATTEMPTS, and re-triggers Aurelia.
 * Uses exponential backoff: 5m → 15m → 1h → 4h → 24h.
 * After MAX_ATTEMPTS, status stays failed and a notification is written.
 */

import {onSchedule} from "firebase-functions/v2/scheduler";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import {SIDECAR_URL_SECRET, SIDECAR_API_KEY_SECRET, sidecarUrlEnv, sidecarApiKeyEnv, isSidecarConfigured} from "./lib/sidecar.js";

const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [5, 15, 60, 4 * 60, 24 * 60];

let _db: admin.firestore.Firestore;
function db() {
  if (!_db) _db = admin.firestore();
  return _db;
}

async function triggerAurelia(faxSid: string): Promise<boolean> {
  // Scheduled retry — soft skip when unconfigured rather than crash the cron.
  if (!isSidecarConfigured()) {
    logger.warn("[fax-retry] sidecar not configured, cannot trigger", {faxSid});
    return false;
  }
  try {
    const res = await fetch(`${sidecarUrlEnv()}/fax/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sidecarApiKeyEnv()}`,
        "X-User-Uid": "system",
        "X-User-Role": "admin",
        "X-User-Name": "Retry Cron",
      },
      body: JSON.stringify({faxSid}),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (err: any) {
    logger.warn("[fax-retry] Trigger failed", {faxSid, message: err.message});
    return false;
  }
}

export const retryFailedFaxes = onSchedule({
  schedule: "every 5 minutes",
  timeZone: "America/Los_Angeles",
  secrets: [SIDECAR_URL_SECRET, SIDECAR_API_KEY_SECRET],
}, async () => {
  const now = admin.firestore.Timestamp.now();
  const snap = await db().collection("inbound-faxes")
    .where("status", "==", "failed")
    .where("nextRetryAt", "<=", now)
    .limit(20)
    .get();

  logger.info("[fax-retry] Sweep", {found: snap.size});

  for (const doc of snap.docs) {
    const data = doc.data();
    const attempts = (data.attempts as number) || 0;

    if (attempts >= MAX_ATTEMPTS) {
      logger.warn("[fax-retry] Max attempts reached, skipping", {
        faxSid: doc.id, attempts,
      });
      continue;
    }

    const nextAttempts = attempts + 1;
    const backoffIdx = Math.min(nextAttempts, BACKOFF_MINUTES.length - 1);
    const nextRetryAt = new Date(Date.now() + BACKOFF_MINUTES[backoffIdx] * 60 * 1000);

    const triggered = await triggerAurelia(doc.id);
    await doc.ref.update({
      status: triggered ? "processing" : "failed",
      attempts: nextAttempts,
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      nextRetryAt: triggered ? null : nextRetryAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("[fax-retry] Retry attempted", {
      faxSid: doc.id, attempts: nextAttempts, triggered,
    });

    // Final failure alert
    if (!triggered && nextAttempts >= MAX_ATTEMPTS) {
      await db().collection("notifications").add({
        recipientRole: "admin",
        type: "fax_failed_final",
        title: "Fax processing failed (final)",
        message: `Fax ${doc.id} failed after ${MAX_ATTEMPTS} attempts. Manual review needed.`,
        isRead: false,
        readBy: {},
        meta: {faxSid: doc.id},
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => null);
    }
  }
});
