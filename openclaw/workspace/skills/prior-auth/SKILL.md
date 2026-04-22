---
name: prior-auth
description: Read prior-authorization cases and the payer policy library, append notes, and run chart gap-checks against a PA's criteria. Read-only for state transitions — creates, status changes, and policy-review approvals stay in the admin UI.
user-invocable: true
---

# Prior Auth

The prior-auth tracker lives in three Firestore collections:

- `prior-auths` — one PA case per row (patient + payer + CPT + criteria checklist + status)
- `payers` + `payer-policies` — extracted criteria per payer + CPT, human-reviewed
- `target-cpts` — the panel of procedures the practice tracks

You can **read everything**, **append notes**, and **run the chart gap
check** to score how well a patient's chart meets a PA's criteria. You
do **not** create PAs or flip status — those are admin decisions that
run the state machine in the Cloud Functions.

## List prior auths

```bash
admin-api GET /admin-api/prior-auths
admin-api GET /admin-api/prior-auths?status=submitted
admin-api GET /admin-api/prior-auths?status=needs_info&limit=50
admin-api GET /admin-api/prior-auths?payerId=aetna
```

Status values: `draft`, `submitted`, `pending`, `needs_info`,
`peer_to_peer`, `approved`, `denied`, `appeal`, `cancelled`.

## Read one PA

```bash
admin-api GET /admin-api/prior-auths/PA_ID
```

Returns the full document: patient + DOB, payer + policy freshness,
CPT/ICD-10, criteria checklist with met/unmet evidence, attached
documents, notes, events, status, reference/auth numbers, assigned
coordinator.

## Audit trail

```bash
admin-api GET /admin-api/prior-auths/PA_ID/events
admin-api GET /admin-api/prior-auths/PA_ID/events?limit=100
```

Event types you'll see: `status_changed`, `chart_check_ran`, `policy_refreshed`.

## Append a coordinator note

```bash
admin-api POST /admin-api/prior-auths/PA_ID/notes '{"text":"Called Aetna, ref #12345. Rep says docs look complete, expect decision within 5 business days."}'
```

The note gets stamped with `authorId: "agent"` and `authorName` from
the agent identity. Pass `authorName` to relay a specific admin's name
when writing on behalf of someone:
`{"text":"...", "authorName":"Kaitlyn (via agent)"}`.

## Run the chart gap-check

This is the big one. It compares the PA's criteria checklist against
the patient's actual chart (intake form, recent messages,
refills-as-meds-proxy, plus live EHR problem list / meds / vitals /
notes) and fills in `met` / `evidence` / `chartRef` / `confidence` per
criterion.

```bash
admin-api POST /admin-api/prior-auths/PA_ID/chart-gap-check
```

Returns the updated checklist and logs a `chart_check_ran` event
against the PA. Criteria marked `manuallyOverridden: true` are
preserved — a human override always beats a model guess.

If the check fails (e.g. sidecar can't reach the model), you'll get a
502 or 503. Don't retry blindly — tell the admin and re-read the PA
with `GET /prior-auths/PA_ID` to confirm nothing was persisted.

## Browse the policy library

```bash
# List all payers (insurance carriers)
admin-api GET /admin-api/payers

# Pull a specific policy (criteria for one payer + CPT)
admin-api GET /admin-api/payer-policies/aetna_70553       # MRI brain w/o contrast, Aetna
admin-api GET /admin-api/payer-policies/cigna_95810       # Polysomnography, Cigna

# List the CPT panel the practice tracks
admin-api GET /admin-api/target-cpts
```

Policy ID format is `{payerId}_{cptCode}`. If a policy hasn't been
fetched or human-reviewed yet its `status` will be `pending_review` —
flag that to the admin before basing decisions on its
`extractedCriteria`.

## Deliberately OUT of scope

- **Creating a new PA.** Use the admin UI at `/admin/prior-auth/new`.
  The backend callable (`createPriorAuth`) snapshots the current
  policy into a checklist and auto-kicks off the gap check.
- **Moving a PA through status** (draft → submitted → approved, etc.).
  The state machine is enforced server-side in
  `updatePriorAuthStatus` — use the PA detail page.
- **Approving/rejecting an extracted policy.** That's a human-review
  gate in `/admin/prior-auth/policies/:policyId`.

When the admin asks you to do any of these, read the context,
summarize what should happen, and hand them a one-click path (e.g.
"Open `/admin/prior-auth/PA_ID` and click Submit with ref number
12345").

## Rules of engagement

- **Always cite the PA id** when reporting findings — coordinators
  keep many cases in flight and a partial patient name is ambiguous.
- **Re-run the gap-check before giving confidence claims.** If the
  PA's `updatedAt` is more than a day old, the chart likely has new
  data.
- **Don't speculate past the policy.** If `payer-policies/:id.status`
  is `pending_review`, label your answer as tentative — the criteria
  haven't been human-verified.
