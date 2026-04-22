---
name: elation
description: Search patients and read/write records in the practice's Elation Health EHR. Generic pass-through to any Elation REST API endpoint.
user-invocable: true
---

# Elation Health EHR

Access to Elation's REST API via the `admin-api` CLI. Calls are
authenticated with the practice's OAuth token (auto-refreshed by the
sidecar — no credentials needed in your calls).

Requires the integration to be **enabled** in the admin Agent → Integrations
tab. If it's disabled or not authorized, all calls below return 403 with a
clear error message — surface that to the admin rather than retrying.

The practice can be connected to Elation's **sandbox** (test data) or
production — the sidecar routes to the right host based on the integration
config. Writes in sandbox never hit a real chart.

## Find a patient

```bash
# Elation patient search takes first_name / last_name / dob (underscores).
admin-api GET /elation/patients?first_name=John&last_name=Smith
admin-api GET /elation/patients?last_name=Smith&dob=1985-03-14
```

Responses use Elation's standard envelope:
`{count: N, next: url|null, previous: url|null, results: [...]}`.
Pagination follows `next`; the sidecar passes query strings through
untouched, so appending `?offset=...` works.

Each patient carries `id`, `first_name`, `last_name`, `dob`, `sex`,
`phones: [{phone, phone_type}]`, `emails: [{email}]`, `primary_physician`,
`caregiver_practice`.

### Get one patient

```bash
admin-api GET /elation/patients/<id>
```

## Appointments

```bash
# Appointments are scoped by from_date / to_date (ISO YYYY-MM-DD).
admin-api GET /elation/appointments?patient=<id>&from_date=2026-04-01&to_date=2026-04-30

admin-api GET /elation/appointments/<appt_id>

# Book an appointment. physician, patient, practice, and scheduled_date
# (ISO date-time) are required.
admin-api POST /elation/appointments '{
  "patient": 140254,
  "physician": 131074,
  "practice": 200,
  "scheduled_date": "2026-05-01T14:00:00-07:00",
  "duration": 30,
  "reason": "Follow-up"
}'
```

## Clinical data

```bash
admin-api GET /elation/problems?patient=<id>
admin-api GET /elation/medications?patient=<id>
admin-api GET /elation/allergies?patient=<id>
admin-api GET /elation/vitals?patient=<id>
admin-api GET /elation/non_visit_notes?patient=<id>
```

Elation's "Non-Visit Notes" are the right bucket for documenting phone
calls, messages, and other interactions that aren't tied to an
appointment. Visit notes attach to a specific appointment.

```bash
# Non-visit note (phone call documentation, etc.)
admin-api POST /elation/non_visit_notes '{
  "patient": 140254,
  "physician": 131074,
  "type": "nonvisit",
  "bullets": [
    {"category": "Chief Complaint", "text": "Phone call — ongoing low back pain"},
    {"category": "Plan", "text": "Order MRI L-spine"}
  ]
}'
```

## Generic API access

Any Elation endpoint works via `/elation/<path>` pass-through. POST /
PATCH / DELETE follow Elation's usual REST contract.

## Safety + clinical judgment

- **Verify the patient before any write.** Elation IDs are integers, not
  shared with any other EHR.
- Dates are **ISO (YYYY-MM-DD)**; date-times are ISO-8601 with timezone.
  Elation rejects non-ISO formats with a 400.
- **For new clinical-content writes** (problems, meds, notes):
  state the action in chat as you do it. **Pause and ask before** writes
  that materially alter the medical record.
- Elation rate-limits per OAuth app; the sidecar retries 429s up to 5
  times with exponential backoff.
