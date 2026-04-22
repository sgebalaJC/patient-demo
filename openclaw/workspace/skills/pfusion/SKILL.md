---
name: pfusion
description: Search patients and read/write records in the practice's Practice Fusion EHR. Generic pass-through to Practice Fusion's REST API.
user-invocable: true
---

# Practice Fusion EHR

Access to Practice Fusion's REST API via the `admin-api` CLI. Calls are
authenticated with the practice's OAuth token (auto-refreshed by the
sidecar — no credentials needed in your calls).

Requires the integration to be **enabled** in the admin Agent → Integrations
tab. If disabled or unauthorized, calls below return 403 — surface that
to the admin rather than retrying.

Practice Fusion does not expose a separate sandbox host; test tenants
live on the same production OAuth surface.

## Find a patient

```bash
admin-api GET /pfusion/patients?firstName=John&lastName=Smith&dateOfBirth=1985-03-14
admin-api GET /pfusion/patients/<patientGuid>
```

Practice Fusion identifiers are **GUID strings**, not integers.

## Appointments

```bash
admin-api GET /pfusion/appointments?patientGuid=<id>&startDate=2026-04-01&endDate=2026-04-30
admin-api GET /pfusion/appointments/<appointmentGuid>
```

## Clinical data

```bash
admin-api GET /pfusion/patients/<patientGuid>/diagnoses
admin-api GET /pfusion/patients/<patientGuid>/medications
admin-api GET /pfusion/patients/<patientGuid>/allergies
admin-api GET /pfusion/patients/<patientGuid>/encounters
```

## Generic API access

Any Practice Fusion endpoint works via `/pfusion/<path>` pass-through.

## Safety + clinical judgment

- **Verify the patient before any write.** Patient GUIDs are globally
  unique but never shared across EHRs.
- Dates are **ISO (YYYY-MM-DD)**.
- Practice Fusion's write surface is narrower than typical EHRs — many
  clinical resources are read-only through the API. If a write 403s, it
  may simply not be supported; surface to the admin rather than retrying.
- Practice Fusion rate-limits per API key; sidecar retries 429s up to 5 times.
- **For new clinical-content writes**: state the action in chat.
  **Pause and ask before** writes that materially alter the medical record.
