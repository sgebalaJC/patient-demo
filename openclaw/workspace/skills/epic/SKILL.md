---
name: epic
description: Read patient data from the practice's Epic EHR via SMART-on-FHIR R4. Generic pass-through to any FHIR resource type the OAuth grant allows.
user-invocable: true
---

# Epic EHR (SMART-on-FHIR R4)

Access to the practice's Epic FHIR R4 server via the `admin-api` CLI.
Calls are authenticated with the practice's SMART-on-FHIR access token
(auto-refreshed by the sidecar).

Requires the integration to be **enabled** in the admin Agent → Integrations
tab. If disabled or unauthorized, calls below return 403.

Production use requires **App Orchard enrollment** — Epic issues
production client credentials only to approved vendors. The
`fhir.epic.com` sandbox is open for development without enrollment.

## Find a patient

```bash
admin-api GET /epic/Patient?family=Smith&given=John&birthdate=1985-03-14
admin-api GET /epic/Patient?identifier=MRN|12345
admin-api GET /epic/Patient/<fhir-id>
```

Epic returns a `Bundle` of `Patient` entries. MRN lives in
`identifier[]` — Epic exposes multiple identifier systems (EPI, MRN,
CSN) and you must match on the one the practice actually uses.

## Appointments

```bash
admin-api GET "/epic/Appointment?patient=<id>&date=ge2026-04-01&date=le2026-04-30"
admin-api GET /epic/Appointment/<id>
```

## Clinical data

```bash
admin-api GET /epic/Condition?patient=<id>
admin-api GET /epic/MedicationRequest?patient=<id>
admin-api GET /epic/AllergyIntolerance?patient=<id>
admin-api GET /epic/Observation?patient=<id>&category=vital-signs
admin-api GET /epic/Encounter?patient=<id>
admin-api GET /epic/DocumentReference?patient=<id>
```

Writes require separate `*.write` scopes granted at App Orchard
approval time. Most production Epic deployments are read-only for
third-party apps.

## Capability statement

```bash
admin-api GET /epic/metadata    # CapabilityStatement for this practice
```

## Generic FHIR access

Any FHIR resource type works via `/epic/<ResourceType>`. Resource names
are **PascalCase**. Epic's search parameters follow the FHIR spec with
a few Epic-specific additions documented in the App Orchard materials.

## Safety + clinical judgment

- **Verify the patient before any read-across-chart operation.** Epic
  MRNs are practice-local; a global FHIR id does not guarantee the same
  person across organizations.
- **Writes are rare.** If a `.write` 403s, it's almost always a scope
  issue — don't retry, surface to the admin.
- Epic enforces per-app rate limits (App Orchard publishes the quota).
  The sidecar retries 429s up to 5 times with exponential backoff.
- FHIR date prefixes (`eq`, `gt`, `lt`, `ge`, `le`) are required for
  range queries; naked dates are exact-match and often return empty.
