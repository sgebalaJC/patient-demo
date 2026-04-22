---
name: scheduling
description: Assist with appointment scheduling — propose slots, check conflicts, create or reschedule appointments via the admin-api
user-invocable: true
---

# Scheduling

Help admins book, reschedule, or find an opening for a patient. The agent
proposes times, the admin approves, and the write happens through the
sidecar `admin-api`. Firestore is the source of truth; the Cloud Function
calendar-sync trigger mirrors the booking to Google Calendar
automatically — don't call calendar APIs directly from this skill.

## When to use

- "Book Jane in next Thursday afternoon for a follow-up"
- "What's my next open 30-minute slot this week?"
- "Reschedule appt ABC to Friday morning"
- "Is 2pm Tuesday free?"

## Workflow

### 1. Understand the ask

Clarify only what matters before proposing:
- **Patient** (name or ID)
- **Duration** (default 30 min)
- **Window** (date or date range, time-of-day preference)
- **Reason / type** (follow-up, new-patient, lab review, etc.)

If the patient isn't identified, look them up:
```bash
admin-api GET /admin-api/patients?search=Smith
```

### 2. Read busy times for each candidate day

```bash
admin-api GET /admin-api/appointments/slots?date=2026-04-25
```

Response:
```json
{
  "date": "2026-04-25",
  "busy": [
    { "appointmentId": "...", "start": "2026-04-25T16:00:00.000Z",
      "end": "2026-04-25T16:30:00.000Z", "duration": 30, "status": "scheduled" }
  ],
  "count": 1
}
```

The practice hours are **9:00–17:00 America/Los_Angeles** with 30-minute
granularity by default. Exclude any slot that overlaps a `busy` entry.
Ignore `cancelled` / `no-show` — those are already filtered server-side.

### 3. Propose 2–3 concrete times

Present times in the practice's local timezone, not UTC. Short list, not
a wall of options:

> "I've got three openings Thursday 4/25: 10:30, 1:00, or 2:30 PT. Which
> works?"

Factor in what you know about the patient from prior visits (first slot
after lunch if they're habitually late morning, etc.) when you have that
context — but don't stall asking for it.

### 4. Confirm + book

Creating an appointment **requires operator authorization** — the admin
must explicitly confirm before you call it. Once they do:

```bash
admin-api --authorize POST /admin-api/appointments '{
  "patientId": "PATIENT_ID",
  "appointmentDate": "2026-04-25T20:30:00.000Z",
  "duration": 30,
  "appointmentType": "follow-up",
  "reason": "post-op check",
  "location": "main office"
}'
```

`appointmentDate` is an ISO-8601 UTC timestamp. Convert from the
practice's local time before sending. Calendar sync and patient
notification fire automatically from the Firestore write — no extra
calls needed.

### 5. Reschedule

Rescheduling = cancel + create, and both legs require authorization.
Prefer this flow over editing `appointmentDate` in place because
calendar sync is cleaner:

```bash
# 1. Confirm the new slot is free (step 2 above)
# 2. Cancel the old one (requires --authorize)
admin-api --authorize PATCH /admin-api/appointments/OLD_ID '{"status":"cancelled"}'
# 3. Create the new one (requires --authorize)
admin-api --authorize POST /admin-api/appointments '{ ... }'
```

If the patient is only shifting by a few minutes on the same day, it's
fine to `PATCH` the existing appointment's `appointmentDate` instead —
lower friction, still re-syncs to calendar via the update trigger.

## EHR-native scheduling

If the practice is configured with an EHR that owns the appointment
book (DrChrono, NextGen, Tebra, etc.), prefer the EHR path so the
source of truth stays in the EHR:

```bash
admin-api GET /admin-api/drchrono/appointments?date=2026-04-25
admin-api POST /admin-api/drchrono/appointments '{ ... }'
```

Use the EHR's own skill docs for the exact payload shape. When the EHR
integration is disabled or not configured, fall back to the Firestore
path above.

## Safety

- **Never auto-book.** Always propose + wait for admin confirmation
  before calling `POST /admin-api/appointments` with `--authorize`.
- **Never book for a deactivated patient** — `GET /admin-api/patients/ID`
  first and check `isActive`. If false, stop and surface that to admin.
- **Don't double-book without flagging.** If the only available slot
  requires overlap with an existing appointment, say so explicitly and
  let the admin decide.
- **No PHI in chat history.** Acknowledge the booking by date/time and
  patient initials or ID — don't paste full names, reasons, or notes
  back into the transcript on follow-up turns.
- **Respect the patient's timezone in what you show**, but always send
  UTC on the wire. Common bug: pasting the local time string into
  `appointmentDate`.
