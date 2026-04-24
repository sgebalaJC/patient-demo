/**
 * Admin-callable actions for inbound-faxes: send drafted email, reprocess,
 * edit draft, mark junk.
 */

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import {google} from "googleapis";
import {requireFaxAdmin} from "./lib/signalwire-helpers.js";
import {loadSignalwireConfig} from "./lib/signalwire-config.js";

const googleSaKey = defineSecret("GOOGLE_SA_KEY");

// Outbound fax-forward email uses the practice's Google Workspace mailbox
// via SA domain-wide delegation. Resolved from the SignalWire integration
// doc (admin-managed) with env-var fallback for backward compatibility.
async function loadFaxEmails(): Promise<{from: string; cc: string}> {
  const cfg = await loadSignalwireConfig();
  return {
    from: cfg?.faxFromEmail || "",
    cc: cfg?.faxCcEmail || "",
  };
}

let _db: admin.firestore.Firestore;
function db() {
  if (!_db) _db = admin.firestore();
  return _db;
}

// ---------------------------------------------------------------------------
// Gmail send via SA domain-wide delegation
// ---------------------------------------------------------------------------

interface MailAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

// Reject CR/LF in any value that will be interpolated into a MIME header.
// Without this guard a crafted `subject` / `to` / `filename` (including values
// coming from Aurelia's fax extraction, which sees attacker-authored PDFs)
// could inject extra headers such as `Bcc:` to silently exfiltrate PHI.
function assertHeaderSafe(field: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new HttpsError(
      "invalid-argument",
      `Invalid characters in ${field}`,
    );
  }
  return value;
}

async function sendFaxForwardEmail(args: {
  to: string;
  cc?: string[];
  subject: string;
  body: string;
  attachments?: MailAttachment[];
}): Promise<string> {
  const saKeyJson = process.env.GOOGLE_SA_KEY;
  if (!saKeyJson) throw new Error("GOOGLE_SA_KEY not configured");
  const {from: faxFromEmail} = await loadFaxEmails();
  if (!faxFromEmail) throw new Error("Fax from-email not configured on integrations/signalwire");
  const key = JSON.parse(saKeyJson);

  const jwtClient = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: faxFromEmail,
  });
  await jwtClient.authorize();
  const gmail = google.gmail({version: "v1", auth: jwtClient});

  const safeTo = assertHeaderSafe("to", args.to);
  const safeSubject = assertHeaderSafe("subject", args.subject);
  const safeCc = (args.cc || []).map((c, i) => assertHeaderSafe(`cc[${i}]`, c));
  const ccLine = safeCc.length ? `Cc: ${safeCc.join(", ")}\r\n` : "";
  const hasAttachments = !!args.attachments?.length;
  let mime: string;

  if (!hasAttachments) {
    mime = [
      `From: ${faxFromEmail}`,
      `To: ${safeTo}`,
      ccLine.trim(),
      `Subject: ${safeSubject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      args.body,
    ].filter(Boolean).join("\r\n");
  } else {
    const boundary = `fax_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const parts: string[] = [];
    parts.push([
      `From: ${faxFromEmail}`,
      `To: ${safeTo}`,
      ccLine.trim(),
      `Subject: ${safeSubject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      args.body,
    ].filter(Boolean).join("\r\n"));

    for (const att of args.attachments!) {
      const safeFilename = assertHeaderSafe("attachment filename", att.filename);
      const b64 = att.content.toString("base64").replace(/(.{76})/g, "$1\r\n");
      parts.push([
        `--${boundary}`,
        `Content-Type: ${att.mimeType}; name="${safeFilename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${safeFilename}"`,
        "",
        b64,
      ].join("\r\n"));
    }
    parts.push(`--${boundary}--`);
    mime = parts.join("\r\n");
  }

  const raw = Buffer.from(mime, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: {raw},
  });
  return res.data.id || "";
}

async function downloadFaxFile(pdfPath: string): Promise<Buffer> {
  // Try the project default bucket + legacy .appspot.com form.
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  const tryBuckets = [
    `${project}.firebasestorage.app`,
    `${project}.appspot.com`,
  ];
  let lastErr: any;
  for (const bucket of tryBuckets) {
    try {
      const [buf] = await admin.storage().bucket(bucket).file(pdfPath).download();
      return buf;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Failed to download fax file from any bucket: ${lastErr?.message || "unknown"}`);
}

const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
};

function detectMimeByMagic(buf: Buffer): string | null {
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (buf.length >= 8 && buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && buf.subarray(0, 6).toString("ascii").startsWith("GIF8")) return "image/gif";
  if (buf.length >= 12) {
    const head = buf.subarray(0, 4).toString("ascii");
    const fmt = buf.subarray(8, 12).toString("ascii");
    if (head === "RIFF" && fmt === "WEBP") return "image/webp";
  }
  if (buf.length >= 4) {
    const h = buf.subarray(0, 4).toString("hex");
    if (h === "49492a00" || h === "4d4d002a") return "image/tiff";
  }
  return null;
}

function extFromPath(p: string): string {
  const m = p.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function extForMime(mime: string): string {
  for (const [ext, m] of Object.entries(EXT_TO_MIME)) {
    if (m === mime) return ext;
  }
  return "bin";
}

function sanitizeAttachmentFilename(raw: string, mime: string): string {
  const base = (raw || "fax").replace(/[\/\\<>:"|?*\x00-\x1f]+/g, "_").slice(0, 180);
  const desiredExt = extForMime(mime);
  const currentExt = extFromPath(base);
  if (currentExt && EXT_TO_MIME[currentExt] === mime) return base;
  const stripped = base.replace(/\.[a-z0-9]+$/i, "");
  return `${stripped}.${desiredExt}`;
}

// ---------------------------------------------------------------------------
// sendFaxEmail — admin clicks "Send" on the draft
// ---------------------------------------------------------------------------

export const sendFaxEmail = onCall({
  secrets: [googleSaKey],
  timeoutSeconds: 60,
}, async (request) => {
  const uid = await requireFaxAdmin(request.auth as any);
  const {faxSid, overrideDraft} = request.data as {
    faxSid: string;
    overrideDraft?: { to: string; cc?: string[]; subject: string; body: string };
  };
  if (!faxSid) throw new HttpsError("invalid-argument", "faxSid required");

  const ref = db().collection("inbound-faxes").doc(faxSid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Fax not found");

  const data = snap.data()!;
  const draft = overrideDraft || data.emailDraft;
  if (!draft?.to || !draft?.subject || !draft?.body) {
    throw new HttpsError("failed-precondition", "Draft incomplete (to/subject/body)");
  }

  // Attach the fax PDF itself so the patient gets the document, not just
  // a summary. Best-effort: if the PDF can't be fetched we still send the
  // email (admin expects the send to go through), but log the miss.
  // Attach the fax file — could be PDF (SignalWire) or image (PNG/JPEG/etc.
  // if admin uploaded one or the sender faxed a scanned image format).
  // Detect MIME from magic bytes first, then fall back to the stored path's
  // extension, defaulting to application/pdf.
  const attachments: MailAttachment[] = [];
  const pdfPath = data.pdfPath as string | undefined;
  if (pdfPath) {
    try {
      const buf = await downloadFaxFile(pdfPath);
      const mime = detectMimeByMagic(buf)
        || EXT_TO_MIME[extFromPath(pdfPath)]
        || "application/pdf";
      const suggestedName = (data.emailDraft?.attachmentFilename as string | undefined)
        || (data.extractedContext?.suggestedFilename as string | undefined)
        || `fax-${faxSid.slice(0, 8)}`;
      attachments.push({
        filename: sanitizeAttachmentFilename(suggestedName, mime),
        mimeType: mime,
        content: buf,
      });
    } catch (err: any) {
      logger.warn("[fax] Failed to attach file, sending text-only", {faxSid, message: err.message});
    }
  } else {
    logger.warn("[fax] No pdfPath on fax doc, sending text-only", {faxSid});
  }

  logger.info("[fax] Sending email", {faxSid, by: uid, attached: attachments.length});
  const {cc: faxCcEmail} = await loadFaxEmails();
  const messageId = await sendFaxForwardEmail({
    to: draft.to,
    cc: draft.cc?.length ? draft.cc : faxCcEmail ? [faxCcEmail] : [],
    subject: draft.subject,
    body: draft.body,
    attachments,
  });
  logger.info("[fax] Email sent", {faxSid, messageId});

  await ref.update({
    emailDraft: draft,
    emailSent: {
      messageId,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      sentBy: "admin_manual",
      adminUid: uid,
    },
    status: data.drchronoDocumentId ? "completed" : data.status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    reprocessHistory: admin.firestore.FieldValue.arrayUnion({
      at: new Date(),
      requestedBy: uid,
      reason: "email_sent",
    }),
  });

  return {ok: true, messageId};
});

// ---------------------------------------------------------------------------
// reprocessFax — admin triggers reprocessing via sidecar/Aurelia
// ---------------------------------------------------------------------------

export const reprocessFax = onCall({
  timeoutSeconds: 60,
}, async (request) => {
  const uid = await requireFaxAdmin(request.auth as any);
  const {faxSid, reason = "force_rerun"} = request.data as {
    faxSid: string; reason?: string;
  };
  if (!faxSid) throw new HttpsError("invalid-argument", "faxSid required");

  const ref = db().collection("inbound-faxes").doc(faxSid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Fax not found");

  logger.info("[fax] Reprocess requested", {faxSid, reason, by: uid});

  await ref.update({
    status: "pending",
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    reprocessHistory: admin.firestore.FieldValue.arrayUnion({
      at: new Date(),
      requestedBy: uid,
      reason,
    }),
  });

  // Best-effort Aurelia trigger
  const SIDECAR_URL = process.env.SIDECAR_URL || "http://34.41.116.243:8081";
  const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";
  if (SIDECAR_API_KEY) {
    try {
      const res = await fetch(`${SIDECAR_URL}/fax/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SIDECAR_API_KEY}`,
          "X-User-Uid": uid,
          "X-User-Role": "admin",
          "X-User-Name": "Reprocess",
        },
        body: JSON.stringify({faxSid, reason}),
        signal: AbortSignal.timeout(5000),
      });
      logger.info("[fax] Reprocess trigger sent", {faxSid, status: res.status});
    } catch (err: any) {
      logger.warn("[fax] Reprocess trigger failed", {faxSid, message: err.message});
    }
  }

  return {ok: true};
});

// ---------------------------------------------------------------------------
// updateFaxDraft — admin edits draft inline or overrides matched patient
// ---------------------------------------------------------------------------

export const updateFaxDraft = onCall({timeoutSeconds: 30}, async (request) => {
  const uid = await requireFaxAdmin(request.auth as any);
  const {faxSid, patch} = request.data as {
    faxSid: string;
    patch: {
      emailDraft?: { to: string; cc?: string[]; subject: string; body: string };
      matchedPatient?: { drchronoId?: number; patientId?: string; confidence?: string } | null;
      notes?: string;
      emailMode?: "draft_only" | "auto_send";
    };
  };
  if (!faxSid || !patch) throw new HttpsError("invalid-argument", "faxSid + patch required");

  const ref = db().collection("inbound-faxes").doc(faxSid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Fax not found");

  const updates: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (patch.emailDraft) updates.emailDraft = patch.emailDraft;
  if (patch.matchedPatient !== undefined) updates.matchedPatient = patch.matchedPatient;
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if (patch.emailMode) updates.emailMode = patch.emailMode;

  await ref.update(updates);
  logger.info("[fax] Draft updated", {faxSid, by: uid, fields: Object.keys(patch)});
  return {ok: true};
});

// ---------------------------------------------------------------------------
// markFaxJunk — admin marks a fax as junk/spam
// ---------------------------------------------------------------------------

export const markFaxJunk = onCall({timeoutSeconds: 30}, async (request) => {
  const uid = await requireFaxAdmin(request.auth as any);
  const {faxSid, notes = ""} = request.data as {faxSid: string; notes?: string};
  if (!faxSid) throw new HttpsError("invalid-argument", "faxSid required");

  const ref = db().collection("inbound-faxes").doc(faxSid);
  await ref.update({
    status: "completed",
    notes: notes || "Marked as junk",
    reviewedBy: uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    reprocessHistory: admin.firestore.FieldValue.arrayUnion({
      at: new Date(),
      requestedBy: uid,
      reason: "mark_junk",
    }),
  });
  logger.info("[fax] Marked as junk", {faxSid, by: uid});
  return {ok: true};
});

// ---------------------------------------------------------------------------
// attachFaxToDrChrono — idempotent: calls sidecar /fax-to-drchrono helper
// ---------------------------------------------------------------------------

const SIDECAR_URL = process.env.SIDECAR_URL || "http://34.41.116.243:8081";
const SIDECAR_API_KEY_ENV = "SIDECAR_API_KEY";

export const attachFaxToDrChrono = onCall({timeoutSeconds: 60}, async (request) => {
  const uid = await requireFaxAdmin(request.auth as any);
  const {faxSid, description, metatags, filename} = request.data as {
    faxSid: string;
    description?: string;
    metatags?: string[];
    filename?: string;
  };
  if (!faxSid) throw new HttpsError("invalid-argument", "faxSid required");

  const ref = db().collection("inbound-faxes").doc(faxSid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Fax not found");
  const data = snap.data()!;

  // Idempotent: if already uploaded, return the existing document ID
  if (data.drchronoDocumentId) {
    logger.info("[fax] Already attached to DrChrono, returning existing", {
      faxSid, drchronoDocumentId: data.drchronoDocumentId,
    });
    return {
      ok: true,
      alreadyAttached: true,
      drchronoDocumentId: data.drchronoDocumentId,
    };
  }

  const drchronoId = data.matchedPatient?.drchronoId;
  if (!drchronoId) {
    throw new HttpsError(
      "failed-precondition",
      "No matched patient — run 'Process with Aurelia' first to match a patient",
    );
  }

  const apiKey = process.env[SIDECAR_API_KEY_ENV] || "";
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "SIDECAR_API_KEY not configured");
  }

  const doctype = data.extracted?.documentType || "Inbound Fax";
  const sender = data.extracted?.senderProvider || data.from || "unknown";
  const today = new Date().toISOString().slice(0, 10);
  const defaultDescription =
    `Inbound fax — ${doctype} — ${sender} — ${today}`;
  const defaultMetatags = ["Inbound Fax", doctype].filter(Boolean);

  // Auto-rename file based on extracted context. Sidecar re-sanitizes, but
  // we pick a readable base here: {DocType}_{YYYY-MM-DD}
  const autoFilename = filename || [doctype, today]
    .filter(Boolean)
    .join("_")
    .replace(/\s+/g, "_");

  logger.info("[fax] Triggering DrChrono upload via sidecar", {
    faxSid, drchronoId, by: uid,
  });

  let sidecarRes: Response;
  try {
    sidecarRes = await fetch(`${SIDECAR_URL}/admin-api/fax-to-drchrono`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-User-Uid": uid,
        "X-User-Role": "admin",
        "X-User-Name": "attachFax",
      },
      body: JSON.stringify({
        faxSid,
        patient: drchronoId,
        description: description || defaultDescription,
        metatags: metatags || defaultMetatags,
        filename: autoFilename,
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err: any) {
    logger.error("[fax] Sidecar fetch failed", {faxSid, message: err.message});
    throw new HttpsError("unavailable", `Sidecar unreachable: ${err.message}`);
  }

  const result = await sidecarRes.json() as {
    ok: boolean;
    documentId?: number;
    error?: string;
  };

  if (!result.ok || !result.documentId) {
    logger.error("[fax] DrChrono upload failed", {faxSid, error: result.error});
    throw new HttpsError(
      "internal",
      result.error || "DrChrono upload failed",
    );
  }

  await ref.update({
    drchronoDocumentId: result.documentId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    reprocessHistory: admin.firestore.FieldValue.arrayUnion({
      at: new Date(),
      requestedBy: uid,
      reason: "attach_to_drchrono",
    }),
  });

  logger.info("[fax] DrChrono upload succeeded", {
    faxSid, documentId: result.documentId,
  });

  return {
    ok: true,
    alreadyAttached: false,
    drchronoDocumentId: result.documentId,
  };
});

// ---------------------------------------------------------------------------
// detachFaxFromDrChrono — deletes the doc from DrChrono + clears local field
// ---------------------------------------------------------------------------

export const detachFaxFromDrChrono = onCall({timeoutSeconds: 60}, async (request) => {
  const uid = await requireFaxAdmin(request.auth as any);
  const {faxSid} = request.data as {faxSid: string};
  if (!faxSid) throw new HttpsError("invalid-argument", "faxSid required");

  const ref = db().collection("inbound-faxes").doc(faxSid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Fax not found");
  const data = snap.data()!;
  const docId = data.drchronoDocumentId as number | undefined;

  if (!docId) {
    return {ok: true, alreadyDetached: true};
  }

  const apiKey = process.env[SIDECAR_API_KEY_ENV] || "";
  if (!apiKey) throw new HttpsError("failed-precondition", "SIDECAR_API_KEY not configured");

  logger.info("[fax] Detaching from DrChrono", {faxSid, docId, by: uid});

  // Delete via the sidecar's DrChrono proxy
  let dcRes: Response;
  try {
    dcRes = await fetch(`${SIDECAR_URL}/admin-api/drchrono/documents/${docId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-User-Uid": uid,
        "X-User-Role": "admin",
        "X-User-Name": "detachFax",
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: any) {
    throw new HttpsError("unavailable", `Sidecar unreachable: ${err.message}`);
  }

  // DrChrono returns 204 on success; treat 404 as "already gone" (idempotent)
  if (!dcRes.ok && dcRes.status !== 404) {
    const text = await dcRes.text();
    logger.error("[fax] DrChrono delete failed", {faxSid, docId, status: dcRes.status, text});
    throw new HttpsError("internal", `DrChrono delete failed: ${dcRes.status}`);
  }

  await ref.update({
    drchronoDocumentId: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    reprocessHistory: admin.firestore.FieldValue.arrayUnion({
      at: new Date(),
      requestedBy: uid,
      reason: "detach_from_drchrono",
      previousDocumentId: docId,
    }),
  });

  logger.info("[fax] Detached from DrChrono", {faxSid, docId});
  return {ok: true, detachedDocumentId: docId};
});

// ---------------------------------------------------------------------------
// deleteFax — hard delete: Firestore row + GCS PDF + related notifications
// ---------------------------------------------------------------------------

export const deleteFax = onCall({timeoutSeconds: 30}, async (request) => {
  const uid = await requireFaxAdmin(request.auth as any);
  const {faxSid} = request.data as {faxSid: string};
  if (!faxSid) throw new HttpsError("invalid-argument", "faxSid required");

  const ref = db().collection("inbound-faxes").doc(faxSid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Fax not found");
  const pdfPath = snap.data()?.pdfPath;

  logger.info("[fax] Hard delete requested", {faxSid, by: uid, hasPdf: !!pdfPath});

  // Delete PDF from GCS (best-effort — don't fail if missing)
  if (pdfPath) {
    try {
      await admin.storage().bucket().file(pdfPath).delete();
      logger.info("[fax] PDF deleted from GCS", {faxSid, pdfPath});
    } catch (err: any) {
      logger.warn("[fax] PDF delete failed (continuing)", {faxSid, message: err.message});
    }
  }

  // Delete related notifications
  const notifs = await db().collection("notifications")
    .where("meta.faxSid", "==", faxSid).get();
  const batch = db().batch();
  notifs.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(ref);
  await batch.commit();
  logger.info("[fax] Firestore row + notifications deleted", {
    faxSid, notifCount: notifs.size,
  });

  return {ok: true};
});

// ---------------------------------------------------------------------------
// getFaxPdfUrl — returns a signed URL for the PDF stored in GCS
// ---------------------------------------------------------------------------

export const getFaxPdfUrl = onCall({timeoutSeconds: 30}, async (request) => {
  await requireFaxAdmin(request.auth as any);
  const {faxSid} = request.data as {faxSid: string};
  if (!faxSid) throw new HttpsError("invalid-argument", "faxSid required");

  // Look up the fax in inbound-faxes / outbound-faxes (real) or
  // simulation/faxes/* (sim). Sim faxSids are prefixed SIM-… so we can skip
  // the real lookup for them. Outbound docs store the GCS path under
  // `mergedPath` (the merged + cover-page PDF) rather than `pdfPath`.
  let pdfPath: string | undefined;
  if (faxSid.startsWith("SIM-")) {
    const inSnap = await db().doc(`simulation/faxes/inbound/${faxSid}`).get();
    if (inSnap.exists) {
      pdfPath = inSnap.data()?.pdfPath;
    } else {
      const outSnap = await db().doc(`simulation/faxes/outbound/${faxSid}`).get();
      if (!outSnap.exists) throw new HttpsError("not-found", "Fax not found");
      const data = outSnap.data() || {};
      pdfPath = data.pdfPath || data.mergedPath;
    }
  } else {
    const inSnap = await db().collection("inbound-faxes").doc(faxSid).get();
    if (inSnap.exists) {
      pdfPath = inSnap.data()?.pdfPath;
    } else {
      const outSnap = await db().collection("outbound-faxes").doc(faxSid).get();
      if (!outSnap.exists) throw new HttpsError("not-found", "Fax not found");
      const data = outSnap.data() || {};
      pdfPath = data.pdfPath || data.mergedPath;
    }
  }
  if (!pdfPath) throw new HttpsError("failed-precondition", "No PDF stored for this fax");

  // Force inline disposition + application/pdf so the browser previews the
  // file in-place. Without this, GCS sometimes returns Content-Disposition:
  // attachment, which makes Chrome show its dark "Open" prompt instead of
  // rendering the PDF inside our <iframe>.
  const [url] = await admin.storage().bucket().file(pdfPath).getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000, // 15 min
    responseDisposition: "inline",
    responseType: "application/pdf",
  });
  return {url};
});
