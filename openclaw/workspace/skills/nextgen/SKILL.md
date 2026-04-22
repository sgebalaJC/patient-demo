---
name: nextgen
description: Search patients and read/write records in the practice's NextGen Healthcare EHR. Generic pass-through to any NextGen REST API endpoint.
user-invocable: true
---

# NextGen Healthcare EHR

Access to NextGen's REST API via the `admin-api` CLI. Calls are
authenticated with the practice's OAuth token (auto-refreshed by the
sidecar — no credentials needed in your calls).

Requires the integration to be **enabled** in the admin Agent → Integrations
tab. If it's disabled or not authorized, calls below return 403 with a
clear error message — surface that to the admin rather than retrying.

The practice can be connected to NextGen's **sandbox** (test data) or
production tenant — the sidecar routes to the right host based on the
integration config.

## Find a patient

```bash
# NextGen person search. Parameters mirror the standard REST search model.
admin-api GET /nextgen/persons?firstName=John&lastName=Smith&dateOfBirth=1985-03-14

# Get a person by id
admin-api GET /nextgen/persons/<personId>
```

Person records are the entity that carries demographics. Clinical data
hangs off related resources (encounters, orders, allergies, etc.) keyed
by `personId`.

## Appointments

```bash
admin-api GET /nextgen/appointments?personId=<id>&startDate=2026-04-01&endDate=2026-04-30
admin-api GET /nextgen/appointments/<id>
```

## Clinical data

```bash
admin-api GET /nextgen/allergies?personId=<id>
admin-api GET /nextgen/medications?personId=<id>
admin-api GET /nextgen/problems?personId=<id>
admin-api GET /nextgen/encounters?personId=<id>
admin-api GET /nextgen/vitals?personId=<id>
```

## Generic API access

Any NextGen endpoint works via `/nextgen/<path>` pass-through. POST /
PATCH / DELETE follow NextGen's usual REST contract; many write paths
require elevated OAuth scopes granted at connect time.

## Safety + clinical judgment

- **Verify the patient before any write.** NextGen `personId` is a GUID
  string, unique to the tenant — never assume it maps across to another
  EHR's id.
- Dates are typically **ISO-8601 (YYYY-MM-DD)**; NextGen rejects
  non-ISO formats with a 400.
- **For new clinical-content writes**: state the action in chat as you do
  it. **Pause and ask before** writes that materially alter the medical
  record.
- NextGen rate-limits per practice tenant; the sidecar retries 429s up
  to 5 times with exponential backoff.
