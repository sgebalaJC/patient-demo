/**
 * Native outbound-fax submission on the sidecar.
 *
 * Ports the Cloud Function flow 1:1 so both entry points (admin UI's
 * `sendOutboundFax` callable and sidecar's `/admin-api/faxes/send`) go
 * through the same SignalWire LaML pipeline:
 *
 *   1. Download staged PDFs from GCS (admin/outbound-faxes/{batchId}/*)
 *   2. Merge into one document, validate magic bytes + total size
 *   3. Optionally prepend a cover sheet (practice branding + recipient)
 *   4. Write the merged file to GCS + sign a 24h read URL
 *   5. POST to SignalWire Faxes.json with the status webhook URL
 *   6. Persist outbound-faxes/{faxSid} so the admin UI live-subscription
 *      and the `signalwireFaxStatusWebhook` Cloud Function can reconcile.
 *
 * Secrets come from Google Secret Manager (SIGNALWIRE_PROJECT_ID,
 * SIGNALWIRE_AUTH_TOKEN, SIGNALWIRE_SPACE_URL). Status webhook continues
 * to hit the Cloud Function — no changes needed on SignalWire's side.
 */
import * as admin from "firebase-admin";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { getDb } from "./firebase.js";

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export interface SendOutboundFaxArgs {
  batchId: string;
  paths: string[];
  to: string;
  subject?: string;
  coverIncluded?: boolean;
  coverTo?: string;
}

export interface SendOutboundFaxResult {
  ok: true;
  faxSid: string;
  status: string;
}

// ── Secrets (Google Secret Manager) ────────────────────────────────────

const secretClient = new SecretManagerServiceClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    || "/root/.openclaw/credentials/google-sa-key.json",
});
const SECRET_TTL_MS = 10 * 60 * 1000;
const secretCache = new Map<string, { value: string; expiresAt: number }>();

function projectId(): string {
  const id = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!id) throw new Error("GCLOUD_PROJECT not set");
  return id;
}

async function readSecret(name: string, fallbackEnv?: string): Promise<string> {
  const fromEnv = fallbackEnv ? process.env[fallbackEnv] : undefined;
  if (fromEnv) return fromEnv;
  const now = Date.now();
  const cached = secretCache.get(name);
  if (cached && cached.expiresAt > now) return cached.value;
  const [ver] = await secretClient.accessSecretVersion({
    name: `projects/${projectId()}/secrets/${name}/versions/latest`,
  });
  const value = ver.payload?.data?.toString("utf8") ?? "";
  if (!value) throw new Error(`Secret ${name} is empty`);
  secretCache.set(name, { value, expiresAt: now + SECRET_TTL_MS });
  return value;
}

// ── Helpers ────────────────────────────────────────────────────────────

function normalizeFaxNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  throw new Error("Invalid fax number");
}

function sanitizeForPdf(s: string): string {
  if (!s) return "";
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, "\"")
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else { if (line) out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out;
}

const COVER_FOOTER_LINES = [
  "This fax may contain privileged or confidential information and is intended for the exclusive use of the addressee(s).",
  "If you are not an intended recipient, please notify sender and destroy all copies. Failure to do so may result in legal sanction.",
];

interface CoverInput {
  senderName: string;
  senderFax: string | null;
  toName: string;
  toFax: string;
  subject: string;
  totalPages: number;
  date: Date;
}

async function buildCoverPagePdf(input: CoverInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const PAGE_W = 612;
  const PAGE_H = 792;
  const M = 54;
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let cursorY = PAGE_H - M;

  const nameSize = 20;
  const nameW = bold.widthOfTextAtSize(input.senderName, nameSize);
  page.drawText(sanitizeForPdf(input.senderName), {
    x: (PAGE_W - nameW) / 2, y: cursorY - nameSize,
    size: nameSize, font: bold, color: rgb(0, 0, 0),
  });
  cursorY -= nameSize + 8;

  const blockTop = cursorY;
  const lineH = 16;
  const blockSize = 11;
  const rightX = PAGE_W - M;

  const faxLine = input.senderFax ? `F: ${input.senderFax}` : "";
  if (faxLine) {
    const faxW = bold.widthOfTextAtSize(faxLine, blockSize);
    page.drawText(faxLine, {
      x: rightX - faxW, y: blockTop - blockSize,
      size: blockSize, font: bold, color: rgb(0, 0, 0),
    });
  }

  cursorY = blockTop - blockSize - lineH - 10;
  page.drawLine({
    start: { x: M, y: cursorY }, end: { x: PAGE_W - M, y: cursorY },
    thickness: 1, color: rgb(0, 0, 0),
  });
  cursorY -= 16;

  const labelSize = 11;
  const valueSize = 11;
  const rowH = 22;
  const labelColW = 70;
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
    const labelLW = bold.widthOfTextAtSize(labelL, labelSize);
    page.drawText(labelL, {
      x: M + labelColW - labelLW, y: yLabel,
      size: labelSize, font: bold, color: rgb(0, 0, 0),
    });
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

  cursorY -= 4;
  page.drawLine({
    start: { x: M, y: cursorY }, end: { x: PAGE_W - M, y: cursorY },
    thickness: 1, color: rgb(0, 0, 0),
  });

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

async function getOutboundFaxFrom(): Promise<string> {
  const integ = await getDb().doc("integrations/signalwire").get();
  const data = (integ.data() ?? {}) as { faxNumber?: string };
  if (!data.faxNumber) {
    throw new Error("SignalWire fax number not configured — set integrations/signalwire.faxNumber");
  }
  return data.faxNumber;
}

async function getPracticeName(): Promise<string> {
  // Sidecar has no branding import; read the SHORT_NAME env set at deploy.
  return process.env.PRACTICE_NAME || "Practice";
}

// ── Main entry ──────────────────────────────────────────────────────────

export async function runSendOutboundFax(
  args: SendOutboundFaxArgs,
  submittedBy: string,
): Promise<SendOutboundFaxResult> {
  const { batchId, paths, to, subject, coverIncluded, coverTo } = args;
  const includeCover = coverIncluded !== false;
  const safeCoverTo = (coverTo || "").slice(0, 120).replace(/[\r\n]+/g, " ").trim();

  if (!batchId || typeof batchId !== "string" || !/^[a-zA-Z0-9_-]{4,64}$/.test(batchId)) {
    throw new Error("Invalid batchId");
  }
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_FILES) {
    throw new Error(`paths must have 1-${MAX_FILES} entries`);
  }
  const prefix = `admin/outbound-faxes/${batchId}/`;
  for (const p of paths) {
    if (typeof p !== "string" || !p.startsWith(prefix)) {
      throw new Error("path outside batch prefix");
    }
  }
  const toNormalized = normalizeFaxNumber(to || "");
  const safeSubject = (subject || "").slice(0, 200).replace(/[\r\n]+/g, " ");

  // Pull routing from the admin-managed integration doc first (projectId
  // + spaceUrl + auth token via Secret Manager), falling back to the
  // legacy per-secret Secret Manager entries for forks that haven't
  // migrated.
  const { loadSignalwireConfig } = await import("./signalwire-config.js");
  const cfg = await loadSignalwireConfig();
  const swProjectId = cfg?.projectId || (await readSecret("SIGNALWIRE_PROJECT_ID"));
  const swAuthToken = cfg?.authToken || (await readSecret("SIGNALWIRE_AUTH_TOKEN"));
  const swSpaceUrl = (cfg?.spaceUrl || (await readSecret("SIGNALWIRE_SPACE_URL"))).replace(/\/+$/, "");

  const bucket = admin.storage().bucket();

  // Download + merge PDFs.
  const merged = await PDFDocument.create();
  let totalBytes = 0;
  for (const p of paths) {
    const [buf] = await bucket.file(p).download();
    totalBytes += buf.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Total upload exceeds 20MB");
    if (buf.length < 4 || buf.subarray(0, 4).toString("ascii") !== "%PDF") {
      throw new Error(`Not a PDF: ${p}`);
    }
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const pg of pages) merged.addPage(pg);
  }

  const outboundFrom = await getOutboundFaxFrom();
  if (includeCover) {
    const totalPages = merged.getPageCount() + 1;
    const coverBytes = await buildCoverPagePdf({
      senderName: await getPracticeName(),
      senderFax: outboundFrom,
      toName: safeCoverTo,
      toFax: toNormalized,
      subject: safeSubject,
      totalPages,
      date: new Date(),
    });
    const coverDoc = await PDFDocument.load(coverBytes);
    const [coverPage] = await merged.copyPages(coverDoc, [0]);
    merged.insertPage(0, coverPage);
  }

  const mergedBytes = Buffer.from(await merged.save());
  const mergedPath = `admin/outbound-faxes/${batchId}/merged.pdf`;
  await bucket.file(mergedPath).save(mergedBytes, {
    contentType: "application/pdf",
    metadata: { metadata: { batchId, submittedBy } },
  });

  const [mediaUrl] = await bucket.file(mergedPath).getSignedUrl({
    action: "read",
    expires: Date.now() + 24 * 60 * 60 * 1000,
  });

  const region = process.env.FUNCTION_REGION || "us-west1";
  const projectForUrl = projectId();
  const statusCallback = process.env.FAX_STATUS_CALLBACK_URL ||
    `https://${region}-${projectForUrl}.cloudfunctions.net/signalwireFaxStatusWebhook`;

  const form = new URLSearchParams({
    From: outboundFrom,
    To: toNormalized,
    MediaUrl: mediaUrl,
    Quality: "fine",
    StatusCallback: statusCallback,
  });
  const faxUrl = `${swSpaceUrl}/api/laml/2010-04-01/Accounts/${swProjectId}/Faxes.json`;
  const basicAuth = Buffer.from(`${swProjectId}:${swAuthToken}`).toString("base64");

  const res = await fetch(faxUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`SignalWire error ${res.status}: ${bodyText.slice(0, 200)}`);
  }

  const swJson = (await res.json()) as {
    sid: string;
    status: string;
    num_pages?: number | null;
    price?: string | null;
  };
  const faxSid = swJson.sid;

  await getDb().collection("outbound-faxes").doc(faxSid).set({
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
    submittedBy,
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: null,
  });

  return { ok: true, faxSid, status: swJson.status || "queued" };
}
