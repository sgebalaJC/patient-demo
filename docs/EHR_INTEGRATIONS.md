# EHR Integrations

Current state snapshot: **10 EHR integrations** live behind a shared factory + registry, super-admin gated, with split-doc secret storage.

## Architecture

Three layers, each with one shared file and a small per-vendor spec.

| Layer | Shared | Per-vendor spec |
|---|---|---|
| OAuth callables (Functions) | `functions/src/lib/ehr-oauth.ts` | `functions/src/<provider>.ts` (~25–70 lines) |
| Sidecar proxy + token refresh | `sidecar/src/lib/ehr-provider.ts` | `sidecar/src/lib/<provider>.ts` (~25–45 lines) |
| Admin Setup UI | `web/src/components/agent/EhrSetup.tsx` + `web/src/lib/integrations/ehr-admin.ts` | one entry in `web/src/lib/integrations/registry.ts` |
| Agent skill docs | — | `openclaw/workspace/skills/<provider>/SKILL.md` |

Admin-api router case in `sidecar/src/routes/admin-api.ts` (one `case "<provider>":` block per EHR). Cloud Function exports in `functions/src/index.ts`.

The admin Integrations panel (`web/src/pages/AgentPage.tsx` → `IntegrationsPanel`) maps over `EHR_PROVIDERS` from the registry — no UI glue needed to surface a new EHR.

## Connected providers

All ten share the factory + registry; none have had OAuth round-trips exercised end-to-end yet.

| Provider | Shape | Sandbox toggle | Sim | Skill doc |
|---|---|---|---|---|
| DrChrono | OAuth2 + REST | — | ✓ | `skills/drchrono/SKILL.md` |
| Athenahealth | OAuth2 + REST, Basic-auth token | preview/prod + `practiceId` | ✓ | `skills/athena/SKILL.md` |
| Elation Health | OAuth2 + REST | sandbox/prod | ✓ | `skills/elation/SKILL.md` |
| eClinicalWorks | SMART-on-FHIR R4 | per-practice URLs | ✓ | `skills/ecw/SKILL.md` |
| NextGen Healthcare | OAuth2 + REST | sandbox/prod | ✓ | `skills/nextgen/SKILL.md` |
| Tebra (Kareo) | OAuth2 + REST, Basic-auth token | — | ✓ | `skills/tebra/SKILL.md` |
| Greenway Health | OAuth2 + REST | sandbox/prod | ✓ | `skills/greenway/SKILL.md` |
| Practice Fusion | OAuth2 + REST, Basic-auth token | — | ✓ | `skills/pfusion/SKILL.md` |
| Cerner / Oracle Health | SMART-on-FHIR R4 | per-practice URLs | ✓ | `skills/cerner/SKILL.md` |
| Epic | SMART-on-FHIR R4 | per-practice URLs + App Orchard for prod | ✓ | `skills/epic/SKILL.md` |

All sim variants read from the shared `simulation/drchrono/patients` pool and reshape to each vendor's native response. One seed feeds every EHR.

## Data model

Three stores per provider, each holding what it's best at:

- **GCP Secret Manager** — `clientSecret` only (at `ehr_<provider>_client_secret`). Static OAuth app secret, rotates at most a few times a year. Access-audited, IAM-gated, versioned. The Functions SA needs `roles/secretmanager.admin`; the sidecar SA needs `roles/secretmanager.secretAccessor`.

- **Private Firestore subdoc** `integrations/{provider}/private/credentials` — `accessToken`, `refreshToken`, `tokenExpiresAt`. Tokens rotate every 5–60 min under load — too frequent for Secret Manager (version limit + pricing), so they stay in Firestore where writes are cheap. Rule: `allow read, write: if false` — **all client reads blocked**, including the super admin.

- **Public Firestore doc** `integrations/{provider}` — non-secret metadata:
  - `provider`, `enabled`, `status` (`"not-authorized"` | `"active"`)
  - `clientId`, `redirectUri`
  - Vendor extras: `practiceId` (Athena), `sandbox`/`preview` flags, `fhirBase`/`authUrl`/`tokenUrl` (SMART providers), `scope`, `grantedScope`, `practiceSubdomain` (DrChrono)
  - `connectedAt`, `updatedAt`, `connectedBy`
  - Rule: `isSuperAdmin()` read/delete; writes denied (Admin SDK bypasses rules).

Rationale: a compromised super-admin browser session (XSS, malicious extension, credential theft) cannot exfiltrate OAuth tokens (private subdoc is ALL-DENY) or the long-lived client secret (lives in Secret Manager, no browser code path fetches it). The browser's worst case is reading public metadata.

Factories merge all three at read time: `loadConfig` in `ehr-provider.ts` (sidecar) and the equivalent in `ehr-oauth.ts` (Functions) fetch public doc + private subdoc + Secret Manager in parallel and return a merged config object.

### Disconnect flow

Disconnecting an integration deletes all three stores. The `<provider>Disconnect` callable (super-admin only) removes the public doc, the private subdoc, and the SM secret in one go. Direct `deleteDoc` from the browser is no longer used (would orphan the subdoc + SM secret).

### 401 auto-recovery (proxy)

`makeEhrProvider`'s `proxy` handles 401s where the locally-stored access token still looks fresh (`tokenExpiresAt` in the future) but the upstream rejects it — typical when the token was revoked vendor-side, rotated by a parallel session, or the sidecar's clock skewed past the upstream's. On 401 the proxy calls `getAccessToken(true)` once (force-refresh, bypasses the 5-min expiry buffer) and re-issues the request. A second 401 surfaces the upstream response unchanged — at that point the refresh token itself is dead and the practice needs to re-authorize. This shares the same retry budget as the existing 429 backoff (5 attempts total, single 401 retry inside that).

## Security posture

- **Callables** — `saveCredentials`, `authorize`, `setEnabled` all enforce `assertSuperAdmin`. Practice admins cannot save or toggle integrations.
- **Firestore rules** — public doc super-admin-only; private subdoc ALL-DENY (Admin SDK writes).
- **Setup UI** — the Integrations tab in `AgentPage` is conditionally rendered only for super admins (email allowlist from `web/src/lib/roles.ts`). Non-super-admin attempts to select the tab fall back to the Chat view.
- **OAuth state JWT** — 10-minute HS256 token on the authorize → callback round-trip, prevents an attacker from feeding their own `?code=` directly to the callback and overwriting the practice's tokens. Signing secret: `GOOGLE_WORKSPACE_ENCRYPTION_KEY` (reused across all integration flows).
- **Super-admin emails** — allowlisted in three sync points (`web/src/lib/roles.ts`, `functions/src/superAdmins.ts`, `firestore.rules`).

### What a practice admin can see

A practice admin (non-super) trying to use the Integrations tab gets:
- Tab hidden from the AgentPage sidebar
- Direct Firestore read of `integrations/*` → permission denied
- Callables → `assertSuperAdmin` throws
- `UnifiedPatientCard`'s `getDrChronoStatus` (used for chart URL subdomain) silently fails via `.catch()` → chart URLs fall back to the generic `app.drchrono.com`

### What a super admin can see

Super-admin browser can read the public doc (to populate Setup form) but:
- `clientSecret` never leaves the private subdoc
- `accessToken`, `refreshToken`, `tokenExpiresAt` never leave the private subdoc
- `ehr-admin.ts` `getIntegrationStatus` additionally whitelists out known-secret keys as defense-in-depth

## Adding a new EHR (recipe)

1. `functions/src/<provider>.ts` — `makeEhrOAuth({…})` with URLs, default scope, and optional `validateExtraFields` / `tokenExchangeAuth` / `extraAuthorizeParams` / `resolvePostAuthFields`.
2. `sidecar/src/lib/<provider>.ts` — `makeEhrProvider({…})` with `resolveApiBase`, `resolveTokenUrl`, `tokenRefreshAuth`, optional `buildUrl` / `extraReadyChecks` / `acceptHeader`.
3. Export the four callables (`<provider>SaveCredentials` / `Authorize` / `Callback` / `SetEnabled`) from `functions/src/index.ts`.
4. Add a router case in `sidecar/src/routes/admin-api.ts` — mirror the existing EHR cases (sim branch, assertReady, proxy).
5. Add one entry to `EHR_PROVIDERS` in `web/src/lib/integrations/registry.ts` — UI picks up badges, extra fields, validation, and help text automatically.
6. Write `openclaw/workspace/skills/<provider>/SKILL.md`.
7. (Optional) `sidecar/src/sim/<provider>.ts` — transform the shared patient pool to the vendor's shape for Aurelia's sim mode.

No UI component to write. No new tests to wire. Build each workspace and push.

## Detaching from a fork

To remove all EHR integrations from a customer fork:
- Delete the per-vendor spec files under `functions/src/`, `sidecar/src/lib/`, `openclaw/workspace/skills/`, and the matching entries in `registry.ts` + `admin-api.ts` + `index.ts`.
- Leave the factories in place; they're tiny if unused.
- `integrations/*` Firestore docs can be deleted manually — the callables can still handle `disconnect*` via the UI if the fork keeps any Setup card mounted.

## Outstanding TODOs

### Verification (deferred — real-provider path unexercised)

Demo runs in simulation mode (the sidecar router's sim branch precedes `assertReady`, so no clientSecret / Secret Manager / token lookup is needed to use the integrations tab for sim-mode work). The real OAuth path is deployed and IAM-wired but has never completed a live round-trip. Do these before pointing the demo at any real customer practice:

- [ ] **Browser-verify end-to-end** — sign in as super admin at `/admin/agent → Integrations`, walk through save-creds → authorize → toggle → disconnect for at least one EHR. Pick DrChrono first (simplest spec).
- [ ] **Exercise Athena preview sandbox** — Basic-auth token exchange + practiceId URL prefix make Athena the farthest from the DrChrono reference.
- [ ] **Confirm the split-doc model** — after save, verify `clientSecret` lands in Secret Manager (`ehr_drchrono_client_secret`), NOT the public doc or private subdoc. After authorize, verify `accessToken`/`refreshToken` land in `integrations/{id}/private/credentials`. Verify the super-admin browser network tab never requests the private subdoc.
- [ ] **Confirm disconnect cleanup** — disconnect removes public doc + private subdoc + SM secret in one callable. Pre-refactor `deleteDoc` path would have orphaned the private subdoc + SM secret.
- [ ] **If simulation mode gets turned off** and no real integration is configured — agent EHR calls currently fail with 403 (`integration is disabled` or `not configured`). That's correct. If you want a softer fallback (e.g. Aurelia surfaces "EHR not connected" rather than a raw 403), add a mode check in the skill error handler.

### Deferred hardening

- [x] ~~Secret Manager for `clientSecret`~~ — done; see "Data model" above. Tokens stay in Firestore (rotation frequency incompatible with SM's version model).
- [ ] **Token rotation on long-lived refresh tokens** — providers that never rotate refresh tokens (DrChrono, some SMART deployments) accumulate long-lived credentials. Consider a scheduled `refreshAndRotate` job that force-refreshes tokens monthly.

## Per-fork setup

Before first use of integrations in a new customer fork:

```bash
# 1. Enable Secret Manager on the project
gcloud services enable secretmanager.googleapis.com --project=<PROJECT_ID>

# 2. Grant the Functions SA admin (create / addVersion / delete)
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.admin

# 3. Grant the sidecar SA accessor (read only).
# If the sidecar uses the same compute SA (default), step 2 covers it.
# Otherwise:
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member=serviceAccount:<sidecar-sa>@<PROJECT_ID>.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

Without these, `saveCredentials` fails with `PERMISSION_DENIED` and token refresh in the sidecar fails the same way.

### Next-tier providers (optional, ~30 min each)

MEDITECH, Allscripts / Veradigm, athenaIDX, Greenway Success EHR, eClinicalWorks healow (patient-facing). All would clone an existing spec — MEDITECH / Veradigm as SMART-on-FHIR (→ clone `ecw.ts`), the others as OAuth2 REST (→ clone `drchrono.ts` or `elation.ts`).

## File map

```
functions/src/
  lib/ehr-oauth.ts               # OAuth callable factory
  lib/superAdmins.ts             # assertAdmin, assertSuperAdmin
  drchrono.ts                    # ~25 line spec
  athena.ts                      # ~45 lines (Basic-auth + practiceId)
  elation.ts                     # ~30 lines
  ecw.ts                         # ~70 lines (SMART custom URLs)
  nextgen.ts                     # ~30 lines
  tebra.ts                       # ~30 lines
  greenway.ts                    # ~30 lines
  pfusion.ts                     # ~30 lines
  cerner.ts                      # ~60 lines (SMART)
  epic.ts                        # ~65 lines (SMART)
  index.ts                       # re-exports the four callables per EHR

sidecar/src/
  lib/ehr-provider.ts            # proxy + token refresh factory
  lib/<provider>.ts              # one per EHR, ~25–45 lines
  routes/admin-api.ts            # router case per EHR
  sim/<provider>.ts              # shape-transform on shared patient pool

web/src/
  lib/integrations/registry.ts   # EHR_PROVIDERS single source of truth
  lib/integrations/ehr-admin.ts  # generic callable + Firestore client
  components/agent/EhrSetup.tsx  # one generic Setup card
  pages/AgentPage.tsx            # Integrations tab maps over registry
  lib/drchrono.ts                # ONLY chart-URL helper (UnifiedPatientCard)

openclaw/workspace/skills/<provider>/SKILL.md
firestore.rules                  # integrations/{id} + private subdoc rules
```

## Related docs

- [`docs/SIMULATION.md`](SIMULATION.md) — sim/real middleware, shared patient pool, detach recipe
- [`docs/AI_AGENTS.md`](AI_AGENTS.md) — Aurelia, sidecar, agent skill loading
