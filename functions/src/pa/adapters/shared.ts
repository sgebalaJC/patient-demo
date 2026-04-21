// Shared helpers used by per-payer adapters: polite fetch with configurable
// User-Agent + delay, sha256 hashing, Cloud Storage persistence of raw
// snapshots, HTML-to-text, and PDF text extraction with pdfjs-dist.

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import {FUNCTIONS_BRANDING} from "../../branding.js";
import type {FetchResult} from "../types.js";

export const DEFAULT_USER_AGENT =
  `${FUNCTIONS_BRANDING.shortName}-Policy-Sync/1.0 (+${FUNCTIONS_BRANDING.portalUrl})`;

const lastCallPerHost = new Map<string, number>();

export async function politeFetch(
  url: string,
  opts: {userAgent?: string; requestDelayMs?: number; timeoutMs?: number} = {}
): Promise<FetchResult> {
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const delay = opts.requestDelayMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const host = new URL(url).host;
  const last = lastCallPerHost.get(host) ?? 0;
  const waitFor = last + delay - Date.now();
  if (waitFor > 0) await new Promise((r) => setTimeout(r, waitFor));
  lastCallPerHost.set(host, Date.now());

  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctl.signal,
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      bytes: buf,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      httpStatus: res.status,
      finalUrl: res.url || url,
    };
  } finally {
    clearTimeout(to);
  }
}

export function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Save raw fetched bytes to Cloud Storage. Path convention:
// pa-snapshots/{payerId}/{cptCode}/{sha256}.{ext}
export async function saveSnapshot(
  payerId: string,
  cptCode: string,
  bytes: Buffer,
  contentType: string
): Promise<{path: string; hash: string}> {
  const hash = sha256(bytes);
  const ext = contentType.includes("pdf") ? "pdf" : "html";
  const path = `pa-snapshots/${payerId}/${cptCode}/${hash}.${ext}`;
  const bucket = admin.storage().bucket();
  const file = bucket.file(path);
  const exists = (await file.exists())[0];
  if (!exists) {
    await file.save(bytes, {
      contentType,
      metadata: {
        cacheControl: "private, max-age=0, no-cache",
      },
    });
  }
  return {path, hash};
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|li|p|div|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\/?(td|th)[^>]*>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseMetaTag(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]+name=["']${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}["'][^>]*content=["']([^"']*)["']`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

export function parseDateLoose(s: string | null | undefined): Date | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;
  const m = trimmed.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const [, mm, dd, yy] = m;
    const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
    const dt = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10));
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

export async function extractPdfText(bytes: Buffer): Promise<string> {
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = (content.items as Array<{str?: string}>)
        .map((it) => it.str ?? "")
        .join(" ");
      pages.push(text);
    }
    return pages.join("\n\n").replace(/\s+\n/g, "\n").trim();
  } catch {
    return "";
  }
}

let _pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;
async function loadPdfjs() {
  if (_pdfjs) return _pdfjs;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as any;
  return _pdfjs!;
}
