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

- [x] **DrChrono** — OAuth2 authorization code, REST
- [x] **Athenahealth** — OAuth2 authorization code, REST, preview/prod + practice id
- [x] **Elation Health** — OAuth2 authorization code, REST, sandbox/prod
- [x] **eClinicalWorks** — SMART-on-FHIR R4, per-practice URLs

## TODO — clone the pattern

- [ ] **NextGen** — OAuth2 + REST. Clone `elation.ts`.
- [ ] **Kareo / Tebra** — OAuth2 + REST. Clone `drchrono.ts`.
- [ ] **Greenway (Intergy / Prime Suite)** — OAuth2 + REST. Clone `elation.ts`.
- [ ] **Practice Fusion** — OAuth2 + REST. Clone `drchrono.ts`.
- [ ] **Cerner / Oracle Health** — SMART-on-FHIR. Clone `ecw.ts`.
- [ ] **Epic** — SMART-on-FHIR. Requires App Orchard enrollment. Clone `ecw.ts`.

Each is ~30 min of glue code once the vendor assigns client id/secret (or an App Orchard slot).

## Deferred work

- **Super-admin gating** — callables currently use `assertAdmin`. When the Integrations tab is mounted, gate the tab in the React tree on super-admin; optionally tighten callables to `assertSuperAdmin`.
- **Setup UI mount point** — `<Provider>Setup` components exist but aren't rendered anywhere. Add a tab to `AgentPage` (callbacks redirect to `/admin/agent?tab=integrations`).
- **Factor the factory** — 4× near-identical token/proxy pairs. A `makeEhrProvider({ apiBase, tokenUrl, authUrl, scope, pathPrefix })` would collapse ~80% of each file. Do this when adding #5.
- **Sim branches** — router cases return 501 in sim mode with `TODO(sim)` markers; the centralized-sim work will wire `simAthena` / `simElation` / `simEcw`.
