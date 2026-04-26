# Versioning + automated fork upgrades — design

Status: **planned**, not implemented. This doc is the spec; build when there are 3+ live forks and drift starts hurting.

## Two flavors of change to handle

| Kind | Examples | Mechanism |
| --- | --- | --- |
| Code | new pages, lib refactors, function signatures, Firestore rules | git — merge from template |
| Data / schema | new collections, doc migrations, Secret Manager keys, indexes | one-shot Cloud Function runs |

Both must be handled in one upgrade flow, in the right order.

## Versioning scheme

CalVer `YYYY.M.PATCH` (matches `lastTouchedVersion: 2026.3.13` already used in
the openclaw config). Tag template releases as `template-v2026.4.0`.

State recorded in two places per fork (must match after every upgrade):

- `fork.config.ts` → `templateVersion: '2026.4.0'` — compile-time, visible in PRs
- `system/forkMeta` Firestore doc → `{templateVersion, history, lastUpgradeAt, lastUpgradeBy}` — runtime, surfaced to /admin/settings

A mismatch banner in `/admin/settings` flags drift.

## Repo layout

```
migrations/
  2026.4.0/
    README.md           # what's in this release (template PR description)
    code.note.md        # non-merge tweaks (manual conflict guidance for fork.config.ts etc.)
    data.ts             # idempotent Cloud Function-runnable migration
    verify.ts           # assertions: doc shape, indexes, secrets
  2026.5.0/
    ...
  lib/
    assert.ts           # shared verification primitives
installer/cli/
  upgrade-fork.ts       # bun run installer/cli/upgrade-fork.ts --target ../fork
```

## Upgrade command

```bash
bun run installer/cli/upgrade-fork.ts --target ~/Projects/BLASKO/acme-clinic
```

For each version between fork's current and template's latest:

1. **Code merge** — `git fetch upstream && git merge upstream/template-v<NEXT>`. Conflicts surface; operator resolves and re-runs.
2. **Data migration** — `firebase deploy --only functions:migrate_v<NEXT>` then call it. Migration is idempotent (records `system/migrations/{version}.completed`).
3. **Verification** — call `verify_v<NEXT>` → returns `{ok, results: [...]}`. Any failure → stop; operator fixes; re-run.
4. **Record** — write `templateVersion = <NEXT>` to `system/forkMeta` + bump `fork.config.ts`. Push.
5. Loop.

## Verification primitives (`migrations/lib/assert.ts`)

- `assertDocShape(collection, zodSchema, sampleSize?)` — pull N docs, validate
- `assertIndexBuilt(collection, fields[])` — Firestore field-indexes API
- `assertSecretExists(name)` — `gcloud secrets describe`
- `assertCallableSucceeds(name, payload, expected)` — smoke a Cloud Function
- `assertSidecarHealthy()` — gateway ping

Migrations chain assertions; `verify_v<NEXT>` returns the aggregate result.

## Bootstrap (existing forks pre-versioning)

First upgrade run with no `system/forkMeta`:
1. Read `fork.config.ts.templateVersion` if present, write to forkMeta.
2. Otherwise, prompt operator for the rough date forked, default to oldest version in `migrations/`.

## Tradeoffs to internalise before building

- **Conflicts are inevitable.** `fork.config.ts`, `mobile/lib/config/branding.dart`, `web/apphosting.yaml`, `.firebaserc`, `infra/.openclaw-host.json` will conflict on every merge. Use `.gitattributes` `merge=ours` so the fork's version wins automatically:
  ```
  fork.config.ts                    merge=ours
  mobile/lib/config/branding.dart   merge=ours
  web/apphosting.yaml               merge=ours
  .firebaserc                       merge=ours
  infra/.openclaw-host.json         merge=ours
  ```
- **Ordering.** Data migration first risks new code reading old shape; code first risks runtime errors. Convention: **data migrations must be forward-compatible with old code** (add fields, don't rename). Code merge consumes new fields. Renames take two releases (deprecate cycle).
- **Rollback.** Code rollback = `git revert`. Data rollback is hard — keep migrations additive when possible; destructive changes write a backup at `system/migrations/<version>.backup/` first.
- **Fork drift.** Practice forks that hand-edit `web/src/lib/firestore/users.ts` will conflict on every merge. Policy: forks should only edit `fork.config.ts`, branding assets, and `system/*` Firestore docs. Anything else is on the operator. Document in `installer/README.md`.

## Phasing

1. **V1 — plumbing only.** Add `templateVersion` to `fork.config.ts`, write `system/forkMeta` on every install, drift banner in `/admin/settings`. ~1 day. **No upgrades yet.**
2. **V2 — manual migration directory.** First `migrations/<version>/`, document the manual run procedure. ~half day per release.
3. **V3 — `upgrade-fork.ts` automation.** CLI walks migrations, merges, runs callables, verifies. ~2–3 days.
4. **V4 — CI integration.** Template CI tags releases on merge to `main`, runs Phase F-style smoke against a perma-fork. ~1 day.

Total ~5 days to full automation. V1 + V2 alone (~1.5 days) gives drift detection + a concrete migration ritual that scales to a handful of forks before V3 pays off.

## When to start

Build V1 when:
- You have ≥ 2 live forks and at least one cross-fork change is needed
- The first "I forget what version showmd is on" moment hits

Build V3 when:
- You have ≥ 3 live forks
- A V1 drift banner has been red for > a week and nobody knows the manual ritual
