---
name: appointments
description: View, update, and track patient appointments — schedule, status, upcoming
user-invocable: true
---

# Appointments

Manage appointments via the `admin-api` CLI.

## List appointments

```bash
admin-api GET /appointments
admin-api GET /appointments?status=scheduled
admin-api GET /appointments?status=completed&limit=10
```

## Upcoming

```bash
admin-api GET /appointments/upcoming
```

## Open slots on a date

```bash
admin-api GET /appointments/slots?date=2026-04-25
```

## By patient

```bash
admin-api GET /appointments/patient/PATIENT_ID
```

## View single

```bash
admin-api GET /appointments/APPOINTMENT_ID
```

## Create (requires authorization)

```bash
admin-api --authorize POST /appointments '{"patientId":"PID","appointmentDate":"2026-04-25T20:30:00.000Z","duration":30,"appointmentType":"follow-up"}'
```

## Update

```bash
admin-api PATCH /appointments/APPOINTMENT_ID '{"status":"completed"}'
admin-api PATCH /appointments/APPOINTMENT_ID '{"notes":"Patient arrived 10 min late"}'
```

## Cancel (requires authorization)

```bash
admin-api --authorize PATCH /appointments/APPOINTMENT_ID '{"status":"cancelled"}'
```

## Statuses

`scheduled`, `confirmed`, `in-progress`, `completed`, `cancelled`, `no-show`

## Safety

- **Cancelling requires `--authorize`** — always confirm with admin first
- Calendar sync happens automatically via Cloud Function trigger
