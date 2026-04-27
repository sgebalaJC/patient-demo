# Deferred review items (post 5-pass review, 2026-04-26)

Items surfaced across five review passes (commits `cc14189..24c0bce`) that
were deliberately not fixed in-pass. Each entry: where it lives, why it was
deferred, and what would prompt revisiting.

## Operational (ops runbook)

### Audit-logs TTL policy not enabled by default

`functions/src/lib/audit.ts` writes `expiresAt = now + 90 days` on every
audit doc, but the Firestore TTL policy on that field is opt-in per fork.

- **Why deferred:** TTL policy is a one-time `gcloud firestore fields ttls
  update` per project; the installer can't safely automate it (TTL policy
  is project-wide, not collection-scoped, and rollback is destructive).
- **Action when:** First real customer fork goes live AND audit volume is
  measurable. Document in the per-fork setup runbook (already done in
  `CLAUDE.md` step 7).
- **Watchpoint:** If the `audit-logs` collection grows past ~100k docs on
  any fork, query latency on the AdminAuditLogPage degrades and the 12
  composite indexes start eating storage. TTL must be on by then.

### Cloud Build refresh trigger doesn't backfill already-deployed forks

`cloudbuild-refresh-source.yaml` rebuilds the source bundle on every push
to `main`, but only on forks where step 12c was run. Forks deployed before
the refresh trigger landed (none today) won't auto-refresh.

- **Why deferred:** No such forks exist yet.
- **Action when:** Cross-fork update tool gets built (parked at
  `installer/docs/CROSS_FORK_UPDATES.md`); add a one-shot
  `gcloud builds submit --config=cloudbuild-refresh-source.yaml` per-fork
  bootstrap.

### Wizard re-run with different superAdminEmail errors out

`installer/cli/steps/10b-rewrite-superadmin.ts` looks for the template
literal `'stanislaw.gebala@gmail.com'` OR the current `superAdminEmail` in
each target file. A re-run with a NEW email after a successful first run
finds neither and throws.

- **Why deferred:** Recovery is documented (clear worktree + reset state).
- **Action when:** This bites a real operator. Easy upgrade: track the
  rewrite history in state.json so the step can chain rewrites.

## Coverage gaps (low-risk omissions)

### Audit emits NOT added in this pass

Some Firestore-writing handlers were intentionally skipped after evaluating
PHI exposure:

- `stripeWebhook` / `platformStripeWebhook` — write `patient-subscriptions`
  and `platform/*`. No PHI; subscription state only.
- All EHR `*Authorize` / `*Callback` / `*SaveCredentials` / `*Disconnect` /
  `*SetEnabled` callables — credential changes audited via the integration
  save flow elsewhere.
- `onAppointmentWrite` (Firestore trigger) — reactive to user-driven
  appointment updates that already emit audits via `lib/firestore/
  appointments.ts`.

Add audit emits if a future compliance review specifically calls for them.

### `actorRole` hardcoded in `emitAudit` callsites

Server-internal audit emits hardcode `actorRole: 'admin' | 'system' |
'patient' | 'super_admin'`. The `logAuditEvent` callable looks up role
from Firestore live; `emitAudit` trusts the caller's already-checked role.

- **Why deferred:** Bounded by the `requireAdmin` / `requireSuperAdmin`
  upstream auth gate. A demoted-but-mid-call admin's emit reports the
  stale role — but the action couldn't have started without the role
  being correct at gate time.
- **Action when:** A specific incident requires fresh-lookup semantics.

### `AdminAuditLogPage` displays UID-only (no email lookup)

The Firestore mirror dropped `actorEmail` per minimization principles.
Super-admins see UIDs in the table, losing at-a-glance recognition.

- **Why deferred:** Minimization is the deliberate posture. Users can
  cross-reference UID → email via the User Management page.
- **Action when:** Ops feedback shows the friction is real. Then add a
  lazy UID → email cache in the page.

## Bounded threats (validated as low-risk)

### `isValidSidecarUrl` accepts `localhost`

Allowed by the DNS regex. Production sidecarProxy runs in Cloud Run and
can't reach a customer's `localhost`, so this is functionally only
exploitable from the local emulator.

- **Action when:** Never, unless someone wants stricter prod-vs-dev
  segmentation in the validator.

### `scrubPii` sibling-DAG false-positive

The shared `seen: WeakSet` correctly catches cycles but also nulls a node
visited via a different branch (a DAG, not a cycle).

- **Why deferred:** Audit metadata is rarely DAG-shaped today.
- **Action when:** A caller starts passing genuinely-shared subobjects.
  Per-branch tracking (clone the set on recursion) is the standard fix.

### `firestore.rules` `/system/{docId}` exclusion list is hand-maintained

The catch-all guard `!(docId in ['installWizard', 'branding', 'settings'])`
must be updated by hand whenever a new specific super-admin-only or
public-read `/system/<doc>` rule is added. Privilege widening is silent
on omission.

- **Why deferred:** No automated check available without the Firebase
  emulator + a rules-test harness.
- **Action when:** A test suite is added (project has none today per
  CLAUDE.md). Then assert every `/system/<known-id>` match-rule has a
  corresponding entry in the exclusion list.

### Audit-logs 4-way composite index storage cost

`(actorId, action, resourceType, resourceId, timestamp)` is rarely used
but kept for filter UI completeness. Storage cost scales linearly with
audit-log volume.

- **Why deferred:** Negligible at expected fork volume; covered by TTL
  policy when enabled.
- **Action when:** Audit storage bills become a concern (drop the 4-way
  first, restrict UI to 3-field combos).

## Scope deferred (parked initiatives)

- **Versioning V1 / cross-fork update tool / real Developer Connect step 13**
  — see `installer/docs/VERSIONING.md`,
  `installer/docs/CROSS_FORK_UPDATES.md`. Build when 2+ live forks exist.
- **Smoke #9 on a fresh project** — exercises step 12c push-refresh
  trigger that landed after smoke #8 was torn down. See
  `installer/docs/EXERCISE_RUNBOOK.md`.
- **`installer/scripts/exercise-enable-integration.sh`** — harness built
  during cc14189; never run live. Validates Phase 3 auto-deploy E2E
  against a real smoke fork.
- **Mobile `branding.dart` mirror** — manual hand-edit per CLAUDE.md;
  wizard ConfirmStep flags this. Auto-generation deferred until mobile
  ships to a customer.

## Pre-existing items NOT touched in review

- `installer/cli/steps/04-gcp-project.ts` — orphaned project on later
  step failure. Documented; no `--cleanup-on-fail` flag yet.
- `web/src/pages/UserManagementPage.tsx:192` — preexisting `err?.message`
  on `unknown` (TS strict warning). Out of scope for the review diffs.
- `web/vendor-firebase-*.js` chunk size warning at build — preexisting
  bundle size; manual chunking not optimized.
