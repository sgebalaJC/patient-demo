---
name: intake-forms
description: Review patient intake forms — view submissions, approve, or send back with notes
user-invocable: true
---

# Intake Forms

Review and process patient intake forms via the `admin-api` CLI.

## List submitted forms

```bash
admin-api GET /intake-forms
admin-api GET /intake-forms?status=submitted
admin-api GET /intake-forms?status=approved&limit=10
```

Statuses: `draft`, `in_progress`, `submitted`, `approved`.

## Patient's most recent form

```bash
admin-api GET /intake-forms/patient/PATIENT_ID
```

Returns the most recent form with all sections and data.

## Approve form

```bash
admin-api POST /intake-forms/FORM_ID/approve '{}'
```

## Send back for revision

```bash
admin-api POST /intake-forms/FORM_ID/send-back '{"reviewNotes":"Please complete the insurance section"}'
```

`reviewNotes` is required — tells the patient what to fix. This resets the
form to `in_progress` and clears the patient's skip flag so they see the
form again on next sign-in.

## Safety

- Review all sections before approving — incomplete forms should be sent
  back with specific guidance, not approved with a hope-the-rest-shows-up
  posture.
- `reviewNotes` is patient-visible; phrase them politely and constructively.
- Approval is irreversible from the agent side; if the admin needs to
  re-open an approved form they must do it through the admin UI.
