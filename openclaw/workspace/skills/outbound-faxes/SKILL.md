---
name: outbound-faxes
description: Send PDFs via SignalWire with an optional cover sheet. One call takes the recipient fax number, the "to" person for the cover sheet, a subject, and one or more PDF sources.
user-invocable: true
---

# Outbound Faxes

Send faxes out of the practice's SignalWire line. The practice fax
number is read from `integrations/signalwire.faxNumber` (real mode) or
the sandbox (`GET /admin-api/faxes/our-number`, sim mode). Under the
hood the sidecar stages each source PDF into Cloud Storage, then a
Cloud Function merges them, optionally prepends a practice-letterhead
cover sheet, ships the combined document to SignalWire, and writes a
tracking row to `outbound-faxes/{faxSid}`.

In sim mode the entire pipeline writes to `simulation/faxes/outbound/*`
instead — nothing leaves the tenant and the admin sees the fake rows
in `/admin/faxes?tab=send`.

## Anatomy of a send

```bash
admin-api POST /admin-api/faxes/send '{
  "to": "+14155551212",
  "subject": "MRI results — patient Jane Doe, DOB 1985-03-14",
  "coverTo": "Brian Belnap, DO",
  "source": { "gcsPath": "inbound-faxes/FX123.pdf" }
}'
```

Response shape (sim mode today; real-path will match this once
migrated):

```json
{ "ok": true, "faxSid": "SIM-OUT-…", "status": "queued" }
```

## Required fields

- **to** — recipient fax number. E.164 or US 10-digit — sidecar normalizes.
- **coverTo** — the human's name as it appears on the cover (e.g.
  `"Brian Belnap, DO"`, `"Records Department"`). Required when the
  cover sheet is included (default).
- **source** *(or* **sources[]** *for multiple)* — exactly one of:
  - `gcsPath`: `gs://bucket/path` or a plain path under `inbound-faxes/`, `patients/`, `attachments/`
  - `url`: public `https://…` URL (SSRF-blocked: no localhost, no RFC1918, no metadata IPs)
  - `localPath`: a path inside the OpenClaw workspace (`/root/.openclaw/workspace/…`)

## Default behavior: **the cover sheet is ON**

The cover page prepends a practice-letterhead page with sender block,
**To:** `coverTo`, **Fax:** normalized recipient, **Subject:** whatever
you pass, **Pages:** dynamic count including the cover, and a
confidentiality footer.

Don't disable the cover unless the admin explicitly says so. If they
do, pass `"coverIncluded": false` and `coverTo` becomes optional.

## Sending multiple PDFs as one fax

Up to 10 source PDFs, total ≤ 20 MB after merge. They concatenate in
the order provided, with the cover sheet (if enabled) prepended to the
final document.

```bash
admin-api POST /admin-api/faxes/send '{
  "to": "(415) 555-1212",
  "coverTo": "Records, Sutter Health",
  "subject": "Records request for pt Jane Doe",
  "sources": [
    { "gcsPath": "inbound-faxes/FX_consent.pdf", "filename": "consent.pdf" },
    { "gcsPath": "patients/abc123/documents/labs/cbc-2026-04-12.pdf" }
  ]
}'
```

## Common source patterns

**Re-fax an inbound fax somewhere else:**

```bash
admin-api GET /admin-api/faxes/FX_ABCDEF
# → includes "pdfPath": "inbound-faxes/FX_ABCDEF.pdf"
admin-api POST /admin-api/faxes/send '{
  "to": "8885551212",
  "coverTo": "Dr. Nguyen, Radiology",
  "subject": "Forwarding inbound fax re: patient Smith",
  "source": { "gcsPath": "inbound-faxes/FX_ABCDEF.pdf" }
}'
```

**Fax a document already in DrChrono:** download it first via the
`drchrono` skill, stage to `/tmp/*.pdf` inside workspace, then send
with `"localPath"`. Or, if it's already a patient upload in GCS, use
the `patients/<uid>/documents/...` gcsPath directly.

**Fax something from a URL** (public, https-only):

```bash
admin-api POST /admin-api/faxes/send '{
  "to": "8885551212",
  "coverTo": "Billing — Anthem",
  "subject": "EOB dispute",
  "source": { "url": "https://example.com/eob.pdf", "filename": "eob.pdf" }
}'
```

## Tracking what happened

Every submission writes `outbound-faxes/{faxSid}` (real) or
`simulation/faxes/outbound/{faxSid}` (sim). SignalWire posts status
updates back (queued → sending → delivered / failed / busy / no-answer
/ canceled) and the row gets `completedAt` once terminal. The admin
UI at `/admin/faxes?tab=send` subscribes to the same collection live.

## Rules of engagement

- **Never send PHI faxes without the admin's explicit go-ahead.**
  Confirm the recipient + subject + which patient's document, then
  send. Don't auto-fax off a vague "can you forward that" — read it
  back first.
- **Patient identifiers belong on the cover, not floating in the
  subject.** Example good subject: `"Records request for pt Jane Doe,
  DOB 1985-03-14"`.
- **Do not disable the cover sheet silently.** If the admin says "just
  send the raw doc", echo back "sending without the cover sheet —
  confirmed?" and wait for a yes.
