/**
 * Shared fax schema bits used by both the real and sim fax routes so the
 * two modes stay in lockstep on what PATCH payloads are accepted.
 */

export const ALLOWED_INBOUND_PATCH_FIELDS = [
  "status",
  "extracted",
  "matchedPatient",
  "drchronoDocumentId",
  "aurelia",
  "emailDraft",
  "notes",
] as const;
