# EHR Integrations

Each EHR follows the same four-file pattern, gated on `integrations/<provider>.enabled === true`:

| Layer | File |
|---|---|
| OAuth + callback + token refresh (Functions) | `functions/src/<provider>.ts` |
| Sidecar proxy + token refresh | `sidecar/src/lib/<provider>.ts` |
| Web status/save/toggle client | `web/src/lib/<provider>.ts` |
| Admin setup UI | `web/src/components/agent/<Provider>Setup.tsx` |

Admin-api router case in `sidecar/src/routes/admin-api.ts`. Cloud Function exports in `functions/src/index.ts`.

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
