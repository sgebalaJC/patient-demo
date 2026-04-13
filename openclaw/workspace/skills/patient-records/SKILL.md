---
name: patient-records
description: Search, view, and update patient profiles — demographics, medical history, insurance, status
user-invocable: true
---

# Patient Records

Manage patient profiles via the `admin-api` CLI.

## List patients

```bash
admin-api GET /patients
admin-api GET /patients?search=Smith
admin-api GET /patients?status=active
admin-api GET /patients?status=inactive&limit=10
```

## Patient stats

```bash
admin-api GET /patients/stats
```

## View patient

```bash
admin-api GET /patients/PATIENT_ID
```

## Update patient

```bash
admin-api PATCH /patients/PATIENT_ID '{"firstName":"Jane"}'
```

Updatable: `firstName`, `lastName`, `phoneNumber`, `dateOfBirth`, `gender`, `bloodType`, `allergies`, `medicalHistory`, `emergencyContact`, `insuranceInfo`, `isActive`.

## Deactivate patient (requires authorization)

```bash
admin-api --authorize PATCH /patients/PATIENT_ID '{"isActive":false}'
```

**Patient deletion is forbidden.** Use deactivation instead.

## Safety

- **Deactivating** blocks patient login — always get explicit admin confirmation first, then use `--authorize`
- Never log or display full SSN, insurance numbers, or other PII in chat
- When updating medical data, read back the change for verification
