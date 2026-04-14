# Inbound Fax Ingestion (TODO — design stub)

Status: **not built** in this template. Prior art: implemented in the ShowMD fork (`BLASKO/patient-showmd`, feat commit `83c9f27` + follow-ups). This doc captures what to port when the feature is scoped.

## Why it matters

Medical practices still receive large volumes of clinical documents (labs, specialist notes, referrals, insurance auth letters) by fax. A practice using this portal + DrChrono needs a way to turn inbound PDFs into attached chart documents without manual printing/scanning. The admin AI agent is well-suited to extract sender/document type and propose a patient match.

## Flow (from ShowMD reference implementation)

```
SignalWire fax → webhook CF → GCS PDF → inbound-faxes/{sid}
                                          ↓
                                     Admin /admin/faxes
                                          ↓
                        Aurelia: Extract (AI) → Match (DrChrono) → Attach (DrChrono chart)
```

Three deliberately separate steps: extraction (AI-heavy, retriable), matching (deterministic lookup), attachment (side-effectful, admin-gated).

## Components to port

### 1. Cloud Functions

| Function | Purpose | Notes |
|----------|---------|-------|
| `signalwireFaxWebhook` (onRequest) | SignalWire POSTs here when a fax arrives. Verify `X-SignalWire-Signature` (SHA-1 HMAC, Twilio-compatible), download MediaUrl with basic auth, write PDF to `gs://<bucket>/incoming-faxes/{faxSid}/original.pdf`, create `inbound-faxes/{faxSid}` row. | Signature verification MUST hard-reject in production; only soft-fail during rollout. |
| `retryFailedFaxes` (onSchedule, every 5 min) | Exponential backoff retry: 5m → 15m → 1h → 4h → 24h (MAX_ATTEMPTS=5). Notifies admin on final failure. | Firestore indexes: `(status, receivedAt desc)` and `(status, nextRetryAt asc)`. |
| `attachFaxToDrChrono` (onCall) | Idempotent upload. Reads matched DrChrono patient id, calls sidecar `/admin-api/drchrono-attach` with the GCS path, records `drchronoDocumentId` back on the fax row. | Requires the DrChrono integration (already built) to be enabled. |
| `detachFaxFromDrChrono` (onCall) | Reverse for re-testing. | Admin-only. |
| `getFaxPdfUrl` (onCall) | Returns a signed URL (15 min expiry) for the admin UI to preview the PDF. | |
| `sendFaxEmail` (onCall) | Forwards extracted summary + PDF attachment to an external address (e.g. the ordering provider). Uses Gmail API via SA domain-wide delegation. | Optional; depends on Google Workspace integration being connected. |
| `updateFaxDraft`, `reprocessFax`, `markFaxJunk`, `deleteFax` | Lifecycle management. | |

### 2. Sidecar additions

- New helper in `sidecar/src/lib/drchrono.ts`: `uploadFileToDrChrono({gcsPath, url, localPath, patient, description, ...})` — already has the port-ready security hardening in the upstream working tree (see below).
- New admin-api case: `/admin-api/drchrono-attach` (and `/admin-api/fax-to-drchrono` if we want a high-level wrapper).

### 3. Firestore

**Collection:** `inbound-faxes/{faxSid}` (admin-only rules).

Schema (minimal):
```
{
  faxSid, receivedAt, from, to, pageCount, pdfPath, byteSize,
  status: pending | processing | needs_review | completed | failed,
  attempts, nextRetryAt, lastError,
  // AI extraction
  aurelia: { sessionId, summary, currentStep, confidence },
  extracted: { patientName, patientDob, documentType, senderProvider },
  // Match
  matchedPatient: { drchronoId, confidence },
  // Email (optional)
  emailMode, emailDraft, emailSent,
  // Audit
  reprocessHistory[], reviewedBy, updatedAt,
  drchronoDocumentId
}
```

Indexes: composite on `(status, receivedAt desc)` and `(status, nextRetryAt asc)`.

### 4. Admin UI

- New page: `web/src/pages/AdminFaxesPage.tsx` (`/admin/faxes`).
- Table filtered by status (all / pending / needs_review / completed / failed).
- Fullscreen drawer on row click: PDF preview + extracted fields + patient match state + status chips.
- Actions: **Process with Aurelia** (Extract + Match), **Attach to DrChrono**, **Send Email**, **Save Draft**, **Delete**.

### 5. Agent skills

One new skill (`openclaw/workspace/skills/fax-processing/SKILL.md`) teaching Aurelia the three-step extract-match-attach workflow, with guardrails:

- Never attach without an admin-confirmed patient match.
- Disambiguate on name collisions (always surface candidates, never guess).
- Use the existing `drchrono` skill for patient lookup, not a direct API call.

## Security hardening (MUST port — upstream has these in working tree)

The upstream ShowMD working tree has critical SSRF/OOM fixes that any port needs:

- **SSRF on URL fetch**: reject non-HTTPS, resolve DNS and block RFC1918/link-local/localhost/`.internal`/`.local`, IPv4-mapped IPv6, literal IPs resolving private. Especially important: **the GCE metadata IP `169.254.169.254` must be blocked** — sidecar runs on GCE and an attacker-controlled URL could exfiltrate SA tokens.
- **Local path lock**: reads restricted to `/root/.openclaw/workspace/**`. Blocks reads of SA keys, `.env`, metadata tokens staged on disk.
- **GCS path restrictions**: only project buckets allowed, path prefixes limited to `patients/`, `inbound-faxes/`, `attachments/`, block `..` traversal.
- **Size caps**: 50 MB per attachment, 500 MB cap on streamed downloads with Content-Length guard + byte-count enforcement during stream read.
- **PDF magic-byte check**: reject non-PDFs before uploading to DrChrono.
- **Filename sanitization**: regex whitelist `[\w\-. ]`, force `.pdf` extension.
- **Fetch `redirect: "error"`**: prevents redirect-based SSRF bypass.
- **Bun sidecar `idleTimeout: 255s`**: already applied in this repo for the DrChrono port — long uploads would otherwise fail with "Empty reply from server".
- **429 backoff with `Retry-After`**: 5-retry exponential, already ported for DrChrono proxy.
- **S3 URL detection**: DrChrono returns presigned S3 URLs in `document` fields — don't send a Bearer token to those (they 400-reject).
- **Webhook signature verification**: SHA-1 HMAC on `X-SignalWire-Signature` using signing key, not auth token. Never skip for production.

## Secrets

- `SIGNALWIRE_PROJECT_ID`
- `SIGNALWIRE_AUTH_TOKEN` (for MediaUrl basic auth)
- `SIGNALWIRE_SIGNING_KEY` (for webhook signature)

Grant access via `firebase functions:secrets:set NAME`.

## Dependencies

- DrChrono integration must be connected & enabled (already shipped — see `integrations/drchrono` and the `drchrono` agent skill).
- Optional: Google Workspace integration (for the "email this fax to a provider" action).

## Open design questions

- **Vendor-agnostic schema**: should `inbound-faxes` be generic enough to support Twilio/eFax later? The ShowMD schema mostly is — keep it that way.
- **Where does the extraction model run?** ShowMD routes through Aurelia (OpenClaw agent). We can do the same, but it means a running sidecar + agent during ingestion. An always-on Cloud Function alternative (e.g. Gemini) could decouple fax ingestion from the agent host.
- **Multi-EHR**: the attach step is DrChrono-specific. If we add other EHR integrations, abstract to `attachToEhr(integrationId, ...)`.
- **Patient auto-creation**: ShowMD originally had a DrChrono webhook that auto-created concierge patients (removed in `4a0981b`). Do we want this or stay pure outbound?
