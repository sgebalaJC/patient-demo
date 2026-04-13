---
name: patient-documents
description: View patient documents and check required document completion status
user-invocable: true
---

# Patient Documents

View patient document metadata via the `admin-api` CLI (read-only).

## List documents

```bash
admin-api GET /documents/patient/PATIENT_ID
admin-api GET /documents/patient/PATIENT_ID?type=insurance_card_front
```

## Check required docs

```bash
admin-api GET /documents/patient/PATIENT_ID/status
```

Returns completion status for required documents (driver's license, insurance cards).

## Notes

- Read-only — uploads happen through the patient portal or admin UI
- Only metadata is returned, not file contents
