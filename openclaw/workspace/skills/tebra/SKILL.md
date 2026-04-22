---
name: tebra
description: Search patients, appointments, and billing records in the practice's Tebra (formerly Kareo) EHR + PM system. Generic pass-through to Tebra's REST API.
user-invocable: true
---

# Tebra (Kareo) EHR + PM

Access to Tebra's REST API via the `admin-api` CLI. Calls are authenticated
with the practice's OAuth token (auto-refreshed by the sidecar — no
credentials needed in your calls).

Requires the integration to be **enabled** in the admin Agent → Integrations
tab. If it's disabled or not authorized, calls below return 403 — surface
that to the admin rather than retrying.

Tebra is both an EHR and a practice-management / billing system. Many of
the most useful calls are billing-side (claims, payments, patient
balances), not clinical.

## Find a patient

```bash
admin-api GET /tebra/patients?firstName=John&lastName=Smith
admin-api GET /tebra/patients?lastName=Smith&dateOfBirth=1985-03-14
admin-api GET /tebra/patients/<patientId>
```

## Appointments

```bash
admin-api GET /tebra/appointments?patientId=<id>&startDate=2026-04-01&endDate=2026-04-30
admin-api GET /tebra/appointments/<id>
```

## Billing + practice management

```bash
# Patient balance + insurance
admin-api GET /tebra/patients/<id>/balance
admin-api GET /tebra/patients/<id>/insurance

# Claims by patient
admin-api GET /tebra/claims?patientId=<id>&status=open

# Payments posted against a claim
admin-api GET /tebra/claims/<claimId>/payments
```

## Clinical data

```bash
admin-api GET /tebra/patients/<id>/problems
admin-api GET /tebra/patients/<id>/medications
admin-api GET /tebra/patients/<id>/allergies
admin-api GET /tebra/patients/<id>/encounters
```

## Generic API access

Any Tebra endpoint works via `/tebra/<path>` pass-through. POST /
PATCH / DELETE follow Tebra's usual REST contract.

## Safety + clinical judgment

- **Verify the patient before any write.** Tebra patient IDs are tenant-
  local — never assume a match with another EHR.
- **Billing writes (posting a payment, writing off a balance, adjusting a
  claim) change financial state.** Always confirm with the admin before
  proceeding, then state the action in chat as you do it.
- Dates are **ISO (YYYY-MM-DD)**.
- Tebra rate-limits per OAuth app; sidecar retries 429s up to 5 times.
- Tebra's legacy SOAP API (`KareoServices.svc`) is a different surface —
  not used by this skill. If a response field looks SOAP-ish, the
  integration is pointed at the wrong URL.
