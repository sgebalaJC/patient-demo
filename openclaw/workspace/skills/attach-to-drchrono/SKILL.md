---
name: attach-to-drchrono
description: Attach a PDF to a DrChrono patient's chart by name. Always match the patient first and confirm with the admin before uploading.
user-invocable: true
---

# Attach to DrChrono

Use this skill when the admin asks to put a PDF into a patient's DrChrono
chart. The workflow is **always three steps**: **search → confirm → upload**.
Never skip the confirmation — uploads land in the permanent medical record.

## Step 1 — Match the patient by name

```bash
admin-api GET /drchrono/patients?first_name=John&last_name=Smith
```

DrChrono's search is **prefix-match**, so results may include more than the
obvious person. If the admin gave a date of birth, narrow it:

```bash
admin-api GET /drchrono/patients?first_name=John&last_name=Smith&date_of_birth=1985-03-14
```

Outcomes:

- **0 results** → tell the admin no match was found; ask for a different
  spelling, a DOB, or a middle name.
- **1 result** → continue to Step 2 with that candidate.
- **Multiple results** → surface **all** candidates (name, DOB, email, last
  appointment if available). Do **not** guess.

## Step 2 — Confirm with the admin

Before calling `/drchrono-attach`, always show the admin:

- Patient full name + DOB + DrChrono ID
- The file you're about to attach (path / URL / name)
- The `description` the document will be filed under
- Any `metatags` you plan to set

Wait for an explicit "yes" or equivalent. If the admin hedges ("maybe",
"I think so"), ask again. If they say no or pick a different candidate,
loop back to Step 1.

## Step 3 — Upload

In sim mode the sidecar exposes this at `POST /admin-api/faxes/to-drchrono`.
In real mode the actual upload still runs through the Cloud Functions
callable `attachFaxToDrChrono` — the sidecar path is not wired up yet.
Payload shape is the same either way:

```bash
admin-api POST /faxes/to-drchrono '{
  "patient": 12345678,
  "description": "Lab results — CBC panel — 2026-04-14",
  "localPath": "/root/.openclaw/workspace/uploads/cbc_panel.pdf",
  "metatags": ["Lab Results"]
}'
```

### File source — pick exactly one

- `localPath` — absolute path to a PDF **inside the OpenClaw workspace**
  (`/root/.openclaw/workspace/...`). Paths outside the workspace are
  rejected. If the admin hands you a file elsewhere, copy or move it into
  the workspace first.
- `url` — public **https** URL to a PDF. Private/internal hosts (localhost,
  RFC1918, link-local, `.internal`, `.local`) are rejected.
- `gcsPath` — `gs://<project>.firebasestorage.app/<path>` or a plain object
  path. Allowed prefixes: `patients/`, `incoming-faxes/`, `attachments/`.

All sources are capped at 50 MB and must be a valid PDF (`%PDF` magic bytes).

### Other fields

- `patient` *(required)* — DrChrono patient ID (the numeric `id` from Step 1).
- `description` *(required)* — what the chart will show. Keep it short and
  specific: document type + topic + date.
- `metatags` *(optional)* — array of strings DrChrono uses for filtering
  (e.g. `["Lab Results"]`, `["Referral"]`, `["Imaging"]`).
- `filename` *(optional)* — pretty filename shown on download; `.pdf` is
  appended automatically. Only `A-Za-z0-9._- ` are allowed; everything else
  gets replaced with `_`.
- `doctor` *(optional)* — defaults to the OAuth'd doctor ID.
- `date` *(optional)* — `YYYY-MM-DD`, defaults to today.

### Response

```json
{ "ok": true, "documentId": 987654 }
```

On failure: `{ "ok": false, "error": "..." }`. Report the exact error back
to the admin — don't silently retry.

## Safety

- **Never upload to a patient you haven't confirmed.** If you're even
  slightly unsure which person is the right one, ask.
- **Never upload PHI to the wrong chart.** A misfiled document is a
  reportable privacy event, not a cleanup task.
- Uploads are effectively irreversible — DrChrono allows delete, but the
  audit trail remains.
- DrChrono's inline PDF preview sometimes shows "Unable to load document"
  on fresh uploads; this is a known viewer bug. The file downloads correctly.
