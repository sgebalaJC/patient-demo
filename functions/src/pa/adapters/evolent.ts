// Evolent Advanced Imaging Guidelines — the annual consolidated PDF
// hosted on radmd.com that Blue Shield of California and Health Net of
// California both delegate to for MRI/CT/MRA/PET prior-auth decisions
// (Evolent was previously National Imaging Associates / NIA — some docs
// still use the NIA name).
//
// The mega-PDF is ~500 pages; each guideline covers one body region
// (spine, brain, abdomen, chest, MSK, cardiac, pelvis, etc.) and enumerates
// the in-scope CPT codes at the top. Per target CPT we return the same
// source URL but a different `extractPolicyBody` slice anchored on the
// guideline's CPT list — so Firestore still has one record per
// (payer, cpt) pair the wizard can reason over.
//
// The same payer adapter shape is exported twice (BSC + Health Net) so the
// registry + seed treat them as distinct payers, even though both fetch
// the identical PDF. Snapshot dedup via sha256 in GCS means the bytes are
// only stored once per unique Evolent revision.

import type {PayerAdapter, PolicyResolution, FetchResult} from "../types.js";
import {DEFAULT_USER_AGENT, politeFetch, parseDateLoose, extractPdfText} from "./shared.js";

// Current-year Evolent Advanced Imaging Guidelines — resolved manually
// from https://www1.radmd.com/resources/clinical-guidelines-other-resources.
// When Evolent publishes the 2026 bundle, bump the URL here; the fetcher
// will detect the new sha256 and flag both payers' records pending_review.
const EVOLENT_PDF_URL =
  "https://www1.radmd.com/sites/default/files/2024-12/2025%20Evolent%20Advanced%20Imaging%20Guidelines-compressed_1.pdf";

// Which guidelines cover which CPT codes (from Evolent's published TOC +
// the per-guideline CPT lists at the top of each section). CG numbers
// follow Evolent's canonical naming; coordinators can cross-reference in
// the source doc.
const CPT_TO_CG: Record<string, {cg: string; topic: string}> = {
  "72148": {cg: "044", topic: "Lumbar Spine MRI"},
  "72146": {cg: "043", topic: "Thoracic Spine MRI"},
  "72141": {cg: "042", topic: "Cervical Spine MRI"},
  "70553": {cg: "001", topic: "Brain MRI"},
  "74181": {cg: "056", topic: "Abdomen MRI"},
  // 77067 mammography is NOT in Evolent's scope — covered by payer directly.
  // 95810 polysomnography — not imaging, skip.
  // 93880 carotid duplex — not in Evolent's advanced-imaging guidelines.
  // 97110 PT — not imaging.
  // 20610 joint injection — not imaging.
};

function buildAdapter(payerId: string, payerName: string): PayerAdapter {
  return {
    meta: {
      payerId,
      name: payerName,
      status: "implemented",
      delegatedTo: "Evolent",
      userAgent: DEFAULT_USER_AGENT,
      requestDelayMs: 3000,
    },

    async resolveUrl(cptCode: string): Promise<PolicyResolution | null> {
      const m = CPT_TO_CG[cptCode];
      if (!m) return null;
      return {
        url: EVOLENT_PDF_URL,
        sourceName: `Evolent CG ${m.cg} — ${m.topic} (via ${payerName})`,
      };
    },

    async fetch(url: string): Promise<FetchResult> {
      return politeFetch(url, {
        userAgent: this.meta.userAgent,
        requestDelayMs: this.meta.requestDelayMs,
        timeoutMs: 120_000, // the PDF is ~9 MB; allow room
      });
    },

    parseEffectiveDate(rawText: string): Date | null {
      // Evolent cover page: "Effective Date: January 1, 2025" or similar
      const m = rawText.match(/Effective\s+Date[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      return parseDateLoose(m?.[1]);
    },

    parseLastRevisedDate(rawText: string): Date | null {
      const m = rawText.match(/(?:Revised|Last\s+Reviewed|Revision\s+Date)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      return parseDateLoose(m?.[1]);
    },

    extractPolicyBody(rawText: string): string {
      // Each guideline starts with a header like "Guideline 044 — Lumbar
      // Spine MRI" on its own line. Anchor on the CG number, grab forward
      // until the next "Guideline NNN" marker or end of doc.
      // When the CG number isn't found (PDF layout drift), fall back to
      // anchoring on the CPT itself within a reasonable window.
      for (const cpt of Object.keys(CPT_TO_CG)) {
        const cg = CPT_TO_CG[cpt].cg;
        const startRe = new RegExp(`Guideline\\s*${cg}\\b`, "i");
        const start = rawText.search(startRe);
        if (start < 0) continue;
        const nextCgRe = /Guideline\s*\d{3}\b/gi;
        nextCgRe.lastIndex = start + 10;
        const next = nextCgRe.exec(rawText);
        const end = next ? next.index : Math.min(start + 20_000, rawText.length);
        // Only return this slice if it actually contains the CPT — otherwise
        // fall through to the generic search so we don't return the wrong
        // guideline for this record.
        const slice = rawText.slice(start, end);
        if (slice.includes(cpt)) {
          return slice.slice(0, 30_000);
        }
      }
      // Fallback: first 30k characters around whichever CPT appears.
      const anyCpt = Object.keys(CPT_TO_CG).find((c) => rawText.includes(c));
      if (!anyCpt) return rawText.slice(0, 30_000);
      const idx = rawText.indexOf(anyCpt);
      return rawText.slice(Math.max(0, idx - 2000), Math.min(rawText.length, idx + 28_000));
    },
  };
}

export const blueShieldCaAdapter = buildAdapter(
  "blue-shield-ca",
  "Blue Shield of California",
);

export const healthNetCaAdapter = buildAdapter(
  "health-net-ca",
  "Health Net (CA)",
);

// Re-export PDF text extraction for anyone wanting to run a one-off
// extraction batch over the cached mega-PDF.
export {extractPdfText as evolentPdfText};
