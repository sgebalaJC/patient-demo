# EHR Integrations

All EHR integrations share three generic layers. Each new vendor is a thin spec that hooks into them.

| Layer | Shared | Per-vendor spec |
|---|---|---|
| OAuth callables (Functions) | `functions/src/lib/ehr-oauth.ts` | `functions/src/<provider>.ts` (~25 lines) |
| Sidecar proxy + token refresh | `sidecar/src/lib/ehr-provider.ts` | `sidecar/src/lib/<provider>.ts` (~25 lines) |
| Admin Setup UI | `web/src/components/agent/EhrSetup.tsx` + `web/src/lib/integrations/ehr-admin.ts` | one entry in `web/src/lib/integrations/registry.ts` |
| Agent skill docs | — | `openclaw/workspace/skills/<provider>/SKILL.md` |

Admin-api router case in `sidecar/src/routes/admin-api.ts`. Cloud Function exports in `functions/src/index.ts`.

## Adding a new EHR (recipe)

1. `functions/src/<provider>.ts` — `makeEhrOAuth({…})` with URLs, scope, any vendor-specific extra-field validator.
2. `sidecar/src/lib/<provider>.ts` — `makeEhrProvider({…})` with API base + token refresh auth.
3. Export callables from `functions/src/index.ts`.
4. Add router case in `sidecar/src/routes/admin-api.ts` (mirror the existing ones).
5. Add an entry in `web/src/lib/integrations/registry.ts` — UI, badges, extra fields picked up automatically by `EhrSetup`.
6. Write `openclaw/workspace/skills/<provider>/SKILL.md`.

No UI glue code needed — the Integrations panel in `AgentPage` maps over the registry.

## Super-admin gating

Integration credentials are platform-level, not per-practice.

- **Callables** — `functions/src/lib/ehr-oauth.ts` uses `assertSuperAdmin` on `saveCredentials`, `authorize`, `setEnabled`.
- **Firestore** — `integrations/*` read/delete is `isSuperAdmin()` only. Practice admins cannot read the OAuth secrets, tokens, or scopes.
- **Setup UI** — MUST be wrapped in `<AdminGuard superOnly>` when mounted. The UI components (`DrChronoSetup`, `AthenaSetup`, `ElationSetup`, `EcwSetup`) are otherwise routable by any admin.
- **Non-secret reads** — `UnifiedPatientCard` reads `practiceSubdomain` from `integrations/drchrono` for chart URL formatting; non-super-admins now fail that fetch silently and fall back to the generic `app.drchrono.com` URL (already handled with `.catch()`).

## Secret storage

Split-doc model:

- **Public doc** `integrations/{provider}` — non-secret metadata (provider, enabled, status, clientId, redirectUri, practiceId/sandbox/preview/fhirBase/etc.). Rule: `isSuperAdmin()` read/delete. Super admin's browser reads this to populate the Setup form.
- **Private subdoc** `integrations/{provider}/private/credentials` — `clientSecret`, `accessToken`, `refreshToken`, `tokenExpiresAt`. Rule: `allow read, write: if false` — **all client reads blocked, including super admin**. Only Admin SDK (Cloud Functions + sidecar) touches it.

This means a compromised super-admin browser session (XSS, malicious extension) cannot exfiltrate OAuth tokens — no browser code path exists that reads the private subdoc. Writes flow exclusively through Cloud Functions (`saveCredentials`, `callback`) which use Admin SDK to bypass rules.

Migrating existing integrations: any integration saved before this split has secrets in the public doc. On next `saveCredentials` call, the factory re-splits — admin just re-enters the client secret. Or run a one-shot migration: read `clientSecret`/`accessToken`/`refreshToken`/`tokenExpiresAt` out of the public doc, write to the private subdoc, delete from public. Not needed for fresh deploys.

## Connected

| Provider | Skill doc | Sim | End-to-end tested |
|---|---|---|---|
| DrChrono | `openclaw/workspace/skills/drchrono/SKILL.md` | ✓ `sim/drchrono.ts` | ✓ |
| Athenahealth | `openclaw/workspace/skills/athena/SKILL.md` | ✓ `sim/athena.ts` (shared pool) | — |
| Elation Health | `openclaw/workspace/skills/elation/SKILL.md` | ✓ `sim/elation.ts` (shared pool) | — |
| eClinicalWorks (SMART-on-FHIR) | `openclaw/workspace/skills/ecw/SKILL.md` | ✓ `sim/ecw.ts` (shared pool) | — |
| NextGen Healthcare | `openclaw/workspace/skills/nextgen/SKILL.md` | ✓ `sim/nextgen.ts` (shared pool) | — |
| Tebra (Kareo) | `openclaw/workspace/skills/tebra/SKILL.md` | ✓ `sim/tebra.ts` (shared pool) | — |
| Greenway Health | `openclaw/workspace/skills/greenway/SKILL.md` | ✓ `sim/greenway.ts` (shared pool) | — |
| Practice Fusion | `openclaw/workspace/skills/pfusion/SKILL.md` | ✓ `sim/pfusion.ts` (shared pool) | — |
| Cerner / Oracle Health | `openclaw/workspace/skills/cerner/SKILL.md` | ✓ `sim/cerner.ts` (shared pool) | — |
| Epic | `openclaw/workspace/skills/epic/SKILL.md` | ✓ `sim/epic.ts` (shared pool) | — |

## TODO — clone the pattern

All major ambulatory EHRs shipped. Next tier (inpatient / specialty): MEDITECH, Allscripts/Veradigm, athenaIDX, Greenway Success EHR, eClinicalWorks healow (patient-facing).

Each is ~30 min of glue code once the vendor assigns client id/secret (or an App Orchard slot).

## TODO — verification

- [ ] **Browser-verify the factory refactor** — sign in as super admin at `/admin/agent → Integrations` and walk through save-creds / authorize / toggle for at least one EHR. Builds pass; OAuth round-trips are untested end-to-end since the factories landed.
- [ ] **Exercise Athena's preview sandbox** — Athena's Basic-auth token exchange path is the farthest from the DrChrono reference. Smoke-test it against preview before pointing a real practice at it.

## TODO — deferred hardening

- [x] ~~Split secrets into a private subcollection~~ — done; see "Secret storage" above.
- [ ] **Secret Manager instead of Firestore** — push client secrets to GCP Secret Manager via `firebase functions:secrets:set`, store only a secret-name reference in Firestore. Requires a Functions redeploy on each credential change. Heavier than the split-doc model but removes Firestore as a secrets store entirely.
- [ ] **End-to-end browser test the split-doc model** — save/authorize/toggle flow for one EHR, confirm that `integrations/{provider}/private/credentials` is only ever written by functions, never read by the browser.
