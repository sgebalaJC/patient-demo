# EHR Integrations

All EHR integrations share two factories; per-vendor files are thin specs (~20–60 lines):

| Layer | Shared factory | Per-vendor spec |
|---|---|---|
| OAuth callables + callback (Functions) | `functions/src/lib/ehr-oauth.ts` | `functions/src/<provider>.ts` |
| Sidecar proxy + token refresh | `sidecar/src/lib/ehr-provider.ts` | `sidecar/src/lib/<provider>.ts` |
| Web status/save/toggle client | — | `web/src/lib/<provider>.ts` |
| Setup UI | — | `web/src/components/agent/<Provider>Setup.tsx` |

Admin-api router case in `sidecar/src/routes/admin-api.ts`. Cloud Function exports in `functions/src/index.ts`.

## Super-admin gating

Integration credentials are platform-level, not per-practice.

- **Callables** — `functions/src/lib/ehr-oauth.ts` uses `assertSuperAdmin` on `saveCredentials`, `authorize`, `setEnabled`.
- **Firestore** — `integrations/*` read/delete is `isSuperAdmin()` only. Practice admins cannot read the OAuth secrets, tokens, or scopes.
- **Setup UI** — MUST be wrapped in `<AdminGuard superOnly>` when mounted. The UI components (`DrChronoSetup`, `AthenaSetup`, `ElationSetup`, `EcwSetup`) are otherwise routable by any admin.
- **Non-secret reads** — `UnifiedPatientCard` reads `practiceSubdomain` from `integrations/drchrono` for chart URL formatting; non-super-admins now fail that fetch silently and fall back to the generic `app.drchrono.com` URL (already handled with `.catch()`).

## Secret storage

OAuth client secrets, access tokens, and refresh tokens are stored in Firestore at `integrations/{provider}`. They are:
- Encrypted at rest by Firestore's default CMEK-capable storage
- Writable only by Cloud Functions via Admin SDK (Firestore rules deny client writes)
- Readable only by the super admin (email allowlist)
- Never returned to the browser — the web thin clients whitelist non-secret fields in `getStatus()`

For a stricter posture (per-practice forks, multi-tenant), the next step is to split secrets into a `integrations-secrets/{provider}` collection that not even the super admin's browser reads — credentials would then be writeable via callable and readable only server-side. Not needed for single-super-admin demo.

## Connected

| Provider | Skill doc | Sim | End-to-end tested |
|---|---|---|---|
| DrChrono | `openclaw/workspace/skills/drchrono/SKILL.md` | ✓ `sim/drchrono.ts` | ✓ |
| Athenahealth | `openclaw/workspace/skills/athena/SKILL.md` | ✓ `sim/athena.ts` (shared pool) | — |
| Elation Health | `openclaw/workspace/skills/elation/SKILL.md` | ✓ `sim/elation.ts` (shared pool) | — |
| eClinicalWorks (SMART-on-FHIR) | `openclaw/workspace/skills/ecw/SKILL.md` | ✓ `sim/ecw.ts` (shared pool) | — |
| NextGen Healthcare | `openclaw/workspace/skills/nextgen/SKILL.md` | — (501 in sim) | — |
| Tebra (Kareo) | `openclaw/workspace/skills/tebra/SKILL.md` | — (501 in sim) | — |

## TODO — clone the pattern

- [ ] **Greenway (Intergy / Prime Suite)** — OAuth2 + REST. Clone `elation.ts`.
- [ ] **Practice Fusion** — OAuth2 + REST. Clone `drchrono.ts`.
- [ ] **Cerner / Oracle Health** — SMART-on-FHIR. Clone `ecw.ts`.
- [ ] **Epic** — SMART-on-FHIR. Requires App Orchard enrollment. Clone `ecw.ts`.

Each is ~30 min of glue code once the vendor assigns client id/secret (or an App Orchard slot).

## TODO — verification

- [ ] **Browser-verify the factory refactor** — sign in as super admin at `/admin/agent → Integrations` and walk through save-creds / authorize / toggle for at least one EHR. Builds pass; OAuth round-trips are untested end-to-end since the factories landed.
- [ ] **Exercise Athena's preview sandbox** — Athena's Basic-auth token exchange path is the farthest from the DrChrono reference. Smoke-test it against preview before pointing a real practice at it.

## TODO — deferred hardening

- [ ] **Split secrets into a private subcollection** — move `clientSecret`, `accessToken`, `refreshToken` to `integrations/{provider}/private/credentials`; parent doc keeps non-secret meta (enabled, status, practiceSubdomain, etc.). Rules: parent readable by admins (for chart-URL helpers), private doc super-admin-only. Only worth doing if super-admin widens beyond one email or we move to multi-tenant.
- [ ] **Secret Manager instead of Firestore** — push client secrets to GCP Secret Manager via `firebase functions:secrets:set`, store only a secret-name reference in Firestore. Requires a Functions redeploy on each credential change.
