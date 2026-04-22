---
name: ecw
description: Read patient data from the practice's eClinicalWorks EHR via SMART-on-FHIR R4. Generic pass-through to any FHIR resource type the OAuth grant allows.
user-invocable: true
---

# eClinicalWorks EHR (SMART-on-FHIR R4)

Access to the practice's eClinicalWorks FHIR R4 server via the `admin-api`
CLI. Calls are authenticated with the practice's SMART-on-FHIR access
token (auto-refreshed by the sidecar).

Requires the integration to be **enabled** in the admin Agent → Integrations
tab. If it's disabled or not authorized, all calls below return 403 — surface
that to the admin rather than retrying.

**eCW is FHIR, not a vendor-specific REST API.** Responses are FHIR JSON
(`application/fhir+json`) — either a single resource or a `Bundle` of
resources. Pagination uses `Bundle.link[{relation:"next"}]`.

## Scopes and permissions

eCW grants scopes at OAuth time, e.g.
`system/Patient.read system/Appointment.read system/Encounter.read`.
Writes require matching `*.write` scopes — the practice must have
authorized them at connect-time. Calls that need a scope the token
doesn't have come back as 401/403 with a `scope_missing` OperationOutcome;
surface that to the admin rather than retrying.

Check what scopes were actually granted:

```bash
admin-api GET /ecw/metadata    # CapabilityStatement — lists supported resources
```

## Find a patient

```bash
# Search by name + birthdate. FHIR search params are ?family=&given=&birthdate=
admin-api GET /ecw/Patient?family=Smith&given=John&birthdate=1985-03-14

# Search by identifier (MRN, etc.)
admin-api GET /ecw/Patient?identifier=MRN|12345

# Get one patient by FHIR id
admin-api GET /ecw/Patient/<id>
```

Patient-search returns a `Bundle` of `Patient` entries. Key fields per
entry.resource:
- `id` — FHIR resource id (opaque string; not a human-readable MRN)
- `identifier[]` — includes the practice's MRN with `system` + `value`
- `name[]` — `{family, given[], use}` (prefer `use:"official"`)
- `telecom[]` — phones/emails
- `birthDate`, `gender`, `address[]`

## Appointments

```bash
# Appointments for a patient in a date range. Use ISO dates.
admin-api GET "/ecw/Appointment?patient=<id>&date=ge2026-04-01&date=le2026-04-30"

# Get one appointment
admin-api GET /ecw/Appointment/<id>
```

Returns a `Bundle` of `Appointment` resources. Status values follow the
FHIR `AppointmentStatus` code system (`booked`, `arrived`, `fulfilled`,
`cancelled`, `noshow`).

## Clinical data (read-only in most deployments)

```bash
admin-api GET /ecw/Condition?patient=<id>           # problem list
admin-api GET /ecw/MedicationRequest?patient=<id>   # current meds
admin-api GET /ecw/AllergyIntolerance?patient=<id>
admin-api GET /ecw/Observation?patient=<id>&category=vital-signs
admin-api GET /ecw/Encounter?patient=<id>
admin-api GET /ecw/DocumentReference?patient=<id>
```

Most eClinicalWorks SMART-on-FHIR deployments expose the USCDI
(read-only) profile by default; writes typically require a separate
"provider-facing" SMART app registration. If a write 403s with a
`scope_missing`, that's the signal.

## Generic FHIR access

Any FHIR resource type works via `/ecw/<ResourceType>` pass-through. FHIR
search syntax (`?family=`, `?date=ge2026-01-01`, `?_include=Patient:general-practitioner`,
`?_count=50`) is preserved verbatim. Resource type names are **PascalCase**
(`Patient`, not `patient`; `MedicationRequest`, not `medication_request`).

Pagination:

```bash
# Follow the "next" link from a Bundle. The sidecar accepts relative paths
# under /ecw/ — pull everything after the FHIR base URL and submit that.
admin-api GET "/ecw/Patient?_getpages=abc123&_count=50"
```

## Safety + clinical judgment

- **Verify the patient before any read-across-chart operation.** FHIR ids
  are opaque — always match against `identifier[]` (MRN) plus
  name + birthDate before trusting.
- **FHIR is read-heavy.** The typical eCW deployment grants
  `system/*.read` but not `.write`. Don't assume writes are available —
  try once, let the 403 teach you, don't retry.
- Date searches use FHIR prefixes: `eq`, `ne`, `gt`, `lt`, `ge`, `le`
  (e.g. `?date=ge2026-01-01`). Naked dates are exact-match and usually
  return empty.
- Rate limits: the sidecar retries 429s with exponential backoff up to
  5 times before returning 503.
