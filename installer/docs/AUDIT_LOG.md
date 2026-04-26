# Audit log — design (parked)

Status: **planned**, not implemented. Resume after installer phase F is closed.

## Context

Today:
- `web/src/lib/audit.ts` — `audit({action, resourceType, resourceId, metadata})` fire-and-forget helper
- `functions/src/index.ts:logAuditEvent` — sanitises PII fields, looks up actor role server-side, writes to Cloud Logging with `[AUDIT]` prefix

Gaps the user asked to close: coverage (most mutations don't log), in-app readability (logs only in Cloud Logging), HIPAA-grade retention (Cloud Logging keeps 30 days, HIPAA wants 6 years), patient self-access (Right to Access).

## Phasing

| Phase | What | Effort |
| --- | --- | --- |
| A — Coverage | Add `audit(...)` at every PHI-touching success point in `lib/firestore/*`, Cloud Function callables, sidecar admin-api. Standardise names: `user.updated`, `appointment.created`, `refill.approved`, `message.sent`, `document.viewed`, `document.downloaded`. | ~1 day |
| B — Firestore mirror | `logAuditEvent` also writes `audit-logs/{logId}` doc. Super-admin read, Admin SDK write. Composite indexes: `(actorId, timestamp)`, `(action, timestamp)`, `(resourceType, resourceId, timestamp)`. | ~2 h |
| C — 6-year retention | GCP Log Sink: filter `jsonPayload.audit=true` → GCS bucket, lifecycle (Standard → Coldline @ 90d → Archive @ 1y), 6-year retention. Add to installer (new step or extend step 08). | ~2 h |
| D — Admin UI | `/admin/audit-log` (super-admin). Filters: actor, action, resource, date range. CSV export callable. | ~half day |
| E — Patient self-access | `/profile/access-history` lists entries where `resourceType=user`, `resourceId=<my uid>`, `actorId ≠ me`. Satisfies HIPAA §164.524. | ~2 h |

Phases A + B are the user's stated ask. C is required for HIPAA-real forks. D + E are polish.

## Coverage matrix (Phase A)

PHI-touching paths to instrument:

- **Users**: `user.created`, `user.updated`, `user.deactivated`, `user.role-changed`, `user.viewed-by-admin`
- **Appointments**: `appointment.created`, `appointment.updated`, `appointment.cancelled`, `appointment.confirmed`
- **Messages**: `message.thread-created`, `message.sent`, `message.viewed`
- **Refills**: `refill.requested`, `refill.approved`, `refill.denied`, `refill.viewed`
- **Documents**: `document.uploaded`, `document.viewed`, `document.downloaded`, `document.deleted`
- **Intake**: `intake.submitted`, `intake.viewed`, `intake.approved`
- **Faxes**: `fax.sent`, `fax.received`, `fax.attached`
- **Auth**: `auth.signin`, `auth.signout`, `auth.signin-failed`, `auth.password-reset`, `auth.impersonation-started`, `auth.impersonation-ended`
- **Admin**: `settings.updated`, `integration.enabled`, `integration.disabled`, `secret.rotated`

## Implementation notes

- `audit()` is fire-and-forget — never block UI on logging
- Never log PII in metadata; the callable already strips a list of common PII keys, but every call site should pre-filter to be safe
- Action names follow `<resource>.<verb>` convention, lowercase-hyphen
- Cloud Function logs the actor's role from Firestore (not client-supplied)
- Firestore mirror lets the admin UI query without scraping Cloud Logging
