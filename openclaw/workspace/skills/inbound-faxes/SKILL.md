---
name: inbound-faxes
description: Read, update, and process inbound faxes received via SignalWire. Operates on the `inbound-faxes` Firestore collection via the sidecar admin-api.
user-invocable: true
---

# Inbound Faxes

Faxes arriving at the practice fax number are captured by the SignalWire
webhook, stored as PDFs in Cloud Storage, and tracked in the
`inbound-faxes` Firestore collection. Admins review them at
`/admin/faxes`. Each row carries extracted data, a patient match, a
DrChrono document ID, and an email draft.

> The practice fax number is read from `integrations/signalwire.faxNumber`
> (real mode) or the sandbox (`GET /admin-api/faxes/our-number`, sim
> mode). Never hard-code it in skill output.

## List pending / by status

```bash
admin-api GET /admin-api/faxes/inbound
```

The response is a `{results: [...]}` envelope. Filter client-side on
`status` — allowed values: `pending`, `processing`, `needs_review`,
`completed`, `failed`.

## Read one fax

```bash
admin-api GET /admin-api/faxes/FAX_SID
```

Returns `receivedAt`, `from`, `to`, `pageCount`, `pdfPath`, `status`,
`extracted`, `matchedPatient`, `drchronoDocumentId`, `aurelia`,
`emailDraft`, `emailSent`.

## Update extraction / draft / status

```bash
admin-api PATCH /admin-api/faxes/FAX_SID '{
  "status": "needs_review",
  "extracted": {
    "patientName": "John Smith",
    "patientDob": "1985-03-14",
    "documentType": "Lab Results",
    "senderProvider": "Quest Diagnostics"
  },
  "matchedPatient": {
    "drchronoId": 12345678,
    "confidence": "exact"
  },
  "drchronoDocumentId": 987654,
  "aurelia": {
    "summary": "Your recent blood work is in. All values look normal …",
    "summaryForAdmin": "CBC panel 2026-04-13 from Quest. WBC 6.2, Hgb 14.1 …",
    "currentStep": "done",
    "confidence": 0.92
  },
  "emailDraft": {
    "to": "patient@example.com",
    "subject": "New document in your record",
    "body": "Hi John, …"
  }
}'
```

Allowed PATCH fields: `status`, `extracted`, `matchedPatient`,
`drchronoDocumentId`, `aurelia`, `emailDraft`, `notes`.

## End-to-end workflow (when admin says "process fax X")

1. **Read the fax row** — `admin-api GET /admin-api/faxes/FAX_SID` to
   see what's already done. If `drchronoDocumentId` is set, the upload
   was already done — skip step 5.
2. **Normalize the file to JPG(s)**, branching on the real MIME type so
   the same flow works for PDFs *and* image faxes (PNG, JPG, TIFF,
   etc.). Don't trust the file extension — check it:
   ```bash
   case "$(file --mime-type -b "$FAX_FILE")" in
     application/pdf)
       pdftoppm -jpeg -r 150 -f 1 -l 3 "$FAX_FILE" /tmp/fax-page ;;
     image/jpeg)
       cp "$FAX_FILE" /tmp/fax-page-1.jpg ;;
     image/png|image/webp|image/gif|image/tiff|image/bmp)
       convert "$FAX_FILE" /tmp/fax-page-%d.jpg ;;
     *) echo "Unsupported media type" >&2; exit 1 ;;
   esac
   ```
   Read each `/tmp/fax-page-*.jpg` with your vision tool. Extract:
   - Patient full name (first, last)
   - Date of birth if shown
   - Document type (lab, imaging, referral, clinical note, etc.)
   - Sending provider / clinic name
3. **Write a patient-friendly summary** (2-3 sentences, plain English,
   no jargon) for the `aurelia.summary` field.
4. **Search the EHR** — use the `drchrono` skill (or whichever EHR the
   practice is configured for):
   ```bash
   admin-api GET /admin-api/drchrono/patients?first_name=John&last_name=Smith
   ```
   If DOB is known, narrow client-side. If 0 or >1 matches and no DOB
   to disambiguate, set `matchedPatient.confidence` to `none` or
   `ambiguous` and STOP — do not upload.
5. **Upload to the EHR** (only on confident match) — use
   `/admin-api/faxes/to-drchrono` (sim-only at this layer today; real
   uploads still route through the Cloud Functions callable
   `attachFaxToDrChrono`). Payload shape is the same:
   ```bash
   admin-api POST /admin-api/faxes/to-drchrono '{
     "faxSid": "FAX_SID",
     "patient": 12345678,
     "description": "Quest CBC panel — normal",
     "metatags": ["Inbound Fax", "Lab Results"]
   }'
   ```
6. **Generate email draft** — subject like "New document in your
   record", body uses your `aurelia.summary`, addressed to the
   patient's email (look up via `admin-api GET /admin-api/patients?search=LASTNAME`
   if needed).
7. **PATCH the fax row** with `status: "needs_review"`, the extracted
   data, matched patient, DrChrono document ID, Aurelia summary, and
   email draft. The admin reviews and clicks Send in the UI.

## Safety

- **Never send the patient email directly** — always leave
  `status: "needs_review"` so the admin reviews the draft first.
- **No PHI in logs or chat summaries** — acknowledge the fax was
  processed, but don't paste patient names, DOBs, or clinical details
  into chat history. The extracted data belongs in the fax row, not
  the transcript.
- **When unsure about patient match**, always set `confidence:
  "ambiguous"` or `"none"` and surface the candidates to the admin.
  Never guess.
- **Retry-safe:** operations are idempotent if `drchronoDocumentId` is
  already set (upload is skipped). Running the workflow twice won't
  duplicate the chart document.
