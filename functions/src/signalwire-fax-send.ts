/**
 * Outbound fax pipeline — admin uploads one or more PDFs, the callable merges
 * them into a single document, submits it to SignalWire's LaML Fax API, and
 * tracks the send in `outbound-faxes/{faxSid}`. SignalWire posts status updates
 * to `signalwireFaxStatusWebhook` which verifies the HMAC and updates the doc.
 *
 * Flow:
 *   1. Admin uploads PDFs to GCS at admin/outbound-faxes/{batchId}/{i}_{name}
 *   2. Frontend calls `sendOutboundFax({ batchId, paths, to, subject? })`
 *   3. We merge the PDFs (pdf-lib), store the merged file, sign a 24h URL
 *   4. POST to SignalWire Faxes.json with StatusCallback → our webhook
 *   5. Write outbound-faxes/{faxSid} with status=queued
 *   6. Webhook verifies signature + updates doc on each status change
 */

import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type {Request, Response} from "express";
import {PDFDocument, StandardFonts, rgb} from "pdf-lib";
import {
  signalwireProjectId,
  signalwireAuthToken,
  signalwireSigningKey,
} from "./signalwire-webhook.js";
import {FUNCTIONS_BRANDING} from "./branding.js";

const signalwireSpaceUrl = defineSecret("SIGNALWIRE_SPACE_URL");

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

// Sender block for the cover sheet, pulled from FUNCTIONS_BRANDING. The fax
// number is read from integrations/signalwire.faxNumber at send-time so it
// stays aligned with the number admins set in the integration UI.
async function loadCoverSender(): Promise<{
  name: string;
  addressLine1?: string;
  addressLine2?: string;
  phone?: string;
  fax?: string;
}> {
  const integ = await admin.firestore().doc("integrations/signalwire").get();
  const data = (integ.data() ?? {}) as {faxNumber?: string; faxLabel?: string};
  return {
    name: FUNCTIONS_BRANDING.practiceName,
    phone: undefined,
    fax: data.faxLabel || data.faxNumber,
  };
}

const COVER_FOOTER_LINES = [
  "This fax may contain privileged or confidential information and is intended for the exclusive use of the addressee(s).",
  "If you are not an intended recipient, please notify sender and destroy all copies. Failure to do so may result in legal sanction.",
];

// Resolve the bundled logo asset. Per-fork: drop a PNG at
// functions/src/assets/logo.png to enable the cover-sheet logo.
let _logoBytes: Uint8Array | null = null;
function getLogoBytes(): Uint8Array | null {
  if (_logoBytes) return _logoBytes;
  const candidates = [
    path.join(__dirname, "assets", "logo.png"),
    path.join(__dirname, "..", "src", "assets", "logo.png"),
  ];
  for (const p of candidates) {
    try {
      _logoBytes = new Uint8Array(fs.readFileSync(p));
      return _logoBytes;
    } catch { /* try next */ }
  }
  logger.debug("[outbound-fax] cover-sheet logo asset not found (optional)", {tried: candidates});
  return null;
}

async function getOutboundFaxFrom(): Promise<string> {
  const integ = await admin.firestore().doc("integrations/signalwire").get();
  const data = (integ.data() ?? {}) as {faxNumber?: string};
  if (!data.faxNumber) {
    throw new HttpsError(
      "failed-precondition",
      "SignalWire fax number not configured — set integrations/signalwire.faxNumber",
    );
  }
  return data.faxNumber;
}

let _db: admin.firestore.Firestore;
function db() {
  if (!_db) _db = admin.firestore();
  return _db;
}

async function requireAdmin(
  auth: { uid: string; token?: { email?: string } } | undefined,
): Promise<string> {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign-in required");
  const {isSuperAdminEmail} = await import("./superAdmins.js");
  if (isSuperAdminEmail(auth.token?.email)) return auth.uid;
  const userDoc = await db().collection("users").doc(auth.uid).get();
  if (!userDoc.exists || userDoc.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  return auth.uid;
}

// Accept only canonical E.164 — same normalization the web form does. Reject
// anything that isn't a plausible 10–15 digit number after stripping `+`.
function normalizeFaxNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  throw new HttpsError("invalid-argument", "Invalid fax number");
}

// ---------------------------------------------------------------------------
// Cover sheet rendering (one US-letter page prepended to the merged document)
// ---------------------------------------------------------------------------

function sanitizeForPdf(s: string): string {
  if (!s) return "";
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function wrapText(
  text: string, font: any, size: number, maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
      } else {
        if (line) out.push(line);
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

interface CoverInput {
  toName: string;
  toFax: string;     // pre-normalized E.164
  subject: string;
  totalPages: number; // 1 (cover) + merged page count
  date: Date;
  sender: {name: string; addressLine1?: string; addressLine2?: string; phone?: string; fax?: string};
}

async function buildCoverPagePdf(input: CoverInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const PAGE_W = 612;
  const PAGE_H = 792;
  const M = 54; // margin
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  // ── Logo (centered, ~280px wide preserving aspect) ─────────────────────
  let cursorY = PAGE_H - M;
  const logoBytes = getLogoBytes();
  if (logoBytes) {
    try {
      const img = await pdf.embedPng(logoBytes);
      const targetW = 240;
      const scale = targetW / img.width;
      const targetH = img.height * scale;
      page.drawImage(img, {
        x: (PAGE_W - targetW) / 2,
        y: cursorY - targetH,
        width: targetW,
        height: targetH,
        opacity: 1,
      });
      cursorY -= targetH + 6;
    } catch (err: any) {
      logger.warn("[outbound-fax] cover logo embed failed", {message: err.message});
    }
  }

  // ── Provider name (centered) ───────────────────────────────────────────
  const nameSize = 20;
  const nameW = bold.widthOfTextAtSize(input.sender.name, nameSize);
  page.drawText(sanitizeForPdf(input.sender.name), {
    x: (PAGE_W - nameW) / 2, y: cursorY - nameSize,
    size: nameSize, font: bold, color: rgb(0, 0, 0),
  });
  cursorY -= nameSize + 8;

  // ── Sender block: address (left) + phone/fax (right), with rule below ──
  const blockTop = cursorY;
  const lineH = 16;
  const blockSize = 11;
  const leftX = M;
  const rightX = PAGE_W - M;

  const addrLine1 = sanitizeForPdf(input.sender.addressLine1 ?? "");
  const addrLine2 = sanitizeForPdf(input.sender.addressLine2 ?? "");
  const phoneLine = input.sender.phone ? `P: ${input.sender.phone}` : "";
  const faxLine = input.sender.fax ? `F: ${input.sender.fax}` : "";

  if (addrLine1) {
    page.drawText(addrLine1, {
      x: leftX + 18, y: blockTop - blockSize,
      size: blockSize, font: bold, color: rgb(0, 0, 0),
    });
  }
  if (addrLine2) {
    page.drawText(addrLine2, {
      x: leftX + 70, y: blockTop - blockSize - lineH,
      size: blockSize, font: bold, color: rgb(0, 0, 0),
    });
  }

  if (phoneLine) {
    const phoneW = bold.widthOfTextAtSize(phoneLine, blockSize);
    page.drawText(phoneLine, {
      x: rightX - phoneW, y: blockTop - blockSize,
      size: blockSize, font: bold, color: rgb(0, 0, 0),
    });
  }
  if (faxLine) {
    const faxW = bold.widthOfTextAtSize(faxLine, blockSize);
    page.drawText(faxLine, {
      x: rightX - faxW, y: blockTop - blockSize - lineH,
      size: blockSize, font: bold, color: rgb(0, 0, 0),
    });
  }

  cursorY = blockTop - blockSize - lineH - 10;
  page.drawLine({
    start: {x: M, y: cursorY}, end: {x: PAGE_W - M, y: cursorY},
    thickness: 1, color: rgb(0, 0, 0),
  });
  cursorY -= 16;

  // ── To / Date / Fax / Pages / Subject grid ─────────────────────────────
  const labelSize = 11;
  const valueSize = 11;
  const rowH = 22;
  const labelColW = 70;     // narrow labels
  const colGap = 18;
  const halfW = (PAGE_W - 2 * M) / 2;
  const dateStr = `${input.date.getMonth() + 1}/${input.date.getDate()}/${input.date.getFullYear()}`;
  const rows: Array<[string, string, string, string]> = [
    ["To:", input.toName || "(recipient)", "Date:", dateStr],
    ["Fax:", input.toFax.replace(/^\+1/, "").replace(/[^\d]/g, ""), "Pages:", String(input.totalPages)],
    ["Subject:", input.subject || "", "", ""],
  ];

  for (const [labelL, valueL, labelR, valueR] of rows) {
    const yLabel = cursorY - labelSize;
    // Left half label (right-aligned in its label column)
    const labelLW = bold.widthOfTextAtSize(labelL, labelSize);
    page.drawText(labelL, {
      x: M + labelColW - labelLW, y: yLabel,
      size: labelSize, font: bold, color: rgb(0, 0, 0),
    });
    // Left value, wrapped if it spans the row (subject case fills both halves)
    const valueLMaxW = labelR
      ? halfW - labelColW - colGap
      : (PAGE_W - 2 * M) - labelColW - colGap;
    const valueLines = wrapText(sanitizeForPdf(valueL), font, valueSize, valueLMaxW);
    let vy = yLabel;
    for (const ln of valueLines) {
      page.drawText(ln, {
        x: M + labelColW + colGap, y: vy,
        size: valueSize, font, color: rgb(0, 0, 0),
      });
      vy -= 14;
    }

    if (labelR) {
      const labelRW = bold.widthOfTextAtSize(labelR, labelSize);
      page.drawText(labelR, {
        x: M + halfW + labelColW - labelRW, y: yLabel,
        size: labelSize, font: bold, color: rgb(0, 0, 0),
      });
      page.drawText(valueR, {
        x: M + halfW + labelColW + colGap, y: yLabel,
        size: valueSize, font, color: rgb(0, 0, 0),
      });
    }

    const usedRows = Math.max(1, valueLines.length);
    cursorY -= rowH + (usedRows - 1) * 14;
  }

  // Closing rule under the metadata block
  cursorY -= 4;
  page.drawLine({
    start: {x: M, y: cursorY}, end: {x: PAGE_W - M, y: cursorY},
    thickness: 1, color: rgb(0, 0, 0),
  });

  // ── Confidentiality footer ─────────────────────────────────────────────
  const footerSize = 10;
  let fy = M + footerSize * COVER_FOOTER_LINES.length + 4;
  for (const line of COVER_FOOTER_LINES) {
    const lines = wrapText(sanitizeForPdf(line), font, footerSize, PAGE_W - 2 * M);
    for (const ln of lines) {
      const w = font.widthOfTextAtSize(ln, footerSize);
      page.drawText(ln, {
        x: (PAGE_W - w) / 2, y: fy,
        size: footerSize, font, color: rgb(0.2, 0.2, 0.2),
      });
      fy -= footerSize + 4;
    }
  }

  return Buffer.from(await pdf.save());
}

// ---------------------------------------------------------------------------
// sendOutboundFax — admin submits a fax
// ---------------------------------------------------------------------------

interface SendOutboundFaxArgs {
  batchId: string;
  paths: string[];
  to: string;
  subject?: string;
  coverIncluded?: boolean;
  coverTo?: string;
}

/**
 * Core send logic. Shared by the onCall wrapper (admin UI) — the sidecar
 * has its own native port in `sidecar/src/lib/signalwire.ts`. Both sides
 * implement the same pipeline; UI + Aurelia hit different entry points.
 */
async function runSendOutboundFax(
  args: SendOutboundFaxArgs,
  uid: string,
): Promise<{ok: true; faxSid: string; status: string}> {
  const {batchId, paths, to, subject, coverIncluded, coverTo} = args;
    const includeCover = coverIncluded !== false; // default ON
    const safeCoverTo = (coverTo || "").slice(0, 120).replace(/[\r\n]+/g, " ").trim();

    if (!batchId || typeof batchId !== "string" || !/^[a-zA-Z0-9_-]{4,64}$/.test(batchId)) {
      throw new HttpsError("invalid-argument", "Invalid batchId");
    }
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_FILES) {
      throw new HttpsError("invalid-argument", `paths must have 1-${MAX_FILES} entries`);
    }
    const prefix = `admin/outbound-faxes/${batchId}/`;
    for (const p of paths) {
      if (typeof p !== "string" || !p.startsWith(prefix)) {
        throw new HttpsError("invalid-argument", "path outside batch prefix");
      }
    }
    const toNormalized = normalizeFaxNumber(to || "");
    const safeSubject = (subject || "").slice(0, 200).replace(/[\r\n]+/g, " ");

    const projectId = process.env.SIGNALWIRE_PROJECT_ID || signalwireProjectId.value();
    const authToken = process.env.SIGNALWIRE_AUTH_TOKEN || signalwireAuthToken.value();
    const spaceUrl = (process.env.SIGNALWIRE_SPACE_URL || signalwireSpaceUrl.value() || "")
      .replace(/\/+$/, "");
    if (!projectId || !authToken || !spaceUrl) {
      throw new HttpsError("failed-precondition", "SignalWire credentials not configured");
    }

    const bucket = admin.storage().bucket();

    // Download + merge PDFs
    const merged = await PDFDocument.create();
    let totalBytes = 0;
    for (const path of paths) {
      const [buf] = await bucket.file(path).download();
      totalBytes += buf.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new HttpsError("invalid-argument", "Total upload exceeds 20MB");
      }
      // Validate magic bytes
      if (buf.length < 4 || buf.subarray(0, 4).toString("ascii") !== "%PDF") {
        throw new HttpsError("invalid-argument", `Not a PDF: ${path}`);
      }
      let src: PDFDocument;
      try {
        src = await PDFDocument.load(buf, {ignoreEncryption: true});
      } catch (err: any) {
        throw new HttpsError("invalid-argument", `Unreadable PDF ${path}: ${err.message}`);
      }
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const p of pages) merged.addPage(p);
    }

    // Optionally prepend a cover sheet. Total page count = 1 cover + merged
    // pages, computed before we render the cover so the "Pages:" field is
    // accurate.
    const outboundFrom = await getOutboundFaxFrom();

    if (includeCover) {
      const totalPages = merged.getPageCount() + 1;
      const sender = await loadCoverSender();
      const coverBytes = await buildCoverPagePdf({
        toName: safeCoverTo,
        toFax: toNormalized,
        subject: safeSubject,
        totalPages,
        date: new Date(),
        sender,
      });
      const coverDoc = await PDFDocument.load(coverBytes);
      const [coverPage] = await merged.copyPages(coverDoc, [0]);
      merged.insertPage(0, coverPage);
    }

    const mergedBytes = Buffer.from(await merged.save());
    const mergedPath = `admin/outbound-faxes/${batchId}/merged.pdf`;
    await bucket.file(mergedPath).save(mergedBytes, {
      contentType: "application/pdf",
      metadata: {metadata: {batchId, submittedBy: uid}},
    });

    // Generate a signed URL SignalWire can fetch. 24h is the ceiling since
    // SignalWire retries failed sends for up to a day.
    const [mediaUrl] = await bucket.file(mergedPath).getSignedUrl({
      action: "read",
      expires: Date.now() + 24 * 60 * 60 * 1000,
    });

    // Build absolute webhook URL for status callbacks.
    // Functions v2 URL pattern: https://<region>-<project>.cloudfunctions.net/<name>
    // Override via env for dev.
    const projectForUrl = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    if (!projectForUrl) throw new HttpsError("internal", "GCLOUD_PROJECT not set");
    const region = process.env.FUNCTION_REGION || "us-west1";
    const statusCallback = process.env.FAX_STATUS_CALLBACK_URL ||
      `https://${region}-${projectForUrl}.cloudfunctions.net/signalwireFaxStatusWebhook`;

    // Submit to SignalWire LaML Faxes API
    const form = new URLSearchParams({
      From: outboundFrom,
      To: toNormalized,
      MediaUrl: mediaUrl,
      Quality: "fine",
      StatusCallback: statusCallback,
    });
    const faxUrl = `${spaceUrl}/api/laml/2010-04-01/Accounts/${projectId}/Faxes.json`;
    const basicAuth = Buffer.from(`${projectId}:${authToken}`).toString("base64");

    let res: Response | globalThis.Response;
    try {
      res = await fetch(faxUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err: any) {
      logger.error("[outbound-fax] SignalWire request failed", {message: err.message});
      throw new HttpsError("unavailable", `SignalWire unreachable: ${err.message}`);
    }

    if (!(res as globalThis.Response).ok) {
      const bodyText = await (res as globalThis.Response).text().catch(() => "");
      logger.error("[outbound-fax] SignalWire rejected fax", {
        status: (res as globalThis.Response).status,
        body: bodyText.slice(0, 300),
      });
      throw new HttpsError(
        "internal",
        `SignalWire error ${(res as globalThis.Response).status}: ${bodyText.slice(0, 200)}`,
      );
    }

    const swJson = await (res as globalThis.Response).json() as {
      sid: string;
      status: string;
      num_pages?: number | null;
      price?: string | null;
    };
    const faxSid = swJson.sid;

    await db().collection("outbound-faxes").doc(faxSid).set({
      faxSid,
      batchId,
      to: toNormalized,
      from: outboundFrom,
      subject: safeSubject || null,
      coverIncluded: includeCover,
      coverTo: safeCoverTo || null,
      pageCount: swJson.num_pages || null,
      fileCount: paths.length,
      sourcePaths: paths,
      mergedPath,
      status: swJson.status || "queued",
      errorCode: null,
      errorMessage: null,
      submittedBy: uid,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedAt: null,
    });

    logger.info("[outbound-fax] Submitted", {
      faxSid, to: toNormalized, by: uid, pages: swJson.num_pages, files: paths.length,
    });

    return {ok: true, faxSid, status: swJson.status};
}

export const sendOutboundFax = onCall(
  {
    secrets: [signalwireProjectId, signalwireAuthToken, signalwireSpaceUrl],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    const uid = await requireAdmin(request.auth as any);
    return runSendOutboundFax(request.data as SendOutboundFaxArgs, uid);
  },
);

// ---------------------------------------------------------------------------
// signalwireFaxStatusWebhook — SignalWire POSTs status updates here
// ---------------------------------------------------------------------------

function computeExpectedSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  return crypto.createHmac("sha1", authToken).update(data).digest("base64");
}

async function handleStatus(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({error: "Method not allowed"});
    return;
  }

  const body = req.body as Record<string, string>;
  const faxSid = body.FaxSid || body.faxSid;
  const faxStatus = body.FaxStatus || body.faxStatus || "";
  const errorCode = body.ErrorCode || body.errorCode || null;
  const errorMessage = body.ErrorMessage || body.errorMessage || null;
  const pageCount = parseInt(body.NumPages || body.numPages || "0", 10) || null;

  if (!faxSid) {
    logger.warn("[outbound-fax] Status webhook missing FaxSid", {body});
    res.status(400).json({error: "FaxSid required"});
    return;
  }

  // SignalWire may sign LaML webhooks with either the LaML Auth Token or the
  // project Signing Key — try both. Cloud Functions v2 also strips the
  // function name from req.url, so try both URL shapes.
  const authToken = process.env.SIGNALWIRE_AUTH_TOKEN || signalwireAuthToken.value();
  const signingKey = process.env.SIGNALWIRE_SIGNING_KEY || signalwireSigningKey.value();
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers["host"] as string;
  const incoming = req.originalUrl || req.url || "/";
  const candidates = [`${proto}://${host}${incoming}`];
  if (incoming === "/" || incoming === "") {
    candidates.push(`${proto}://${host}/signalwireFaxStatusWebhook`);
  }
  const signature = (req.headers["x-signalwire-signature"] ||
    req.headers["x-twilio-signature"]) as string | undefined;

  let sigOk = false;
  if (signature) {
    outer: for (const tok of [authToken, signingKey]) {
      if (!tok) continue;
      for (const u of candidates) {
        if (computeExpectedSignature(tok, u, body) === signature) {
          sigOk = true;
          break outer;
        }
      }
    }
  }
  if (!sigOk) {
    logger.warn("[outbound-fax] Status signature mismatch", {
      faxSid, candidates, hasSig: !!signature,
    });
    if (process.env.FAX_ALLOW_UNSIGNED !== "true") {
      res.status(403).json({error: "invalid signature"});
      return;
    }
  }

  const ref = db().collection("outbound-faxes").doc(faxSid);
  const snap = await ref.get();
  if (!snap.exists) {
    logger.warn("[outbound-fax] Status for unknown fax", {faxSid, faxStatus});
    res.status(200).json({ok: true, unknown: true});
    return;
  }

  const isTerminal = faxStatus === "delivered" ||
    faxStatus === "failed" ||
    faxStatus === "no-answer" ||
    faxStatus === "busy" ||
    faxStatus === "canceled";

  await ref.update({
    status: faxStatus || snap.data()?.status,
    ...(errorCode ? {errorCode} : {}),
    ...(errorMessage ? {errorMessage} : {}),
    ...(pageCount ? {pageCount} : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(isTerminal ? {completedAt: admin.firestore.FieldValue.serverTimestamp()} : {}),
  });

  logger.info("[outbound-fax] Status update", {faxSid, faxStatus, errorCode});
  res.status(200).json({ok: true});
}

export const signalwireFaxStatusWebhook = onRequest(
  {
    secrets: [signalwireAuthToken, signalwireSigningKey],
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  handleStatus,
);

// ---------------------------------------------------------------------------
// deleteOutboundFax — admin removes an outbound row + all its GCS files
// ---------------------------------------------------------------------------

export const deleteOutboundFax = onCall({timeoutSeconds: 60}, async (request) => {
  const uid = await requireAdmin(request.auth as any);
  const {faxSid} = request.data as {faxSid: string};
  if (!faxSid || typeof faxSid !== "string" || faxSid.length > 80) {
    throw new HttpsError("invalid-argument", "invalid faxSid");
  }

  const ref = db().collection("outbound-faxes").doc(faxSid);
  const snap = await ref.get();
  if (!snap.exists) return {ok: true, alreadyGone: true};
  const data = snap.data() || {};
  const batchId = data.batchId as string | undefined;

  // Best-effort GCS cleanup: every PDF for this batch lives under the prefix.
  if (batchId && /^[a-zA-Z0-9_-]{4,64}$/.test(batchId)) {
    try {
      await admin.storage().bucket().deleteFiles({
        prefix: `admin/outbound-faxes/${batchId}/`,
      });
    } catch (err: any) {
      logger.warn("[outbound-fax] GCS cleanup failed (continuing)", {
        faxSid, batchId, message: err.message,
      });
    }
  }

  await ref.delete();
  logger.info("[outbound-fax] deleted", {faxSid, batchId, by: uid});
  return {ok: true};
});
