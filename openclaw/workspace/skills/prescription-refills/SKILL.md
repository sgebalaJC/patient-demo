---
name: prescription-refills
description: Review and process prescription refill requests — approve, deny, complete
user-invocable: true
---

# Prescription Refills

Manage refill requests via the `admin-api` CLI.

## List refills

```bash
admin-api GET /refills
admin-api GET /refills?status=pending
admin-api GET /refills?status=approved&limit=10
```

## By patient

```bash
admin-api GET /refills/patient/PATIENT_ID
```

## View single

```bash
admin-api GET /refills/REFILL_ID
```

## Process

```bash
admin-api PATCH /refills/REFILL_ID '{"status":"approved","doctorNotes":"Approved for 30-day supply"}'
admin-api PATCH /refills/REFILL_ID '{"status":"denied","doctorNotes":"Schedule a follow-up first"}'
admin-api PATCH /refills/REFILL_ID '{"status":"completed"}'
```

## Safety

- Review medication, dosage, and patient history before approving
- Flag urgent refills to admin immediately
- After processing, notify the patient via the admin-tasks skill
