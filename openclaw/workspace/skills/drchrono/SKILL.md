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
# Appointments — use date_range not date_from/date_to (DrChrono's filter)
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

## OAuth scope gotchas

The practice's OAuth app must have requested the right scopes at connect-
time. Token requests do **not** dynamically upgrade scope, so if one of
these 403s, the integration needs to be disconnected + reconnected with an
expanded scope set, not retried.

| Action | Scope required |
|---|---|
| Read demographics, problems, meds, allergies | `clinical:read` |
| Read appointments | `calendar:read` |
| Create / update appointments (and their `notes` field) | `calendar:write` |
| Write problems, meds, allergies, note fields | `clinical:write` |
| Read / write labs | `labs:read` / `labs:write` |
| Read / write billing | `billing:read` / `billing:write` |

If the OAuth app was connected with only the default scopes and you see a
403 on a write that should be legal, tell the admin to reconnect the
integration with the missing scope checked.

## Writing clinical notes

Clinical-note writing in DrChrono is **not** "PATCH the note." The
`/api/clinical_notes` collection is read-only (no PATCH, no POST on
`/clinical_notes/{id}`). There are two write paths; the simpler one is
usually right.

### Step 1 — create or find the appointment

```bash
# Find today's existing appointment for the patient
admin-api GET /drchrono/appointments?patient=12345678&date=2026-04-21

# If none exists, create one (calendar:write required — 403 without it).
# Minimum payload: patient + doctor + office + exam_room +
# scheduled_time + duration.
admin-api POST /drchrono/appointments '{
  "patient": 12345678,
  "doctor": 270718,
  "office": 288699,
  "exam_room": 1,
  "duration": 15,
  "scheduled_time": "2026-04-21T16:00:00",
  "reason": "Documentation visit",
  "status": "Complete"
}'
```

Returns `{id: 394316309, ...}` — that's the **appointment** id, NOT the
clinical-note id.

### Path A (simple) — appointment-level free-text notes

For documentation that doesn't need structured template fields, write
to the appointment's own `notes` field:

```bash
admin-api PATCH /drchrono/appointments/394316309 '{
  "notes": "Phone call 2026-04-21. Patient reports ongoing low back pain, has completed 6wk PT + NSAIDs without sustained improvement. Plan: order MRI lumbar spine."
}'
```

HTTP 204 on success. Right path for most day-to-day documentation tied
to a phone call or quick encounter.

### Path B (structured) — clinical_note_field_values

For documentation that needs to land in specific SOAP / H&P template
fields (shows in the standard DrChrono note UI), you write per-field:

```bash
# 1. Get the note's template sections
admin-api GET "/drchrono/clinical_notes?appointment=394316309&date_range=2026-04-21/2026-04-22"
# Returns clinical_note_sections: [{clinical_note_template: 3923012, name: "H&P CC / History of Present Illness"}, ...]

# 2. Get the fillable fields for that template
admin-api GET /drchrono/clinical_note_field_type?clinical_note_template=3923012
# Returns list of {id, field_type, field_value, field_values?}

# 3. POST one field value per field you want to fill
admin-api POST /drchrono/clinical_note_field_values '{
  "appointment": 394316309,
  "clinical_note_field": 9876543,
  "value": "8 weeks of radicular low back pain, right L5 distribution..."
}'
```

### Handling typed fields (dropdown / multi-select / checkbox)

Not every template field takes free text. The `field_type` returned by
`/clinical_note_field_type` tells you what shape the `value` must be.
**Always branch on `field_type` before sending `value` — posting a
free-text string to a dropdown returns a type-validation error and the
field stays empty.**

| `field_type` | `value` shape | Notes |
|---|---|---|
| `long_text`, `short_text`, `text` | plain string | free-text narrative — HPI, A&P, ROS, plan |
| `textbox` (legacy) | plain string | same as text |
| `integer`, `decimal`, `number` | string or number | `"7"` or `7` both accepted |
| `date` | `"YYYY-MM-DD"` | ISO date only; no time component |
| `choice`, `dropdown`, `single_select` | **id of the chosen option (string)** | e.g. `"15237"` — match by `field_values[].value` label, then submit the corresponding `field_values[].id` |
| `checkbox`, `boolean` | `"True"` (capitalized, Python-style) to check; delete the value row to uncheck | **NOT** `"true"`, `"1"`, `"2"`, null, or empty string — DrChrono rejects all of those with `value not allowed for specified field type`. Only the exact string `"True"` works. |
| `multiple_choice`, `multi_select` | comma-separated list of option **ids** | e.g. `"15237,15240"` — never the labels |
| `dictation`, `drawing`, `signature`, `file_upload` | not writable via this API | skip or upload via `/documents` |

**Recipe for dropdown / multi-select fields:**

```bash
# 1. Read the field definition — look at field_type + field_values
admin-api GET /drchrono/clinical_note_field_type?clinical_note_template=3923015
# Example:
#   {
#     "id": 9876544,
#     "field_name": "Reason for Visit",
#     "field_type": "multiple_choice",
#     "field_values": [
#       {"id": 15237, "value": "Back Problems"},
#       {"id": 15238, "value": "Annual Physical"}
#     ]
#   }

# 2. Match narrative → option id (case-insensitive substring or exact).

# 3. POST the id(s), not the label
admin-api POST /drchrono/clinical_note_field_values '{
  "appointment": 394316309,
  "clinical_note_field": 9876544,
  "value": "15237"
}'
```

**If no `field_values[]` entry matches** what you want to say, skip the
field rather than invent an id or post free text. Surface the mismatch to
the admin so they can add the option in the DrChrono template or fill it
manually.

**If the field is typed `file_upload` / `signature` / `drawing`:** skip —
these require a different API surface (multipart upload, canvas stream)
not exposed through `/clinical_note_field_values`.

### DON'T

- `POST /clinical_notes` → HTTP 405 Method Not Allowed (no such write endpoint).
- `PATCH /clinical_notes/{id}` → HTTP 405 (read-only collection).
- Using the *appointment id* as the *clinical-note id* — they're different
  integers. The note list is keyed on its own id, even though each row
  carries an `appointment` foreign key.

### Lock a clinical note

**Note locking is UI-only — not exposed through the REST API.** Every
plausible write path returns 405 / 404 / silent no-op:

| Attempt | Result |
|---|---|
| `PATCH /clinical_notes/{id}` body `{signee: {locked_by: "..."}}` | HTTP 405 |
| `POST /locked_clinical_notes {appointment: N}` | HTTP 404 (collection read-only) |
| `PATCH /appointments/{id}` body `{clinical_note: {locked: true}}` | HTTP 200 but nested lock field silently ignored — no state change |
| `PATCH /clinical_notes/{appointment_id}` (appt id double-duty) | HTTP 405 |

The historical `signee.locked_by` field on locked notes is written by a
human clicking **"Sign & Lock"** in the DrChrono web UI — it's an
e-signature action with regulatory requirements (state licensure + HIPAA),
and DrChrono intentionally does not expose it through the API.

**What to do instead:** when note content is complete, surface a message
to the admin like:

> "Note content is complete on appointment {id} for {patient name}.
> The note is ready for review + lock in DrChrono. Locking requires you
> to click **Sign & Lock** in the DrChrono web UI — the REST API doesn't
> expose it."

Then stop. Do not keep probing lock-ish endpoints.

To enumerate existing locks (read-only):

```bash
admin-api GET "/drchrono/clinical_notes?date_range=2026-01-01/2026-12-31"
# Look at signee.locked_by on each row — non-empty means locked.
```

## Common write operations

```bash
# Add a problem to the problem list
admin-api POST /drchrono/problems '{
  "patient": 12345678,
  "doctor": 270718,
  "icd_code": "M54.5",
  "name": "Low back pain",
  "status": "active",
  "date_diagnosis": "2026-04-21"
}'

# Add a medication
admin-api POST /drchrono/medications '{
  "patient": 12345678,
  "doctor": 270718,
  "name": "Meloxicam 15mg",
  "dosage_quantity": "1",
  "frequency": "QD",
  "status": "active"
}'

# Update a vitals reading
admin-api POST /drchrono/patients/12345678/vitals '{
  "date": "2026-04-21",
  "blood_pressure_systolic": 128,
  "blood_pressure_diastolic": 82,
  "pulse": 72
}'
```

## Safety + clinical judgment

- **Verify the patient before any write.** Patient search is prefix-match
  — confirm DOB or chart_id when names are ambiguous; never guess.
- **Document uploads** go into the patient's permanent chart — verify
  patient ID before calling the attach-to-drchrono skill.
- **Note locking is irreversible.** Locked notes can't be edited via UI
  or API. Get content right before asking the admin to lock.
- **For new clinical-content writes** (problems, meds, notes, labs):
  state the action in chat as you do it so the admin sees the audit
  trail in real time. **Pause and ask before** writes that materially
  alter the medical record — adding a diagnosis, prescribing meds, or
  locking a note. Routine documentation (filling in HPI / A&P on an
  existing in-progress note) is fine to proceed with after stating intent.
- DrChrono rate-limits at roughly 60 req/min per OAuth app. The sidecar
  retries 429s with exponential backoff up to 5 times; if you see
  "rate limited after retries," wait a minute before retrying.
- DrChrono's inline PDF preview has a known bug showing "Unable to load
  document" on fresh uploads — the file IS uploaded (downloads correctly)
  just doesn't preview inline.
