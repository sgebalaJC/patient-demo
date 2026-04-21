// Aetna Clinical Policy Bulletins (CPBs). Static server-rendered HTML,
// robots.txt permits /cpb/medical/data/**. The CPT → CPB mapping is not
// discoverable from any API — we maintain a hand-curated map below, seeded
// from the research brief. Update this map when the monthly CPB update
// bulletin shows a relevant change. Each CPB page exposes effective/revised
// dates in <meta> tags, and the CPT appears in tables under cptCode class.

import type {PayerAdapter, PolicyResolution, FetchResult} from "../types.js";
import {
  politeFetch,
  htmlToText,
  parseMetaTag,
  parseDateLoose,
  DEFAULT_USER_AGENT,
} from "./shared.js";

// CPT → Aetna CPB number(s). First entry is the primary (most relevant
// "covered if selection criteria are met") CPB. Verified against Aetna's
// published CPBs during research — revisit if an Aetna CPB update bulletin
// announces a change to any listed topic.
const CPT_TO_CPB: Record<string, string[]> = {
  "72148": ["0236"], // MRI/CT of the Spine
  "72146": ["0236"], // MRI/CT of the Spine
  "72141": ["0236"], // MRI/CT of the Spine
  "70553": ["0142"], // MRI/CT of the Head and Neck (brain)
  "74181": ["0018"], // Abdominal Imaging (MRI abdomen falls under imaging CPBs)
  "77067": ["0584"], // Screening mammography
  "95810": ["0004"], // Obstructive Sleep Apnea in Adults (polysomnography)
  "93880": ["0030"], // Carotid duplex ultrasound
  "97110": ["0325"], // Physical therapy
  "20610": ["0523"], // Viscosupplementation / joint injections
};

function cpbUrl(cpbNumber: string): string {
  const n = parseInt(cpbNumber, 10);
  const bucketLow = Math.floor(n / 100) * 100;
  const bucketHigh = bucketLow + 99;
  const range = bucketLow === 0 ? "1_99" : `${bucketLow}_${bucketHigh}`;
  const padded = cpbNumber.padStart(4, "0");
  return `https://www.aetna.com/cpb/medical/data/${range}/${padded}.html`;
}

// Kept as a real adapter (with working CPB 0236 URL resolution + HTML
// parsing) for the day we have egress that bypasses Incapsula, but
// meta.status is `not_implemented` until then so the fetcher skips it and
// the Policy Library surfaces a manual-lookup banner to coordinators.
// Confirmed blocked from Google Cloud us-central1 + dev-machine egress
// on 2026-04-20 — Incapsula challenge page on every fetch.
export const aetnaAdapter: PayerAdapter = {
  meta: {
    payerId: "aetna-commercial",
    name: "Aetna Commercial",
    status: "not_implemented",
    reason: "Aetna's Incapsula/Imperva WAF blocks both Cloud Function egress and our dev networks. Adapter code is production-ready (URL resolution, HTML parsing, CPT→CPB map) and will re-enable once we have a non-blocked egress path (residential proxy or Availity-gated API).",
    userAgent: DEFAULT_USER_AGENT,
    requestDelayMs: 2000,
  },

  async resolveUrl(cptCode: string): Promise<PolicyResolution | null> {
    const cpbs = CPT_TO_CPB[cptCode];
    if (!cpbs || cpbs.length === 0) return null;
    const cpb = cpbs[0];
    return {
      url: cpbUrl(cpb),
      sourceName: `Aetna CPB ${cpb}`,
      notes: cpbs.length > 1 ? `Also covered by CPB ${cpbs.slice(1).join(", ")}` : undefined,
    };
  },

  async fetch(url: string): Promise<FetchResult> {
    const res = await politeFetch(url, {
      userAgent: this.meta.userAgent,
      requestDelayMs: this.meta.requestDelayMs,
    });
    // Aetna is fronted by Incapsula/Imperva WAF which returns a ~100-byte
    // "Request unsuccessful. Incapsula incident ID …" challenge page to
    // non-allow-listed IPs (including Google Cloud egress). Detect and
    // surface as an HTTP-level failure so the fetcher marks the record
    // broken with a useful reason rather than storing the challenge body.
    const sample = res.bytes.subarray(0, 400).toString("utf8");
    if (sample.includes("Incapsula incident ID") || (res.bytes.length < 200 && /Request unsuccessful/i.test(sample))) {
      return {
        ...res,
        httpStatus: 503,
      };
    }
    return res;
  },

  parseEffectiveDate(_rawText: string, html?: string): Date | null {
    if (!html) return null;
    // Sidebar "Effective:  MM/DD/YYYY"
    const effMatch = html.match(/Effective[^\d]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    return parseDateLoose(effMatch?.[1]);
  },

  parseLastRevisedDate(_rawText: string, html?: string): Date | null {
    if (!html) return null;
    const meta = parseMetaTag(html, "aet.lastReviewDate");
    if (meta) return parseDateLoose(meta);
    const m = html.match(/Last Review[^\d]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    return parseDateLoose(m?.[1]);
  },

  extractPolicyBody(_rawText: string, html?: string): string {
    if (!html) return _rawText;
    // Isolate the policy section (between <a id="policy"> and <a id="codes">
    // or <a id="background">). Falls back to full-page text if anchors are
    // absent so extraction still has material to work with.
    const policyStart = html.search(/<a\s+[^>]*id=["']policy["']/i);
    const codesStart = html.search(/<a\s+[^>]*id=["']codes["']/i);
    const backgroundStart = html.search(/<a\s+[^>]*id=["']background["']/i);
    const end = Math.min(
      ...[codesStart, backgroundStart].filter((n) => n > 0).concat([html.length])
    );
    if (policyStart >= 0 && end > policyStart) {
      return htmlToText(html.slice(policyStart, end));
    }
    return htmlToText(html);
  },
};

export const AETNA_CPT_TO_CPB = CPT_TO_CPB;
