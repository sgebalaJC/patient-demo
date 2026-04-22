---
name: athena
description: Search patients and read/write records in the practice's Athenahealth EHR. Generic pass-through to any Athena REST API endpoint. Practice (tenant) id is injected automatically.
user-invocable: true
---

# Athenahealth EHR

Access to Athena's REST API via the `admin-api` CLI. Every call is
authenticated with the practice's OAuth token (auto-refreshed by the
sidecar — no credentials needed in your calls) and scoped to the
practice id configured in the admin UI.

Requires the integration to be **enabled** in the admin Agent → Integrations
tab. If it's disabled or not authorized, all calls below return 403 with a
clear error message — surface that to the admin rather than retrying.

The practice can be connected to either the **preview sandbox** (test data
that resets periodically) or production — the sidecar routes to the right
host based on the integration config. Writes in preview never hit a real
patient chart.

## Find a patient

```bash
# Search by name. Athena uses firstname/lastname (no underscores).
admin-api GET /athena/patients?firstname=John&lastname=Smith

# Add DOB when names are ambiguous — Athena treats it as an exact filter.
admin-api GET /athena/patients?lastname=Smith&dob=03/14/1985
```

Patient-search responses come back as `{patients: [...], totalcount: N}`.
Field names are lowercased with no underscores (Athena convention):
`patientid`, `firstname`, `lastname`, `dob`, `homephone`, `mobilephone`,
`sex`, `status`.

### Get one patient's full record

```bash
admin-api GET /athena/patients/<patientid>
```

## Appointments

```bash
# List booked appointments for a date range (Athena wants MM/DD/YYYY).
admin-api GET /athena/appointments/booked?startdate=04/01/2026&enddate=04/30/2026

# Get appointment detail
admin-api GET /athena/appointments/<appointmentid>

# Open a slot (creates an appointment). Requires providerid + departmentid
# + appointmenttypeid which the admin can list from the Athena UI.
admin-api POST /athena/appointments/open '{"providerid":"12","departmentid":"1","appointmenttypeid":"82","date":"04/22/2026","starttime":"14:00"}'
```

## Clinical data

```bash
admin-api GET /athena/chart/<patientid>/problems
admin-api GET /athena/chart/<patientid>/medications
admin-api GET /athena/chart/<patientid>/allergies
admin-api GET /athena/chart/<patientid>/vitals
admin-api GET /athena/chart/<patientid>/encounters
```

Adding a problem / medication / allergy goes through the same path with
POST — see Athena's API reference for payload shape (varies by chart type).

## Generic API access

Any Athena endpoint works via `/athena/<path>` pass-through. The practice
id is prepended to the URL automatically, so you only specify the part
AFTER it. For example, Athena's URL
`/v1/195900/patients` becomes `admin-api GET /athena/patients` here.

POST / PATCH / DELETE also work the same way; Athena returns its usual
`{success: true, ...}` envelope or `{error: "..."}`.

## Safety + clinical judgment

- **Verify the patient before any write.** Athena patient IDs are local to
  the practice — never assume an ID from another EHR maps across.
- Dates in Athena are **MM/DD/YYYY**, not ISO. The sidecar does not
  translate — pass the format Athena wants or the API returns a silent
  no-match.
- Athena rate-limits per tenant; the sidecar retries 429s with exponential
  backoff up to 5 times before returning 503.
- **For new clinical-content writes** (problems, meds, encounters):
  state the action in chat as you do it. **Pause and ask before** writes
  that materially alter the medical record.
- The practiceId is a routing detail — never accept it as user input in
  a skill call. It comes from `integrations/athena.practiceId` only.
