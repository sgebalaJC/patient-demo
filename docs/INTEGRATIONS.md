# Integrations

Customer-configurable third-party services. Each fork provisions them at runtime through the admin Integrations panel — no per-fork code edits, no redeploy for a credential rotation.

**Panel:** `/admin/agent → Integrations` (super-admin only).

**Two groups, one separator:**
- **Common** — project-wide services used across multiple features (Google Workspace, SignalWire, Slack).
- **EHR** — per-practice electronic health record connections (DrChrono, Athena, Elation, eCW, NextGen, Tebra, Greenway, Practice Fusion, Cerner, Epic).

Everything else (Firebase config, Stripe keys, sidecar host address, SMTP fallback) stays at fork level by design — see [What does *not* belong here](#what-does-not-belong-here).

## Architecture

```
┌──────────────────┐                ┌─────────────────────┐
│  Admin browser   │──HTTPS───────→│  Cloud Function     │
│  (super admin)   │  callable      │  (requireAdmin gate)│
└──────────────────┘                └──────────┬──────────┘
                                               │ Admin SDK (bypasses rules)
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                      │ Firestore    │ │ Secret       │ │ Sidecar      │
                      │ integrations │ │ Manager      │ │ (Bun HTTP)   │
                      │ /{id}        │ │ <secret-key> │ │ admin-api/*  │
                      │ non-secrets  │ │ sensitive    │ │ runtime call │
                      └──────────────┘ └──────────────┘ └──────────────┘
```

### Credential storage model

| Kind | Stored in | Who can write | Who can read |
|---|---|---|---|
| Non-secret routing (projectId, URL, phone, label, email) | Firestore `integrations/{id}` | Cloud Function via Admin SDK | Super-admin (via Firestore rules); Cloud Functions + sidecar (Admin SDK) |
| Sensitive secret (OAuth client secret, auth token, SA private key) | Secret Manager (`<integration>_<secret>` name) | Cloud Function service account (`roles/secretmanager.admin`) | Cloud Function SA + sidecar SA (`roles/secretmanager.secretAccessor`) |
| Rotating token (OAuth refresh/access token) | Firestore `integrations/{id}/private/*` | Cloud Function | Admin SDK only — Firestore rules deny all client reads |

**Why the split:** Secret Manager charges per version and caps at 10k versions per secret — fine for tokens rotated once a quarter in a vendor portal, catastrophic for OAuth refresh tokens that re-mint every hour. So: vendor-rotated secrets live in Secret Manager; app-rotated tokens live in the `private/` subcollection and are read exclusively by Admin SDK.

### Firestore rules

`integrations/{id}` — super-admin read/delete only. Create/update is blocked (`allow create, update: if false`) — all writes must flow through Cloud Functions so they can enforce validation and Secret Manager writes atomically.

`integrations/{id}/private/*` — `read, write: if false`. Only Admin SDK touches it.

### Cloud Function gate

Every `save*Credentials` / `disconnect*` callable starts with:

```ts
const authContext = await requireAdmin(request);  // or requireSuperAdmin
```

This checks the caller's role from the Firestore `users/{uid}` doc — not from Firebase custom claims, and not from request data. Non-admins never reach the Secret Manager write.

## The two patterns

### Pattern A — single-tenant common integration (SignalWire, Google Workspace, Slack)

One set of credentials per project. The integration is a single Firestore doc and (optionally) one Secret Manager entry.

**Files:**
- `web/src/components/agent/<Name>Setup.tsx` — admin card
- `web/src/lib/<name>.ts` — thin client (get status + call the callables)
- `functions/src/<name>.ts` or helpers under `functions/src/lib/` — runtime loader
- `functions/src/index.ts` — `save<Name>Credentials` + `disconnect<Name>` callables
- `functions/src/lib/secret-manager.ts` — `get<Name>Secret` / `set<Name>Secret` / `delete<Name>Secret` helpers if there's a sensitive value

**Runtime read:** a cached loader (`load<Name>Config()`) that reads Firestore + Secret Manager and returns `null` on missing config. Callers decide whether that's fatal.

### Pattern B — EHR integration

EHRs share a factory. Ten providers live in one registry; new providers are a single object literal, not a full scaffold.

**Files:**
- `web/src/lib/integrations/registry.ts` — add an entry to `EHR_PROVIDERS` (id, name, icon, field defs, optional OAuth hints)
- `web/src/components/agent/icons/ProductIcons.tsx` — add a brand icon component
- `functions/src/<provider>.ts` — usually extends `lib/ehr-oauth.ts` with provider-specific fields

The generic `EhrSetup.tsx` renders every registry entry automatically. `saveCredentials(provider, …)` / `authorize(provider)` / `setEnabled(provider, bool)` callables resolve by provider id.

Secrets: `ehr_<provider>_client_secret` Secret Manager name. Firestore: `integrations/<provider>` (clientId, enabled, redirectUri, sandbox flags, optional practice id, status).

## Add a new common integration (playbook)

Use this for a vendor like Twilio, Plaid, Stripe-for-payouts, Zapier, etc. Skip if the vendor is an EHR — use the registry instead.

1. **Brand icon.** Add `<Name>Icon` to `web/src/components/agent/icons/ProductIcons.tsx`. Monogram tile with brand color works; a real logo is nicer if available.
2. **Config shape.** Decide which fields are sensitive (→ Secret Manager) vs routing (→ Firestore).
3. **Secret Manager helpers** (only if sensitive creds): extend `functions/src/lib/secret-manager.ts` with `get<Name>Secret` / `set<Name>Secret` / `delete<Name>Secret`, mirroring `getGoogleServiceAccountKey` / `getSignalwireAuthToken`.
4. **Runtime loader:** `functions/src/lib/<name>-config.ts` — reads Firestore + Secret Manager, 10-second in-memory cache, returns `null` on missing config. Expose `invalidate<Name>Config()` so the save callable can flush after a write.
5. **Callables:** add `save<Name>Credentials` and `disconnect<Name>` to `functions/src/index.ts`. Gate with `requireAdmin`. Validate inputs with clear `HttpsError('invalid-argument', …)` messages. Accept empty secret field = "keep existing". Call `invalidate<Name>Config()` after a write.
6. **Web client:** `web/src/lib/<name>.ts` with `get<Name>Status()` (direct Firestore read, non-secrets only) and `save<Name>Credentials()` / `disconnect<Name>()` (callable wrappers).
7. **Admin card:** `web/src/components/agent/<Name>Setup.tsx`. Pattern: load status → show connected state or "Configure" button → inline form with password fields for secrets → "Save" calls the callable → `disconnect` confirms with `ConfirmModal`.
8. **Mount it:** add `<Name>Setup />` to the Common section in `web/src/pages/AgentPage.tsx::IntegrationsPanel`.
9. **Rewire the runtime** — any code currently reading `process.env.<NAME>_*` should go through the new loader. Keep env as fallback during the rollout so existing forks don't break. Drop the fallback in a follow-up after all forks have migrated.
10. **Sim/real middleware** — if this integration can be simulated, add a sim branch under `sidecar/src/sim/` and the admin UI's `useSimulationMode()` flag will route reads to `simulation/*`. See [`SIMULATION.md`](SIMULATION.md).
11. **Agent skill** — if the AI agent should call this integration, add a skill file under `openclaw/workspace/skills/<name>.md` describing the proxy endpoint. See [`AI_AGENTS.md`](AI_AGENTS.md).

## Add a new EHR provider

Most of the scaffolding already exists — you're adding a row, not a file.

1. **Icon:** append to `ProductIcons.tsx`.
2. **Registry:** append an `EhrProviderDef` to `EHR_PROVIDERS` in `web/src/lib/integrations/registry.ts`. Required: id, name, icon, description, activeDescription, clientIdPlaceholder, clientSecretRequired. Optional: extraFields (sandbox, practice id, FHIR base URL), setupHelp, extraBadges, staticBadges.
3. **Provider module:** add `functions/src/<id>.ts` exporting the three standard callables (`save<Id>Credentials`, `authorize<Id>`, `set<Id>Enabled`). For OAuth 2.0 / FHIR flows extend `lib/ehr-oauth.ts` rather than duplicating.
4. **Sidecar:** add `/admin-api/<id>/*` routes under `sidecar/src/real/ehr-<id>.ts` (and sim counterpart). Per-handler real/sim branching, not global.
5. **Agent skill:** `openclaw/workspace/skills/<id>.md`.

See [`EHR_INTEGRATIONS.md`](EHR_INTEGRATIONS.md) for the full walkthrough including OAuth redirect-URI registration and per-fork Secret Manager IAM.

## Per-fork IAM (one-time)

Every fork needs:

```bash
gcloud services enable secretmanager.googleapis.com --project=<PROJECT_ID>

# Cloud Functions SA — create/update/delete secrets from save*Credentials callables
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.admin

# Sidecar SA — read secrets at runtime (if different from the compute SA)
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member=serviceAccount:<sidecar-sa>@<PROJECT_ID>.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

Without these, `save*Credentials` callables fail on the Secret Manager write with `PERMISSION_DENIED`. This is step 6 in [`FORK_CHECKLIST.md`](FORK_CHECKLIST.md).

## Backward compatibility

When migrating an integration from env-only to admin-managed:

- **Don't delete the `defineSecret()` binding.** Leave it in place so Cloud Functions still have access to the env fallback.
- **Runtime loader prefers Firestore + Secret Manager**, falls back to env when both are empty.
- **Remove the fallback in a follow-up PR** once every fork has completed the admin-UI setup. Track the deprecation in [`ROADMAP.md`](ROADMAP.md).

The SignalWire migration (`loadSignalwireConfig` in `functions/src/lib/signalwire-config.ts`) is the reference implementation.

## What does *not* belong here

Some things look like integrations but shouldn't be in the admin panel:

| Thing | Why it stays out | Where it lives |
|---|---|---|
| Firebase Web API key | Public routing id, not a credential. Needed at page load before any Firestore read. | `web/apphosting.yaml` via Secret Manager reference |
| Stripe keys | Practice owns the Stripe account; billing is not a swap-out integration. | `functions/src/stripe.ts` + `defineSecret()` |
| Sidecar host URL + API key | Infrastructure, not a customer choice. Differs per fork (GCE, Hetzner, etc). | Secret Manager (`SIDECAR_URL_SECRET`, `SIDECAR_API_KEY_SECRET`) |
| SMTP (optional welcome email) | Optional, gracefully no-ops when missing; practice-owned Gmail account. | `process.env.SMTP_USER` / `SMTP_PASS` on the fork's functions env |
| Fork branding / colors / name | One-time per fork, not runtime-configurable. | `/fork.config.ts` + `mobile/lib/config/branding.dart` |

Rule of thumb: if a customer-facing admin could plausibly want to rotate/change it without touching code, it belongs in the panel. Otherwise keep it at fork level.

## Sim/real middleware

The `system/settings.simulationMode` flag flips every integration between real vendor calls and a seeded Firestore sandbox. Each integration's runtime loader should check `isSimulationOn()` and early-return the sim branch. See [`SIMULATION.md`](SIMULATION.md) for the detach path and how to add a new domain.

## Related docs

- [`EHR_INTEGRATIONS.md`](EHR_INTEGRATIONS.md) — EHR factory, OAuth flows, per-fork setup
- [`SIGNALWIRE_SMS.md`](SIGNALWIRE_SMS.md) — SMS specifics (outbound templates, inbound webhook HMAC)
- [`FAX_INGESTION.md`](FAX_INGESTION.md) — fax-forward email flow (uses the Google Workspace SA)
- [`AI_AGENTS.md`](AI_AGENTS.md) — agent skills, how integrations expose themselves to OpenClaw
- [`SIMULATION.md`](SIMULATION.md) — one-switch sim/real
- [`FORK_CHECKLIST.md`](FORK_CHECKLIST.md) — per-customer fork setup including IAM
