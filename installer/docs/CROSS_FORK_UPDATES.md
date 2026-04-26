# Cross-fork bundle updates — design (foundation laid, tool not built)

You (the maintainer) push template improvements to the patient-portal codebase. Each running fork has a frozen-at-install copy of `functions/` in its own GCS bucket. This doc describes how a future tool will propagate template updates to N live forks without per-fork manual work.

## What's already in place (2026-04-26)

### Bundle versioning (step 12b)

Each install uploads a versioned tarball to `gs://<project>-installer-source/`:

```
functions-source.tar.gz                       ← latest pointer (mutable)
version.json                                  ← latest version metadata
versions/<version>/functions-source.tar.gz   ← immutable historical copy
versions/<version>/version.json
```

Where `<version> = <ISO-no-colons>-<git-short-sha>` (e.g. `2026-04-26T22-30-00Z-4f5208e`).

### Runtime install tracking (`installed-integrations/{id}`)

When admin clicks "Deploy" on an integration card, the `enableIntegration` Cloud Function:
1. Submits a Cloud Build job pulling source from `gs://.../functions-source.tar.gz`
2. Writes `installed-integrations/{id}` with `status='deploying'`, `deployedFunctions: [...]`, `lastBuildId`
3. Cloud Build's final step PATCHes the same doc with `status='deployed'|'failed'`, `lastBuildFinishedAt`, **`deployedFromBundle: <version>`**

So at any moment, querying `installed-integrations/*` answers two questions:
- Which integrations are deployed in this fork?
- What bundle version was each integration deployed from?

## What the future cross-fork update tool will do

```bash
bun run installer/cli/upgrade-bundle.ts \
  --target ~/Projects/installer-smoke-fork-A \
  --target ~/Projects/installer-smoke-fork-B \
  ...
```

Per fork:

1. **Compare versions.** Read `gs://<project>-installer-source/version.json` to see the fork's current bundle version. Compare against the maintainer's local `git rev-parse --short HEAD`.
2. **Skip if up-to-date.** If the fork's `version` matches local `gitSha`, no work to do.
3. **Re-package.** Run the same tar+upload as installer step 12b — generate new `<version>` tag, upload to versioned + latest paths.
4. **Read `installed-integrations/*`.** List every doc with `status='deployed'`.
5. **Trigger redeploys.** For each installed integration, call `enableIntegration({integrationId})` via the fork's Cloud Function. This:
   - Submits a Cloud Build job using the new bundle
   - Updates `installed-integrations/{id}` with the new `deployedFromBundle`
6. **Wait or proceed async.** Either poll Cloud Build for completion (1-3 min per integration) or fire-and-forget + track via the `lastBuildId` field on the doc.

### Failure semantics

- A fork with stale `installed-integrations/*` (e.g. an integration that was deleted but never cleaned up) → `enableIntegration` will fail with "function group has functions that no longer exist" or similar. Skip it; log to maintainer.
- A fork whose Cloud Build SA lost permissions (bumped roles, policy changes) → `enableIntegration` returns the Cloud Build submit error verbatim. Maintainer addresses per-fork.
- A fork mid-deploy (`status='deploying'`) → upgrade tool waits up to N min for it to settle, then either retries or skips with a warning.

## Why this design

- **Versioned tarballs are immutable.** Rollback by pointing `latest` back to a `versions/<old>/functions-source.tar.gz`. No code changes; just two `gcloud storage cp` calls.
- **Bundle version on each integration's deploy record** lets you answer "which forks are running v2026.4.0 vs v2026.4.1" with a Firestore query — not by SSHing into each fork.
- **No central registry of forks needed yet.** The maintainer maintains their own list of fork project ids (in their notes, a private spreadsheet, whatever). Each fork is independently addressable via its `gs://<project>-installer-source/` and `installed-integrations` collection.
- **Foundation for V3 of versioning** (template versioning per `installer/docs/VERSIONING.md`). The bundle version is the runtime equivalent of `templateVersion` — distinct because bundle = deployed functions, template version = whole repo (web + functions + rules + indexes). They can converge later.

## Implementation note for whoever builds this

`installer/cli/upgrade-bundle.ts` should reuse `installer/cli/steps/12b-package-source.ts` for the tar+upload phase. The differences:
- Operates on a `--target` that's already populated (no fresh `git clone`)
- Reads `installed-integrations/*` from each target's Firestore (needs Application Default Credentials for that project)
- Calls `enableIntegration` on each fork's Cloud Function URL (per-project: `https://us-west1-<projectId>.cloudfunctions.net/enableIntegration`)

A maintainer-side service account with `roles/firebase.admin` + `roles/storage.objectAdmin` across all fork projects is the simplest auth model. Or an OIDC-token-per-fork pattern if you want least-privilege.
