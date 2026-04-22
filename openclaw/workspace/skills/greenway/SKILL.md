---
name: greenway
description: Search patients and read/write records in the practice's Greenway Health EHR (Intergy or Prime Suite). Generic pass-through to Greenway's REST API.
user-invocable: true
---

# Greenway Health EHR

Access to Greenway's REST API via the `admin-api` CLI. Calls are
authenticated with the practice's OAuth token (auto-refreshed by the
sidecar — no credentials needed in your calls).

Requires the integration to be **enabled** in the admin Agent → Integrations
tab. If disabled or unauthorized, calls below return 403 — surface that
to the admin rather than retrying.

The practice can be connected to Greenway's **sandbox** or production
environment — sidecar routes to the right host based on the integration
config.

## Find a patient

```bash
admin-api GET /greenway/patients?firstName=John&lastName=Smith&dateOfBirth=1985-03-14
admin-api GET /greenway/patients/<patientId>
```

## Appointments

```bash
admin-api GET /greenway/appointments?patientId=<id>&startDate=2026-04-01&endDate=2026-04-30
admin-api GET /greenway/appointments/<id>
```

## Clinical data

```bash
admin-api GET /greenway/problems?patientId=<id>
admin-api GET /greenway/medications?patientId=<id>
admin-api GET /greenway/allergies?patientId=<id>
admin-api GET /greenway/encounters?patientId=<id>
```

## Generic API access

Any Greenway endpoint works via `/greenway/<path>` pass-through. POST /
PATCH / DELETE follow Greenway's usual REST contract; elevated scopes
must be granted at connect time.

## Safety + clinical judgment

- **Verify the patient before any write.** Greenway patient IDs are
  tenant-local — never assume they map across EHRs.
- Dates are **ISO (YYYY-MM-DD)**.
- Intergy and Prime Suite share an OAuth surface but the response shapes
  differ slightly between products — confirm the deployment before
  assuming a field exists.
- Greenway rate-limits per tenant; the sidecar retries 429s up to 5 times.
- **For new clinical-content writes**: state the action in chat.
  **Pause and ask before** writes that materially alter the medical record.
