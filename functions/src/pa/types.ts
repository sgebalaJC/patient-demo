// Shared types for the Prior Authorization subsystem. Mirror of
// web/src/types/prior-auth.ts with Firestore Admin SDK Timestamp type.
// Kept in sync manually — any change here must also update the web copy.

import type {Timestamp} from "firebase-admin/firestore";

export type PayerType = "commercial" | "medicare" | "medicaid" | "medicare_advantage";

export type AdapterStatus =
  | "implemented"
  | "no_public_policy"
  | "login_gated"
  | "not_implemented";

export type PolicyStatus =
  | "active"
  | "pending_review"
  | "stale"
  | "broken"
  | "no_public_policy";

export interface CitationSpan {
  start: number;
  end: number;
  quote: string;
}

export interface ExtractedCriteria {
  requiredDiagnoses: {icd10: string; label?: string; citation: CitationSpan}[];
  requiredPriorTrials: {description: string; durationWeeks?: number; citation: CitationSpan}[];
  requiredDocumentation: {type: string; description: string; citation: CitationSpan}[];
  exclusions: {description: string; citation: CitationSpan}[];
  ageRestriction?: {minYears?: number; maxYears?: number; citation: CitationSpan};
  siteOfService: string[];
  frequencyLimit?: {timesPerPeriod: number; period: "year" | "month" | "lifetime"; citation: CitationSpan};
  modifiers: string[];
  narrativeSummary: string;
}

export interface PayerDoc {
  id: string;
  name: string;
  type: PayerType;
  state?: string;
  parent?: string;
  policyIndexUrl?: string;
  active: boolean;
  adapterStatus: AdapterStatus;
  adapterNotes?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PayerPolicyDoc {
  id: string;
  payerId: string;
  cptCode: string;
  sourceUrl: string;
  sourceHash: string;
  sourceContentType: string;
  sourceFetchedAt: Timestamp;
  sourceEffectiveDate?: Timestamp;
  sourceLastRevisedDate?: Timestamp;
  snapshotPath: string;
  rawTextPreview?: string;
  extractedCriteria?: ExtractedCriteria;
  extractionHash?: string;
  lastExtractedAt?: Timestamp;
  humanReviewedAt?: Timestamp;
  reviewedBy?: string;
  previousVersionId?: string;
  status: PolicyStatus;
  brokenReason?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FetchResult {
  bytes: Buffer;
  contentType: string;
  httpStatus: number;
  finalUrl: string;
}

export interface PolicyResolution {
  url: string;
  sourceName: string; // e.g. "Aetna CPB 0236", "Evolent CG 044 via RadMD"
  notes?: string;
}

// Each payer adapter implements this interface. Adapters live at
// functions/src/pa/adapters/<payer-id>.ts and self-describe via `meta`.
export interface PayerAdapter {
  readonly meta: {
    payerId: string;
    name: string;
    status: AdapterStatus;
    delegatedTo?: string; // e.g. "Evolent", "eviCore", "Carelon" when applicable
    reason?: string; // when status is not implemented/no_public_policy
    userAgent: string;
    requestDelayMs: number;
  };
  resolveUrl(cptCode: string): Promise<PolicyResolution | null>;
  fetch(url: string): Promise<FetchResult>;
  parseEffectiveDate(rawText: string, html?: string): Date | null;
  parseLastRevisedDate(rawText: string, html?: string): Date | null;
  extractPolicyBody(rawText: string, html?: string): string;
}

export type PriorAuthStatus =
  | "draft"
  | "submitted"
  | "pending"
  | "needs_info"
  | "peer_to_peer"
  | "approved"
  | "denied"
  | "appeal"
  | "cancelled";

export interface CriteriaChecklistItem {
  criterionId: string;
  category: "diagnosis" | "prior_trial" | "documentation" | "exclusion" | "age" | "site_of_service" | "frequency";
  description: string;
  met: boolean | null;
  evidence: string;
  chartRef?: string;
  confidence?: number;
  manuallyOverridden?: boolean;
}

export const TARGET_CPT_CODES = [
  "72148", // MRI lumbar spine without contrast
  "72146", // MRI thoracic spine without contrast
  "72141", // MRI cervical spine without contrast
  "70553", // MRI brain with and without contrast
  "74181", // MRI abdomen without contrast
  "77067", // Screening mammography
  "95810", // Polysomnography, sleep study
  "93880", // Duplex scan extracranial arteries
  "97110", // Therapeutic exercises PT
  "20610", // Arthrocentesis major joint
] as const;
