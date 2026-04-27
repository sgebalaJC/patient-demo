/**
 * SignalWire Fax Webhook — receives inbound fax notifications from SignalWire,
 * stores the PDF in Cloud Storage, and writes a tracking row to the
 * `inbound-faxes` collection.
 *
 * Flow:
 * 1. SignalWire fires this webhook when a fax completes on the configured number
 * 2. Verify the signature (X-SignalWire-Signature or X-Twilio-Signature header)
 * 3. Download the PDF from SignalWire's MediaUrl using basic auth
 * 4. Store at gs://<bucket>/incoming-faxes/{faxSid}/original.pdf
 * 5. Write inbound-faxes/{faxSid} row with status=pending
 * 6. Best-effort: trigger Aurelia/sidecar to process asynchronously
 * 7. Return 200 so SignalWire doesn't retry
 *
 * Idempotent: if a row already exists for this faxSid, we skip and return 200.
 */

import type {Request, Response} from "express";
import {logger} from "firebase-functions";
import {onRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import {emitAudit} from "./lib/audit.js";
import {
  signalwireProjectId,
  signalwireAuthToken,
  signalwireSigningKey,
  computeSignalwireSignature,
} from "./lib/signalwire-helpers.js";

// Re-export the secrets so existing imports from this module keep working.
export {signalwireProjectId, signalwireAuthToken, signalwireSigningKey};

const SIDECAR_URL = process.env.SIDECAR_URL || "";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

let _db: admin.firestore.Firestore;
function db() {
  if (!_db) _db = admin.firestore();
  return _db;
}

// ---------------------------------------------------------------------------
// Signature verification — algorithm lives in lib/signalwire-helpers.ts.
// This wrapper iterates multiple candidate tokens/URLs because Cloud
// Functions v2 routing can mangle the path seen by the container.
// ---------------------------------------------------------------------------

// Constant-time string compare — HMAC base64 outputs are same length for the
// same algo, so length-mismatch rejection doesn't leak anything meaningful.
export function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifySignalWireSignature(
  signature: string | undefined,
  authTokens: string[],
  candidateUrls: string[],
  params: Record<string, string>,
): { ok: boolean; expected?: string; matchedUrl?: string; matchedTokenIdx?: number } {
  if (!signature) return {ok: false};
  let lastExpected: string | undefined;
  for (let i = 0; i < authTokens.length; i++) {
    const tok = authTokens[i];
    if (!tok) continue;
    for (const url of candidateUrls) {
      const expected = computeSignalwireSignature(tok, url, params);
      lastExpected = expected;
      if (timingSafeStringEqual(expected, signature)) {
        return {ok: true, expected, matchedUrl: url, matchedTokenIdx: i};
      }
    }
  }
  return {ok: false, expected: lastExpected};
}

/**
 * Cloud Functions v2 (Cloud Run under the hood) routes external requests for
 * `https://<region>-<project>.cloudfunctions.net/<funcName>` into the
 * container with `req.url === '/'` — the function name is stripped from the
 * path during routing. SignalWire signs against the URL it actually POSTed
 * to (which DOES include `/<funcName>`), so we have to try both. Local
 * emulator preserves the path.
 */
function buildSigCandidateUrls(req: Request, functionName: string): string[] {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers["host"] as string;
  // Optional host pinning: set SIGNALWIRE_ALLOWED_HOSTS="host1,host2" to
  // reject requests whose Host header isn't on the allowlist. The HMAC
  // already binds URL, so a spoofed host alone can't forge, but this
  // tightens the accepted URL set as belt-and-braces.
  const allowed = (process.env.SIGNALWIRE_ALLOWED_HOSTS || "")
    .split(",").map((h) => h.trim()).filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(host)) {
    logger.warn("[signalwire] Host not in allowlist", {host, allowed});
    return [];
  }
  const incoming = req.originalUrl || req.url || "/";
  const baseUrl = `${proto}://${host}${incoming}`;
  const out = [baseUrl];
  if (incoming === "/" || incoming === "") {
    out.push(`${proto}://${host}/${functionName}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Media download
// ---------------------------------------------------------------------------

async function downloadFaxMedia(
  mediaUrl: string,
  projectId: string,
  authToken: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const basicAuth = Buffer.from(`${projectId}:${authToken}`).toString("base64");
  const res = await fetch(mediaUrl, {
    headers: {Authorization: `Basic ${basicAuth}`},
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MediaUrl fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const contentType = res.headers.get("content-type") || "application/pdf";
  const arrayBuf = await res.arrayBuffer();
  return {buffer: Buffer.from(arrayBuf), contentType};
}

// ---------------------------------------------------------------------------
// Sidecar trigger (best-effort)
// ---------------------------------------------------------------------------

async function triggerAureliaProcessing(faxSid: string): Promise<void> {
  if (!SIDECAR_API_KEY) {
    logger.warn("[fax] SIDECAR_API_KEY not set — skipping Aurelia trigger", {faxSid});
    return;
  }
  try {
    const res = await fetch(`${SIDECAR_URL}/fax/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SIDECAR_API_KEY}`,
        "X-User-Uid": "system",
        "X-User-Role": "admin",
        "X-User-Name": "Fax Pipeline",
      },
      body: JSON.stringify({faxSid}),
      signal: AbortSignal.timeout(5000),
    });
    logger.info("[fax] Aurelia trigger response", {faxSid, status: res.status});
  } catch (err: any) {
    logger.warn("[fax] Aurelia trigger failed (retry cron will pick up)", {
      faxSid,
      message: err.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Webhook handler
// ---------------------------------------------------------------------------

async function handle(req: Request, res: Response): Promise<void> {
  const startMs = Date.now();
  logger.info("[fax] Webhook hit", {
    method: req.method,
    path: req.path,
    contentType: req.headers["content-type"],
    ua: req.headers["user-agent"],
    signature: req.headers["x-signalwire-signature"] ||
      req.headers["x-twilio-signature"] || null,
    bodyKeys: req.body ? Object.keys(req.body).slice(0, 20) : [],
  });

  if (req.method !== "POST") {
    res.status(405).json({error: "Method not allowed"});
    return;
  }

  const body = req.body as Record<string, string>;
  const faxSid = body.FaxSid || body.faxSid;
  const mediaUrl = body.MediaUrl || body.mediaUrl;
  const from = body.From || body.from || "";
  const to = body.To || body.to || "";
  const faxStatus = body.FaxStatus || body.faxStatus || "";
  const pageCount = parseInt(body.NumPages || body.numPages || "0", 10) || 0;

  if (!faxSid) {
    logger.error("[fax] Missing FaxSid in payload", {body});
    res.status(400).json({error: "FaxSid required"});
    return;
  }

  logger.info("[fax] Payload parsed", {
    faxSid, from, to, faxStatus, pageCount, hasMediaUrl: !!mediaUrl,
  });

  // ── Signature verification ────────────────────────────────────────────────
  // SignalWire's LaML fax webhooks may sign with either the LaML Auth Token
  // (Twilio-compat) or the project-level Signing Key — depends on dashboard
  // config. Accept either secret.
  const authToken = process.env.SIGNALWIRE_AUTH_TOKEN || signalwireAuthToken.value();
  const signingKey = process.env.SIGNALWIRE_SIGNING_KEY || signalwireSigningKey.value();
  const candidateUrls = buildSigCandidateUrls(req, "signalwireFaxWebhook");
  const signature = (req.headers["x-signalwire-signature"] ||
    req.headers["x-twilio-signature"]) as string | undefined;

  const sigCheck = verifySignalWireSignature(
    signature, [authToken, signingKey], candidateUrls, body,
  );
  if (sigCheck.ok) {
    logger.info("[fax] Signature verified", {
      faxSid,
      via: sigCheck.matchedTokenIdx === 0 ? "auth_token" : "signing_key",
    });
  } else {
    logger.warn("[fax] Signature mismatch — rejecting", {
      faxSid,
      candidateUrls,
      hasSig: !!signature,
      sigPrefix: signature ? signature.slice(0, 12) : null,
      expectedPrefix: sigCheck.expected ? sigCheck.expected.slice(0, 12) : null,
    });
    // Reject unsigned/invalid payloads. An unauthenticated attacker could
    // otherwise forge fax records (with attacker-controlled MediaUrl),
    // triggering admin notifications, downstream AI processing, and — in
    // auto_send mode — outbound emails or DrChrono uploads.
    //
    // Escape hatch: set FAX_ALLOW_UNSIGNED=true in env to revert to soft-fail
    // during a signing-key rotation. Do not leave it on.
    if (process.env.FAX_ALLOW_UNSIGNED !== "true") {
      res.status(403).json({error: "invalid signature"});
      return;
    }
  }

  // ── Idempotency: skip if row already exists ───────────────────────────────
  const docRef = db().collection("inbound-faxes").doc(faxSid);
  const existing = await docRef.get();
  if (existing.exists) {
    logger.info("[fax] Row already exists, treating as duplicate", {
      faxSid,
      existingStatus: existing.data()?.status,
    });
    res.status(200).json({ok: true, duplicate: true});
    return;
  }

  // ── Only process completed/received faxes ─────────────────────────────────
  // SignalWire may fire multiple status callbacks; we only want the final one
  // with media.
  if (faxStatus && faxStatus !== "received" && faxStatus !== "delivered") {
    logger.info("[fax] Non-terminal status — acknowledging without storing", {
      faxSid, faxStatus,
    });
    res.status(200).json({ok: true, ignored: faxStatus});
    return;
  }

  if (!mediaUrl) {
    logger.warn("[fax] No MediaUrl in payload — cannot store", {faxSid, faxStatus});
    // Write a row anyway so admins see it in the UI
    await docRef.set({
      faxSid,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      from,
      to,
      pageCount,
      pdfPath: null,
      status: "failed",
      attempts: 0,
      lastAttemptAt: null,
      nextRetryAt: null,
      lastError: {
        message: "No MediaUrl in SignalWire payload",
        at: admin.firestore.FieldValue.serverTimestamp(),
      },
      aurelia: null,
      matchedPatient: null,
      extracted: null,
      drchronoDocumentId: null,
      emailMode: "draft_only",
      emailDraft: null,
      emailSent: null,
      reprocessHistory: [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(200).json({ok: true, stored: false});
    return;
  }

  // ── Download PDF ──────────────────────────────────────────────────────────
  const projectId = process.env.SIGNALWIRE_PROJECT_ID || signalwireProjectId.value();
  let pdfBuffer: Buffer;
  let contentType: string;
  try {
    const dl = await downloadFaxMedia(mediaUrl, projectId, authToken);
    pdfBuffer = dl.buffer;
    contentType = dl.contentType;
    logger.info("[fax] Media downloaded", {
      faxSid, bytes: pdfBuffer.length, contentType,
    });
  } catch (err: any) {
    logger.error("[fax] Media download failed", {faxSid, message: err.message});
    await docRef.set({
      faxSid,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      from,
      to,
      pageCount,
      pdfPath: null,
      status: "failed",
      attempts: 0,
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
      lastError: {
        message: `MediaUrl download failed: ${err.message}`,
        at: admin.firestore.FieldValue.serverTimestamp(),
      },
      mediaUrl,
      aurelia: null,
      matchedPatient: null,
      extracted: null,
      drchronoDocumentId: null,
      emailMode: "draft_only",
      emailDraft: null,
      emailSent: null,
      reprocessHistory: [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(200).json({ok: false, error: "media-download-failed"});
    return;
  }

  // ── Store in Cloud Storage ────────────────────────────────────────────────
  const bucket = admin.storage().bucket();
  const ext = contentType.includes("pdf") ? "pdf" :
    contentType.includes("tiff") ? "tiff" : "bin";
  const pdfPath = `incoming-faxes/${faxSid}/original.${ext}`;
  try {
    const file = bucket.file(pdfPath);
    await file.save(pdfBuffer, {
      contentType,
      metadata: {
        metadata: {faxSid, from, to},
      },
    });
    logger.info("[fax] PDF stored in GCS", {
      faxSid, pdfPath, bucket: bucket.name,
    });
  } catch (err: any) {
    logger.error("[fax] GCS upload failed", {faxSid, message: err.message});
    res.status(500).json({ok: false, error: "storage-failed"});
    return;
  }

  // ── Write tracking row ────────────────────────────────────────────────────
  // Pull the global default emailMode off system/settings.faxEmailMode
  let emailMode: "draft_only" | "auto_send" = "draft_only";
  try {
    const settingsDoc = await db().doc("system/settings").get();
    const mode = settingsDoc.data()?.faxEmailMode;
    if (mode === "auto_send" || mode === "draft_only") emailMode = mode;
  } catch { /* non-fatal */ }

  await docRef.set({
    faxSid,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    from,
    to,
    pageCount,
    pdfPath,
    contentType,
    byteSize: pdfBuffer.length,
    status: "pending",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    lastError: null,
    aurelia: null,
    matchedPatient: null,
    extracted: null,
    drchronoDocumentId: null,
    emailMode,
    emailDraft: null,
    emailSent: null,
    reprocessHistory: [],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  logger.info("[fax] Row written, status=pending", {faxSid, emailMode});
  // Inbound faxes carry PHI. HIPAA expects an audit event for receipt.
  // Fax phone numbers (from/to) are PII and dropped automatically by the
  // scrubPii recursion (`phone` is in the blocklist). Page count + size
  // are non-PII metadata.
  await emitAudit({
    actorId: "system:webhook",
    actorRole: "system",
    action: "fax.received",
    resourceType: "inbound-fax",
    resourceId: faxSid,
    metadata: {pageCount, byteSize: pdfBuffer.length, emailMode},
  });

  // ── Admin notification ────────────────────────────────────────────────────
  await db().collection("notifications").add({
    recipientRole: "admin",
    type: "fax_received",
    title: "New Inbound Fax",
    message: `Fax from ${from || "unknown"} — ${pageCount || "?"} page(s)`,
    isRead: false,
    readBy: {},
    meta: {faxSid},
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err: any) =>
    logger.warn("[fax] Notification write failed (non-fatal)", {message: err.message}),
  );

  // ── Best-effort Aurelia trigger ───────────────────────────────────────────
  await triggerAureliaProcessing(faxSid);

  const elapsed = Date.now() - startMs;
  logger.info("[fax] Webhook complete", {faxSid, elapsedMs: elapsed});
  res.status(200).json({ok: true, faxSid, elapsedMs: elapsed});
}

export const signalwireFaxWebhook = onRequest(
  {
    secrets: [signalwireProjectId, signalwireAuthToken, signalwireSigningKey],
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  handle,
);
