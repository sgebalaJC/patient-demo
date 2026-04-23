---
name: appointments
description: View, schedule, update, and track patient appointments
user-invocable: true
---

# Appointments

Manage appointments via the `admin-api` CLI.

## List appointments

```bash
admin-api GET /appointments
admin-api GET /appointments?status=scheduled
admin-api GET /appointments?status=completed&limit=10
admin-api GET /appointments?limit=20&after=LAST_DOC_ID
```

Statuses: `scheduled`, `confirmed`, `in-progress`, `completed`, `cancelled`, `no-show`.

## Upcoming

```bash
admin-api GET /appointments/upcoming
```

Returns the next 10 `scheduled` or `confirmed` appointments sorted by date.

## Patient's appointments

```bash
admin-api GET /appointments/patient/PATIENT_ID
```

`PATIENT_ID` is the platform user UID — not the DrChrono numeric ID.

## View single appointment

```bash
admin-api GET /appointments/APPOINTMENT_ID
```

## Find an open slot

Before scheduling, check what's already booked for a given date:

```bash
admin-api GET /appointments/slots?date=2026-04-25
```

Returns `{date, busy, count}` where `busy` is the sorted list of non-cancelled
appointments with `start` / `end` ISO timestamps. Subtract these from clinic
hours to suggest a few open windows to the admin instead of guessing. Manual
Google Calendar blocks added directly in Calendar (without a corresponding
Firestore appointment) won't show up here.

## Schedule (create) an appointment

Creating writes to Firestore and triggers a Google Calendar sync + a patient
notification. **Always confirm patient identity and chosen date/time with the
admin before posting.** The flow is **find patient → confirm with admin → create**.

1. **Find the patient UID** via `admin-api GET /patients?search=Smith` (see
   the `patient-records` skill). The `id` you need is the platform user UID,
   not the DrChrono patient number.
2. **Confirm with the admin** — read back patient name, date, time,
   appointment type, and reason before calling.
3. **Create** (requires `--authorize`):

```bash
admin-api --authorize POST /appointments '{
  "patientId": "USER_UID_FROM_STEP_1",
  "appointmentDate": "2026-04-25T20:30:00.000Z",
  "appointmentType": "consultation",
  "duration": 30,
  "reason": "Annual physical"
}'
```

Required: `patientId`, `appointmentDate` (ISO 8601 timestamp).
Optional: `appointmentType`, `duration` (5–240 min, default 30), `reason`,
`notes`, `location`, `status` (`scheduled` | `confirmed`, default `scheduled`).
The `onAppointmentChange` Cloud Function trigger creates the calendar event
automatically.

## Update appointment

```bash
admin-api PATCH /appointments/APPOINTMENT_ID '{"status":"completed"}'
admin-api PATCH /appointments/APPOINTMENT_ID '{"notes":"Patient arrived 10 min late"}'
```

Updatable fields: `status`, `notes`, `reason`, `appointmentType`, `duration`, `location`.

## Cancel appointment (requires authorization)

```bash
admin-api --authorize PATCH /appointments/APPOINTMENT_ID '{"status":"cancelled"}'
```

Cancellation is visible to the patient immediately — confirm with the admin
before running.

## Safety

- **Confirm patient identity** before scheduling. `patientId` is the platform
  user UID — not the DrChrono numeric ID.
- **Confirm date/time** with the admin in their stated timezone before posting
  (the API takes ISO-8601 with offset; round-trip the human-readable form).
- **Create + cancel both require `--authorize`** — only set the header after
  the admin has explicitly confirmed.
- Calendar sync happens automatically via Cloud Function trigger; do not
  also write to Calendar yourself.
