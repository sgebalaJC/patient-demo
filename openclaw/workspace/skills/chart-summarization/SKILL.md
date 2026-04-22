---
name: chart-summarization
description: Produce a concise chart summary for a patient — demographics, recent activity, intake highlights, open items — from the admin-api data already available
user-invocable: true
---

# Chart Summarization

Compose a short, staff-ready summary of a patient's chart by pulling from
the sidecar `admin-api` endpoints. No new data is written — this is a
read-only synthesis skill. Two common entry points:

- **Patient chart summary** — "summarize patient PATIENT_ID" or "give me
  the one-pager for Jane Smith before her visit."
- **Intake form summary** — "summarize the intake Jane just submitted"
  (same flow, but skip ahead to the intake section and focus there).

## Sources

| What | Endpoint | Notes |
|------|----------|-------|
| Demographics, allergies, meds history, insurance | `GET /admin-api/patients/PATIENT_ID` | Core record |
| Upcoming & recent visits | `GET /admin-api/appointments/patient/PATIENT_ID` | Last ~10 |
| Open refill requests | `GET /admin-api/refills/patient/PATIENT_ID` | Filter `status != completed,cancelled` |
| Open message threads | `GET /admin-api/messages?filter=unread` then filter by `patientId` | Only the threads that need attention |
| Uploaded documents | `GET /admin-api/documents/patient/PATIENT_ID` | List types, not contents |
| Latest intake form | `GET /admin-api/intake-forms/patient/PATIENT_ID` | `status` + `sections` |
| EHR chart (if configured) | `GET /admin-api/<ehr>/patients/<ehrId>` | drchrono/elation/nextgen/tebra/ecw — only when integration is active |

Fetch in parallel; most calls are independent.

## Output shape (default)

Deliver a 5–8 bullet summary grouped like this:

```
**Jane Smith** — 38F, DOB 1987-05-12
• Active · insurance on file (BCBS PPO)
• Next visit: Thu 2026-04-25 10:00 — annual physical
• 2 open items: refill pending (lisinopril 10mg), 1 unread message about lab results
• Intake: submitted 2026-04-20, approved. Flags: penicillin allergy, family hx of CAD
• Recent: 3 visits in last 6 months (routine), no no-shows
• Documents: drivers_license ✓, insurance_card_front ✓, insurance_card_back ✗
```

Tune length to the ask:
- "quick summary" → 3 bullets
- "pre-visit brief" → full 5–8 bullets, lead with reason for visit
- "intake summary" → lead with intake flags, skip visit/refill detail

## Intake-specific flow

When the admin asks to summarize a freshly-submitted intake:

1. `GET /admin-api/intake-forms/patient/PATIENT_ID` to pull the submission.
2. Walk `sections` and surface only values that matter clinically or
   administratively — allergies, meds, conditions, family history, pain
   level, tobacco/alcohol, insurance changes, emergency contact delta.
3. Flag anything missing or inconsistent ("no emergency contact listed",
   "insurance member ID looks malformed").
4. Recommend one of: **approve**, **send back with notes**, **route to
   provider**. Don't act on it — just recommend. Use the `intake-forms`
   skill for the approve / send-back calls.

## Safety

- **No PHI in chat history.** Summaries live in the current reply, not in
  persisted notes, not echoed back into agent-chat on a second turn. If
  the admin asks you to save the summary, attach it to the patient's
  message thread or notes via the existing endpoints — don't paste it
  into the transcript again.
- **Never guess clinical meaning.** If a lab value or medication detail
  is unclear, cite the source field and move on.
- **Read-only.** This skill never PATCHes or POSTs — pair with
  `intake-forms`, `appointments`, or `secure-messaging` for actions.
- **If an EHR integration is disabled**, don't retry — silently drop the
  EHR section and note "EHR chart not available" in the summary.
