import type { Timestamp } from 'firebase/firestore';

export type PayerType = 'commercial' | 'medicare' | 'medicaid' | 'medicare_advantage';

export interface Payer {
  id: string;
  name: string;
  type: PayerType;
  state?: string;
  parent?: string;
  policyIndexUrl?: string;
  active: boolean;
  adapterStatus: 'implemented' | 'no_public_policy' | 'login_gated' | 'not_implemented';
  adapterNotes?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CitationSpan {
  start: number;
  end: number;
  quote: string;
}

export interface RequiredDiagnosis {
  icd10: string;
  label?: string;
  citation: CitationSpan;
}

export interface RequiredPriorTrial {
  description: string;
  durationWeeks?: number;
  citation: CitationSpan;
}

export interface RequiredDocumentation {
  type: string;
  description: string;
  citation: CitationSpan;
}

export interface Exclusion {
  description: string;
  citation: CitationSpan;
}

export interface AgeRestriction {
  minYears?: number;
  maxYears?: number;
  citation: CitationSpan;
}

export interface FrequencyLimit {
  timesPerPeriod: number;
  period: 'year' | 'month' | 'lifetime';
  citation: CitationSpan;
}

export interface ExtractedCriteria {
  requiredDiagnoses: RequiredDiagnosis[];
  requiredPriorTrials: RequiredPriorTrial[];
  requiredDocumentation: RequiredDocumentation[];
  exclusions: Exclusion[];
  ageRestriction?: AgeRestriction;
  siteOfService: string[];
  frequencyLimit?: FrequencyLimit;
  modifiers: string[];
  narrativeSummary: string;
}

export type PolicyStatus =
  | 'active'
  | 'pending_review'
  | 'stale'
  | 'broken'
  | 'no_public_policy';

export interface PayerPolicy {
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

export interface PayerPolicySnapshot {
  id: string;
  payerId: string;
  cptCode: string;
  sourceUrl: string;
  sourceHash: string;
  snapshotPath: string;
  rawText: string;
  fetchedAt: Timestamp;
  httpStatus: number;
}

export interface TargetCpt {
  id: string;
  cptCode: string;
  label: string;
  specialty?: string;
  active: boolean;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PayerCandidate {
  id: string;
  carrierName: string;
  normalizedName: string;
  patientCount: number;
  sampleDrChronoIds: string[];
  suggestedPayerId?: string;
  createdAt: Timestamp;
}

export type PriorAuthStatus =
  | 'draft'
  | 'submitted'
  | 'pending'
  | 'needs_info'
  | 'peer_to_peer'
  | 'approved'
  | 'denied'
  | 'appeal'
  | 'cancelled';

export interface CriteriaChecklistItem {
  criterionId: string;
  category: 'diagnosis' | 'prior_trial' | 'documentation' | 'exclusion' | 'age' | 'site_of_service' | 'frequency';
  description: string;
  met: boolean | null;
  evidence: string;
  chartRef?: string;
  confidence?: number;
  manuallyOverridden?: boolean;
}

export interface PriorAuthNote {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: Timestamp;
}

export interface PriorAuthAttachment {
  name: string;
  path: string;
  contentType: string;
  size: number;
  uploadedAt: Timestamp;
  uploadedBy: string;
}

export interface PriorAuth {
  id: string;
  patientId: string;
  patientName: string;
  patientDob?: string;
  payerId: string;
  payerName: string;
  memberNumber?: string;
  groupNumber?: string;
  cptCode: string;
  procedureLabel: string;
  icd10Codes: string[];
  orderingProviderId?: string;
  orderingProviderName?: string;
  renderingProviderId?: string;
  renderingProviderName?: string;
  serviceDate?: Timestamp;
  status: PriorAuthStatus;
  referenceNumber?: string;
  authNumber?: string;
  authValidFrom?: Timestamp;
  authValidTo?: Timestamp;
  submittedAt?: Timestamp;
  approvedAt?: Timestamp;
  deniedAt?: Timestamp;
  denialReason?: string;
  assignedTo?: string;
  criteriaChecklist: CriteriaChecklistItem[];
  policyFreshness?: {
    policyId: string;
    sourceFetchedAt: Timestamp;
    humanReviewedAt?: Timestamp;
    status: PolicyStatus;
  };
  attachedDocuments: PriorAuthAttachment[];
  notes: PriorAuthNote[];
  needsFollowup: boolean;
  lastFollowupAt?: Timestamp;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type PriorAuthEventType =
  | 'created'
  | 'status_changed'
  | 'criteria_updated'
  | 'note_added'
  | 'document_attached'
  | 'chart_check_ran'
  | 'policy_refreshed'
  | 'followup_flagged';

export interface PriorAuthEvent {
  id: string;
  priorAuthId: string;
  type: PriorAuthEventType;
  actor: string;
  actorName?: string;
  data: Record<string, unknown>;
  timestamp: Timestamp;
}

export const PRIOR_AUTH_STATUS_LABEL: Record<PriorAuthStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  pending: 'Pending',
  needs_info: 'Needs info',
  peer_to_peer: 'Peer-to-peer',
  approved: 'Approved',
  denied: 'Denied',
  appeal: 'Appeal',
  cancelled: 'Cancelled',
};

export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = {
  active: 'Active',
  pending_review: 'Pending review',
  stale: 'Stale',
  broken: 'Broken',
  no_public_policy: 'No public policy',
};

export const POLICY_FRESHNESS_STALE_DAYS = 30;
export const POLICY_FRESHNESS_WARN_DAYS = 7;
export const PA_FOLLOWUP_DAYS = 5;
