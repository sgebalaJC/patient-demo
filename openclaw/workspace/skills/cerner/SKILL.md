---
name: cerner
description: Read patient data from the practice's Cerner / Oracle Health EHR via SMART-on-FHIR R4. Generic pass-through to any FHIR resource type the OAuth grant allows.
user-invocable: true
---

# Cerner / Oracle Health EHR (SMART-on-FHIR R4)

Access to the practice's Cerner FHIR R4 server via the `admin-api` CLI.
Calls are authenticated with the practice's SMART-on-FHIR access token
(auto-refreshed by the sidecar).

Requires the integration to be **enabled** in the admin Agent → Integrations
tab. If disabled or unauthorized, calls below return 403.

**FHIR, not a proprietary REST API.** Responses are `application/fhir+json`
— either a single resource or a `Bundle`. Pagination uses
`Bundle.link[{relation:"next"}]`.

## Find a patient

```bash
admin-api GET /cerner/Patient?family=Smith&given=John&birthdate=1985-03-14
admin-api GET /cerner/Patient?identifier=MRN|12345
admin-api GET /cerner/Patient/<fhir-id>
```

Each Cerner deployment may expose both the Millennium FHIR server and
the Cerner Code Console sandbox — confirm the practice's `fhirBase` is
the production endpoint before trusting writes.

## Appointments

```bash
admin-api GET "/cerner/Appointment?patient=<id>&date=ge2026-04-01&date=le2026-04-30"
admin-api GET /cerner/Appointment/<id>
```

## Clinical data

```bash
admin-api GET /cerner/Condition?patient=<id>
admin-api GET /cerner/MedicationRequest?patient=<id>
admin-api GET /cerner/AllergyIntolerance?patient=<id>
admin-api GET /cerner/Observation?patient=<id>&category=vital-signs
admin-api GET /cerner/Encounter?patient=<id>
admin-api GET /cerner/DocumentReference?patient=<id>
```

Cerner exposes the USCDI read profile broadly; writes require separate
`*.write` scopes granted at connect time.

## Capability statement

```bash
admin-api GET /cerner/metadata    # what the server actually supports
```

## Generic FHIR access

Any FHIR resource type works via `/cerner/<ResourceType>`. FHIR search
syntax (`?date=ge…`, `?_include=…`, `?_count=50`) passes through. Resource
names are **PascalCase**.

## Safety + clinical judgment

- **Verify the patient before any read-across-chart operation.** Match
  on `identifier[]` (MRN) + name + birthDate; never trust a raw FHIR id
  across systems.
- Cerner rate-limits per app + tenant; the sidecar retries 429s up to 5
  times with exponential backoff.
- Date searches use FHIR prefixes (`eq`, `gt`, `lt`, `ge`, `le`). Naked
  dates are exact-match and usually empty.
