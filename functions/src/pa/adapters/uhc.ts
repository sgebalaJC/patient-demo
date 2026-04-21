// UnitedHealthcare publishes commercial medical policies as public PDFs
// under uhcprovider.com/content/dam/provider/docs/public/policies/
// comm-medical-drug/. MRI medical-necessity for spine imaging is delegated
// to eviCore; UHC only re-publishes the "Ohio Adult Spine Imaging
// Guidelines" (CSRAD014OH) under prior-auth/radiology/Ohio-Radiology/, but
// the clinical text applies broadly. Filenames rotate by effective date —
// the resolver uses the current known filename; when UHC rev's a doc the
// fetcher returns 404 and we mark the record broken so it's queued for
// manual re-curation.

import type {PayerAdapter, PolicyResolution, FetchResult} from "../types.js";
import {DEFAULT_USER_AGENT, politeFetch, parseDateLoose, extractPdfText} from "./shared.js";

const CPT_TO_URL: Record<string, {url: string; sourceName: string}> = {
  "72148": {
    url: "https://www.uhcprovider.com/content/dam/provider/docs/public/prior-auth/radiology/Ohio-Radiology/2026/UN-CSRAD014OH-E-Adult-Spine-02-2026.pdf",
    sourceName: "UHC Adult Spine Imaging Guidelines (CSRAD014OH.E)",
  },
  "72146": {
    url: "https://www.uhcprovider.com/content/dam/provider/docs/public/prior-auth/radiology/Ohio-Radiology/2026/UN-CSRAD014OH-E-Adult-Spine-02-2026.pdf",
    sourceName: "UHC Adult Spine Imaging Guidelines (CSRAD014OH.E)",
  },
  "72141": {
    url: "https://www.uhcprovider.com/content/dam/provider/docs/public/prior-auth/radiology/Ohio-Radiology/2026/UN-CSRAD014OH-E-Adult-Spine-02-2026.pdf",
    sourceName: "UHC Adult Spine Imaging Guidelines (CSRAD014OH.E)",
  },
  "70553": {
    url: "https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/mri-ct-scan-site-of-service.pdf",
    sourceName: "UHC MRI/CT Site of Service",
  },
  "74181": {
    url: "https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/mri-ct-scan-site-of-service.pdf",
    sourceName: "UHC MRI/CT Site of Service",
  },
  "77067": {
    url: "https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/preventive-care-services.pdf",
    sourceName: "UHC Preventive Care Services",
  },
};

export const uhcAdapter: PayerAdapter = {
  meta: {
    payerId: "uhc-commercial",
    name: "UnitedHealthcare Commercial",
    status: "implemented",
    userAgent: DEFAULT_USER_AGENT,
    requestDelayMs: 2000,
  },

  async resolveUrl(cptCode: string): Promise<PolicyResolution | null> {
    const m = CPT_TO_URL[cptCode];
    if (!m) return null;
    return {url: m.url, sourceName: m.sourceName};
  },

  async fetch(url: string): Promise<FetchResult> {
    return politeFetch(url, {
      userAgent: this.meta.userAgent,
      requestDelayMs: this.meta.requestDelayMs,
    });
  },

  parseEffectiveDate(rawText: string): Date | null {
    const m = rawText.match(/Effective\s+Date[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
    return parseDateLoose(m?.[1]);
  },

  parseLastRevisedDate(rawText: string): Date | null {
    const m = rawText.match(/(?:Last Reviewed|Revision|Last Updated)[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
    return parseDateLoose(m?.[1]);
  },

  extractPolicyBody(rawText: string): string {
    // UHC PDFs have a rigid template: Coverage Rationale → Applicable Codes
    // → Description → Clinical Evidence. The medically-necessary criteria
    // live in Coverage Rationale — slice there through Applicable Codes or
    // Description to keep extraction focused.
    const start = rawText.search(/Coverage\s+Rationale/i);
    const codes = rawText.search(/Applicable\s+Codes/i);
    const desc = rawText.search(/Description\s+of\s+Services/i);
    const candidates = [codes, desc].filter((n) => n > 0);
    const end = candidates.length ? Math.min(...candidates) : rawText.length;
    if (start >= 0 && end > start) {
      return rawText.slice(start, end).trim();
    }
    return rawText;
  },
};

// pdfText is a convenience used by the fetcher to produce plaintext for
// hashing and extraction; PDFs get hashed on the raw bytes, plaintext gets
// hashed separately for the extractedCriteria change signal.
export async function uhcPdfText(bytes: Buffer): Promise<string> {
  return extractPdfText(bytes);
}
