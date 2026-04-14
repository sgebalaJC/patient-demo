---
name: drchrono
description: Search patients and read/write records in the practice's DrChrono EHR. Generic pass-through to any DrChrono REST API endpoint.
user-invocable: true
---

# DrChrono EHR

Access to DrChrono's REST API via the `admin-api` CLI. Every call is
authenticated with the practice's OAuth token (auto-refreshed by the
sidecar — no credentials needed in your calls).

Requires the integration to be **enabled** in the admin Agent → Integrations
tab. If it's disabled or not authorized, all calls below return 403 with a
clear error message — surface that to the admin rather than retrying.

## Find a patient by name

```bash
admin-api GET /drchrono/patients?first_name=John&last_name=Smith
```

Returns a paginated list. Patient search is **prefix-match**, so `John Smith`
may also return `Johnny Smithson`. Filter on exact match when needed. If a
date of birth is available, verify before proceeding.

### Search by DOB too

```bash
admin-api GET /drchrono/patients?last_name=Smith&date_of_birth=1985-03-14
```

### Get one patient's full record

```bash
admin-api GET /drchrono/patients/12345678
```

Returns name, email, phone, DOB, gender, allergies, flags, emergency contact.

## Generic API access

Any DrChrono endpoint works via the `/drchrono/<path>` pass-through:

```bash
# Appointments
admin-api GET /drchrono/appointments?patient=12345678&date_range=2026-04-01/2026-04-30

# Clinical data
admin-api GET /drchrono/clinical_notes?patient=12345678
admin-api GET /drchrono/medications?patient=12345678
admin-api GET /drchrono/allergies?patient=12345678
admin-api GET /drchrono/problems?patient=12345678

# Documents list
admin-api GET /drchrono/documents?patient=12345678
```

POST / PATCH / DELETE also work the same way:

```bash
admin-api PATCH /drchrono/patients/12345678 '{"email":"new@example.com"}'
admin-api POST /drchrono/appointments '{"patient":12345678,"scheduled_time":"2026-05-01T14:00:00-07:00","duration":30,"doctor":1}'
admin-api DELETE /drchrono/documents/98765
```

Responses pass through DrChrono's exact JSON (including pagination via
`next` / `previous` URLs).

## Safety

- **Never write medical data** (problems, medications, allergies) without
  admin approval in chat first. Reads are always fine.
- **Patient demographic updates** change what the practice sees — confirm
  the change before calling PATCH on `/drchrono/patients/:id`.
- If a patient search is **ambiguous** (multiple matches without DOB
  confirmation), surface the candidates back to the admin — do not guess.
- DrChrono rate-limits at roughly 60 req/min per OAuth app. The sidecar
  retries 429s with exponential backoff up to 5 times; if you see "rate
  limited after retries," wait a minute before retrying.
