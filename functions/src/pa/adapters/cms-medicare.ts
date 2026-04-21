// CMS Medicare via the public Coverage API at api.coverage.cms.gov. Unlike
// the other payers this is a real JSON API — still wrap it in the adapter
// shape so the fetcher pipeline is uniform. We synthesise a "document" from
// the API response (LCD + Billing Article + NCD, if related) and hash the
// JSON payload; change detection then works on semantic content rather than
// an arbitrary HTML render.
//
// California is Noridian JE jurisdiction. state_id=6. We hard-code the
// canonical LCD for each target CPT from the research brief; the fetcher
// verifies the CPT is still in the article's hcpc-code list before writing
// an active policy.

import type {PayerAdapter, PolicyResolution, FetchResult} from "../types.js";
import {DEFAULT_USER_AGENT, politeFetch, parseDateLoose} from "./shared.js";

const API_BASE = "https://api.coverage.cms.gov/v1";
const STATE_ID_CALIFORNIA = 6;

// CPT → { articleId, lcdId, ncdId? }. Verified for 72148 in research. The
// remaining entries are best-effort placeholders resolved by the nightly
// cron's `rebuildCptIndex()` path — if the combo doesn't contain the CPT
// the fetcher will mark the record broken and log for re-curation.
const CPT_TO_MEDICARE: Record<string, {articleId?: number; lcdId?: number; ncdId?: number; title: string}> = {
  "72148": {articleId: 57206, lcdId: 34220, ncdId: 177, title: "Lumbar MRI (JE)"},
  "72146": {ncdId: 177, title: "MRI (NCD 220.2)"},
  "72141": {ncdId: 177, title: "MRI (NCD 220.2)"},
  "70553": {ncdId: 177, title: "MRI (NCD 220.2)"},
  "74181": {ncdId: 177, title: "MRI (NCD 220.2)"},
  "77067": {ncdId: 79, title: "Screening Mammography (NCD 220.4)"},
  "95810": {ncdId: 77, title: "Polysomnography (NCD 240.4)"},
  "93880": {ncdId: 53, title: "Duplex Doppler (carotid)"},
  "97110": {title: "Outpatient Therapy Services"},
  "20610": {title: "Joint Injections (Part B)"},
};

// License-agreement token endpoint (CMS requires click-through acceptance
// for any /data/article/* or /data/lcd/* call). Token lives 1h.
let _token: {value: string; expiresAt: number} | null = null;
async function getToken(): Promise<string> {
  const now = Date.now();
  if (_token && _token.expiresAt > now + 60_000) return _token.value;
  const res = await fetch(`${API_BASE}/metadata/license-agreement/`, {
    method: "POST",
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      "Accept": "application/json",
    },
    body: JSON.stringify({accepted: true}),
  });
  if (!res.ok) throw new Error(`CMS license-agreement failed: ${res.status}`);
  const body = (await res.json()) as {access_token?: string; token?: string};
  const token = body.access_token ?? body.token;
  if (!token) throw new Error("CMS license-agreement returned no token");
  _token = {value: token, expiresAt: now + 55 * 60_000};
  return token;
}

async function cmsApi<T = unknown>(path: string, requireToken = true): Promise<T> {
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept": "application/json",
  };
  if (requireToken) {
    headers["Authorization"] = `Bearer ${await getToken()}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {headers});
  if (!res.ok) throw new Error(`CMS ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const cmsMedicareAdapter: PayerAdapter = {
  meta: {
    payerId: "cms-medicare",
    name: "CMS Medicare",
    status: "implemented",
    userAgent: DEFAULT_USER_AGENT,
    requestDelayMs: 1000,
  },

  async resolveUrl(cptCode: string): Promise<PolicyResolution | null> {
    const m = CPT_TO_MEDICARE[cptCode];
    if (!m) return null;
    // We return a canonical browsable URL for the record; the actual fetch
    // goes through the API and stuffs JSON into the snapshot.
    if (m.articleId) {
      return {
        url: `https://www.cms.gov/medicare-coverage-database/view/article.aspx?articleid=${m.articleId}`,
        sourceName: `Medicare Billing Article ${m.articleId}${m.lcdId ? ` (LCD ${m.lcdId})` : ""}`,
      };
    }
    if (m.ncdId) {
      return {
        url: `https://www.cms.gov/medicare-coverage-database/view/ncd.aspx?ncdid=${m.ncdId}`,
        sourceName: `Medicare NCD ${m.ncdId} — ${m.title}`,
      };
    }
    return null;
  },

  async fetch(url: string): Promise<FetchResult> {
    // Derive articleId / lcdId / ncdId from the browsable URL and build a
    // single JSON blob combining the available coverage documents. This
    // is what gets snapshotted and hashed for change detection.
    const articleMatch = url.match(/articleid=(\d+)/);
    const lcdMatch = url.match(/lcdid=(\d+)/);
    const ncdMatch = url.match(/ncdid=(\d+)/);

    // Deliberately NOT embedding a fetch timestamp here — the hash must be
    // stable across identical API responses so change-detection only fires
    // on real policy edits, not every cron tick.
    const bundle: Record<string, unknown> = {};

    if (articleMatch) {
      const articleId = parseInt(articleMatch[1], 10);
      bundle.article = await cmsApi(`/data/article/?articleid=${articleId}`);
      bundle.hcpcs = await cmsApi(`/data/article/hcpc-code?articleid=${articleId}&page_size=500`);
      bundle.icd10Covered = await cmsApi(
        `/data/article/icd10-covered?articleid=${articleId}&page_size=500`
      );
    }
    if (lcdMatch) {
      const lcdId = parseInt(lcdMatch[1], 10);
      bundle.lcd = await cmsApi(`/data/lcd/?lcdid=${lcdId}`);
    }
    if (ncdMatch) {
      const ncdId = parseInt(ncdMatch[1], 10);
      bundle.ncd = await cmsApi(`/data/ncd/?ncdid=${ncdId}`, false);
    }

    // Polite on the CMS API side too — one cluster of calls per CPT.
    await politeFetch("https://api.coverage.cms.gov/", {
      userAgent: this.meta.userAgent,
      requestDelayMs: this.meta.requestDelayMs,
      timeoutMs: 100,
    }).catch(() => null);

    const jsonStr = JSON.stringify(bundle, null, 2);
    return {
      bytes: Buffer.from(jsonStr, "utf8"),
      contentType: "application/json",
      httpStatus: 200,
      finalUrl: url,
    };
  },

  parseEffectiveDate(rawText: string): Date | null {
    try {
      const json = JSON.parse(rawText);
      const iso =
        json.article?.article_eff_date ??
        json.lcd?.orig_det_eff_date ??
        json.ncd?.effective_date;
      return parseDateLoose(iso);
    } catch {
      return null;
    }
  },

  parseLastRevisedDate(rawText: string): Date | null {
    try {
      const json = JSON.parse(rawText);
      const iso =
        json.article?.last_updated ??
        json.article?.rev_eff_date ??
        json.lcd?.rev_eff_date ??
        json.lcd?.last_updated ??
        json.ncd?.last_updated;
      return parseDateLoose(iso);
    } catch {
      return null;
    }
  },

  extractPolicyBody(rawText: string): string {
    // Fold the JSON bundle into a plaintext representation that preserves
    // the key clinical content for extraction. Double-decode the
    // HTML-in-HTML fields CMS ships on `indications_limitations`.
    try {
      const json = JSON.parse(rawText);
      const parts: string[] = [];
      if (json.article) {
        const a = json.article;
        parts.push(`Title: ${a.article_title ?? ""}`);
        parts.push(`Effective: ${a.article_eff_date ?? ""}`);
        parts.push(`Last Updated: ${a.last_updated ?? ""}`);
        if (a.description) parts.push(`Description: ${decodeTwice(a.description)}`);
        if (a.article_text) parts.push(`Article Text: ${decodeTwice(a.article_text)}`);
        if (a.cms_cov_policy) parts.push(`Coverage Policy: ${decodeTwice(a.cms_cov_policy)}`);
        if (a.associated_info) parts.push(`Associated Info: ${decodeTwice(a.associated_info)}`);
      }
      if (json.lcd) {
        const l = json.lcd;
        parts.push(`LCD Title: ${l.document_title ?? ""}`);
        if (l.indication) parts.push(`Indication: ${decodeTwice(l.indication)}`);
        if (l.indications_limitations) parts.push(`Indications/Limitations: ${decodeTwice(l.indications_limitations)}`);
        if (l.doc_reqs) parts.push(`Documentation Requirements: ${decodeTwice(l.doc_reqs)}`);
      }
      if (json.ncd) {
        const n = json.ncd;
        parts.push(`NCD Title: ${n.ncd_title ?? ""}`);
        if (n.indication) parts.push(`NCD Indication: ${decodeTwice(n.indication)}`);
        if (n.ind_lim) parts.push(`NCD Indications/Limitations: ${decodeTwice(n.ind_lim)}`);
      }
      const hcpcs = (json.hcpcs?.data ?? json.hcpcs?.results ?? []) as Array<{hcpc_code_id?: string}>;
      if (hcpcs.length) {
        parts.push("HCPCS covered: " + hcpcs.slice(0, 50).map((h) => h.hcpc_code_id).filter(Boolean).join(", "));
      }
      const icd = (json.icd10Covered?.data ?? json.icd10Covered?.results ?? []) as Array<{code?: string; description?: string}>;
      if (icd.length) {
        parts.push("ICD-10 covered (first 50): " + icd.slice(0, 50).map((i) => i.code).filter(Boolean).join(", "));
      }
      return parts.join("\n\n");
    } catch {
      return rawText;
    }
  },
};

function decodeTwice(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const CMS_MEDICARE_CPT_MAP = CPT_TO_MEDICARE;
export const CMS_STATE_ID_CA = STATE_ID_CALIFORNIA;
