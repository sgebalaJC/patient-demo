---
name: intake-forms
description: Review patient intake forms — view submissions, approve, or send back with notes
user-invocable: true
---

# Intake Forms

Review and process intake forms via the `admin-api` CLI.

## List submitted

```bash
admin-api GET /intake-forms
admin-api GET /intake-forms?status=submitted
```

## View patient's form

```bash
admin-api GET /intake-forms/patient/PATIENT_ID
```

## Approve

```bash
admin-api POST /intake-forms/FORM_ID/approve '{}'
```

## Send back

```bash
admin-api POST /intake-forms/FORM_ID/send-back '{"reviewNotes":"Please complete the insurance section"}'
```

`reviewNotes` is required. Resets form to `in_progress` so the patient sees it again.

## Safety

- Review all sections before approving
- Keep review notes clear and patient-friendly
