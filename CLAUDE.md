# Patient Portal (template)

Generic HIPAA-posture patient engagement platform. Fork per customer, one dedicated Firebase project per fork. See `README.md` for the customer onboarding workflow.

## Tech Stack

- **Web:** React 18 + TypeScript, Vite, Tailwind CSS, React Router v6
- **Mobile:** Flutter 3.41+, Dart 3.11+, Provider state
- **Backend:** Firebase (Auth, Firestore, Storage, Cloud Functions v2)
- **External:** SignalWire (SMS + fax via LaML), Google Maps, Google Workspace (Gmail/Calendar/Drive), Stripe (billing), Anthropic via OpenClaw gateway (agent LLM calls)
- **EHR integrations:** DrChrono, Athena, Elation, eClinicalWorks, NextGen, Tebra, Greenway, Practice Fusion, Cerner, Epic — all via sidecar admin-api with OAuth per practice
- **AI agents:** OpenClaw admin + patient support agents on a customer-owned VPS, proxied via Cloud Functions
- **Node:** v22

## Project Structure

```
fork.config.ts # ★ PER-CUSTOMER: single source of truth for web + functions branding
web/           # React SPA (Vite)
  src/config/
    branding.ts      # adapter over /fork.config.ts — do not edit
    features.ts      # feature flags
  src/pages/         # Route-level pages
  src/components/    # Feature-organized; ui/ primitives; chat/ shared admin+patient
  src/lib/           # firebase, firestore/ (incl. subscriptions.ts), sidecar, slack, storage, validation
  src/contexts/      # AuthContext
  src/hooks/         # useAuth, useFeatures, usePagination
  src/types/         # TypeScript types
mobile/        # Flutter patient app
  lib/config/
    branding.dart    # ★ PER-CUSTOMER: mirror of /fork.config.ts (Flutter can't import TS)
    constants.dart, colors.dart, firebase_config.dart
  lib/services/firestore/   # Per-collection service classes incl. subscriptions_service.dart
  lib/widgets/              # Shared widgets (SubscriptionStatusCard, etc.)
functions/     # Cloud Functions (Node 22)
  src/branding.ts    # adapter over _fork.config.ts (auto-copied by prebuild)
  src/index.ts       # Shared entry (SMS reminders, user management, calendar sync)
  src/stripe.ts      # Stripe Checkout, cancel, webhook → Firestore mirror
sidecar/       # Bun sidecar API deployed to customer host
openclaw/      # ★ PER-CUSTOMER: AI agent workspace templates with {{PLACEHOLDER}} tokens
firestore.rules, storage.rules, firebase.json, firestore.indexes.json
```

★ = files every fork edits.

## Development

```bash
# From web/
npm run dev                 # Vite dev server
npm run emulators           # Firebase emulators (persisted)
npm run emulators:fresh     # Fresh emulators
npm run build && npm run lint

# From functions/
npm run build

# From mobile/
flutter run && flutter analyze
```

Emulator ports: Firestore 8080, Auth 9099, Storage 9199, Functions 5001, UI 4000. Java 21+ required — `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`.

## Key Patterns

- **Branding:** Single source of truth is `/fork.config.ts` at the repo root. `web/src/config/branding.ts` imports it directly; `functions/src/branding.ts` reads `functions/src/_fork.config.ts`, a copy made by the functions `prebuild` hook. Edit `/fork.config.ts` — never the adapter files. Mobile still mirrors manually at `mobile/lib/config/branding.dart`. Never hardcode the practice name in new code; import `BRANDING` (web) or `FUNCTIONS_BRANDING` (functions) and template it.
- **Auth:** Firebase Auth (email/password, Google OAuth, email link, phone OTP). Roles: `patient`, `admin`, `super_admin`, plus `assistant` (used only by the sidecar auth layer — agents calling back in; never granted admin scope by Firestore rules). **Passwordless by default** — admin-created users sign in via email link, Google OAuth, or phone OTP.
- **App Settings:** Global knobs in `system/settings` Firestore doc (`registrationEnabled`, `paginationSize`, `bootstrapped`). Publicly readable, admin-only write. `AppSettingsProvider` + `useAppSettings()` hook. `registrationEnabled: false` by default — self-signup blocked at every chokepoint when off.
- **Bootstrap first admin:** WordPress-style. `AuthPage` renders `BootstrapAdminForm` when `system/settings.bootstrapped === false`. Client writes `bootstrap-requests/{uuid}`, `onBootstrapRequestCreated` Firestore trigger processes it and writes a custom token back, client signs in via `signInWithCustomToken`. **Firestore trigger, not `onCall`** — GCP orgs with `iam.allowedPolicyMemberDomains` (HIPAA-hardened) block public Cloud Run invocation. Trigger auto-heals by flipping `bootstrapped: true` if any user exists.
- **Admin invites:** `createUserWithAuth` creates passwordless users; `UserForm` then calls `sendInviteLink()` from the admin's browser. Optional welcome SMS via SignalWire.
- **Phone normalization:** All writes to `users.phoneNumber` MUST route through `normalizePhoneNumber`. Server `functions/src/lib/phone.ts`, web `web/src/lib/phone.ts`, mobile `mobile/lib/utils/phone.dart` — all three produce identical canonical 10-digit form (e.g. `"4425004657"`). Boundary calls to SignalWire / Firebase Auth wrap with `toE164(...)` to get `+1XXXXXXXXXX`. Never write raw input; non-US or malformed input throws `InvalidPhoneError` / `InvalidPhoneException`.
- **Routing:** Protected routes redirect to `/auth`. Admins access `/admin/*`. Patients use `/dashboard`, `/messages`, `/refills`, `/billing`, etc.
- **Data layer:** Firestore ops in `web/src/lib/firestore/` — one module per collection.
- **Validation:** Centralized `FIELD_LIMITS` in `web/src/lib/validation.ts`. Never hardcode limits in forms.
- **Feature flags:** `web/src/config/features.ts` — all enabled by default. Check with `useFeatures()`.
- **Forms:** React Hook Form + Zod. Max lengths from `FIELD_LIMITS`.
- **Shared UI:** Primitives in `components/ui/` — `BrandLogo`, `LoadingSpinner`, `PageHeader`, `StatsGrid`, `FilterTabs`, `EmptyState`, `PaginationBar`, `AccessDenied`. Never inline.
- **Styling:** Tailwind with `primary-*` / `secondary-*` tokens. Three themes: Classic, Brand (via branding.ts), Dark. After editing branding colors, also update `web/src/index.css[data-theme="brand"]` and `mobile/lib/providers/theme_provider.dart`.
- **Mobile auth gate:** Admin → blocked modal. Inactive → pending. Biometric locked → fingerprint/face prompt. Active patient → main app. Biometric default via `local_auth`, skipped on fresh sign-in. Android requires `FlutterFragmentActivity` + `USE_BIOMETRIC`.
- **Mobile notifications:** Patient actions create admin notifications. Message notifications deep-link via `meta.threadId`. Patients can read+update their own notifications.
- **File uploads:** Cloud Storage at `patients/{patientId}/documents/{documentType}/{fileName}`.
- **Chat persistence (non-blocking):** Admin chat in `agent-chat`, patient support in `support-chat`. **All Firestore saves in chat are fire-and-forget with `.catch()`** — show message in UI first, persist in background. Never `await` Firestore writes in the send flow. Never pass `undefined` fields; use conditional spread `...(field ? { field } : {})`.
- **Stripe billing:** Practice-owned Stripe account. Admins manage `subscription-plans` (doc id = Stripe price id). Patients subscribe via Stripe Checkout (hosted). `stripeWebhook` Cloud Function mirrors subscription state into `patient-subscriptions/{uid}`. Mobile app reads subscription state from Firestore but delegates checkout to the web `/billing` page via `url_launcher`.
- **AI Agents:** Two OpenClaw agents on a customer-owned host — admin agent (`main`) and patient support agent (`patient-support`). Unified auth via `sidecarProxy` Cloud Function. **Patient support agent has NO patient data access** (HIPAA defense in depth). Slack integration available via `/admin/agent → Channels`. **See [`docs/AI_AGENTS.md`](docs/AI_AGENTS.md) for hosts, health checks, Slack config, sidecar ops, and per-fork setup.**
- **Integrations (admin-configurable):** `integrations/{id}` Firestore collection holds admin-entered credentials (super-admin-only rules; writes go through callables). Two groups in the admin panel: **Common** (Google Workspace, SignalWire, Slack — project-wide) and **EHR** (DrChrono, Athena, Elation, eCW, NextGen, Tebra, Greenway, Practice Fusion, Cerner, Epic — per-practice). Each integration has a matching skill under `openclaw/workspace/skills/`. Calls fail-fast with 403 when disabled. Proxy path: `sidecarProxy → sidecar /admin-api/<integration>/<path>`. Non-secrets on the Firestore doc; sensitive secrets in Secret Manager (`<integration>_<secret>` naming). **See [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) for the architecture, the credential storage model, and the add-a-new-integration playbook.**
- **Google Workspace — two exclusive auth modes:** admin picks one at setup time in Agent → Integrations. (a) `service-account` — domain-wide delegation, service-account JSON key in Secret Manager (`google_workspace_sa_key`), impersonates a Workspace subject email; (b) `oauth` — three-legged OAuth, refresh-token cipher on the integration doc, agent acts as the authorized Gmail/Workspace user. Both persist `authMode` + `calendarId` on `integrations/google-workspace`; reminders + agent read the same doc. Setup verifies calendar access before saving and refuses if the chosen account can't read `calendarId`. Mode switches require disconnect-then-reconnect. **The agent sees a single `google-workspace` skill** — mode routing happens server-side in `googleWorkspaceProxy`. The skill itself carries the refined read-before-write / "what NOT to do" / error-table guidance lifted from kittagents.
- **Simulation middleware:** one global switch (`system/settings.simulationMode`) flips every external integration between real and a seeded Firestore sandbox (`simulation/*` collections). Sidecar routes `/admin-api/*` branch per-handler, admin UI uses `lib/integrations/*` façades + `useIntegrationCollection` for live listeners, Cloud Functions intercept SignalWire/SMTP sends via `recordSimSms` / `recordSimEmail`. Aurelia sees the sandbox automatically when the flag is on. **See [`docs/SIMULATION.md`](docs/SIMULATION.md).**
- **Admin SMS (Admin → SMS page):** compose/send + outbound/inbound history. Send routes through `sidecarProxy → sidecar /admin-api/messaging/send` — sim writes to `simulation/sms/outbound`, real hits SignalWire's LaML `Messages.json` and persists to `sms-outbound/{sid}`. Inbound replies land on the public sidecar route `/webhooks/signalwire/inbound-sms` (HMAC-SHA1 verified against the auth token, falling back to `SIGNALWIRE_SIGNING_KEY` if set; accepts `X-SignalWire-Signature` or legacy `X-Twilio-Signature`) and write to `sms-inbound/{sid}`. **Real mode creds come from the admin Integrations panel**: `projectId`, `spaceUrl`, `smsFrom`, `faxNumber`, `faxLabel`, `faxFromEmail`, `faxCcEmail` on `integrations/signalwire` Firestore doc; auth token in Secret Manager as `signalwire_auth_token`. Legacy env vars (`SIGNALWIRE_PROJECT_ID`, `SIGNALWIRE_AUTH_TOKEN`, `SIGNALWIRE_SPACE_URL`, `SIGNALWIRE_SMS_FROM` in `/root/sidecar.env` and Cloud Function `defineSecret()`) are still honored as a fallback so un-migrated forks keep working. The inbound webhook URL `http://<sidecar-host>:8081/webhooks/signalwire/inbound-sms` must be registered on the SignalWire phone number. Sim mode works without any of that. SMS from Cloud Functions (welcome, phone OTP, reminders) and the sidecar both go through `loadSignalwireConfig()` (`functions/src/lib/signalwire-config.ts` + `sidecar/src/lib/signalwire-config.ts`). Implementation: `sidecar/src/real/messaging.ts` (real) + `sidecar/src/sim/messaging.ts` (sim).

## Security

- **API keys:** `.env` (gitignored), referenced via `import.meta.env.VITE_*`. Never hardcode in source. Production secrets go through Cloud Secret Manager via `firebase functions:secrets:set NAME`.
- **PII logging:** Never log emails, phone numbers, or other PII. Log UIDs and roles only.
- **Input validation:** Frontend (Zod) AND backend (Cloud Functions) must both validate against `FIELD_LIMITS`.
- **Storage rules:** Only patient owner and admins can read documents. No public access.
- **Firestore rules:** Admin role verified from user doc, not from the accessed data.
- **Session storage:** Email for sign-in link in `sessionStorage` (cleared on tab close), not `localStorage`.
- **Stripe webhook:** Signature verified via `STRIPE_WEBHOOK_SECRET`. Clients cannot write to `patient-subscriptions` — rules force all writes through the webhook Cloud Function.

## Firestore Collections

`users`, `message-threads`, `thread-messages`, `appointments`, `prescription-refills`, `patient-documents`, `patient-intake-forms`, `notifications`, `phone-verifications`, `rate-limits`, `agent-chat`, `support-chat`, `agent-skills`, `specialist-requests`, `daily-reminders`, `system` (`system/settings` publicly readable), `bootstrap-requests` (write-once, `list` denied), `subscription-plans`, `patient-subscriptions`

## Deployment

- **Frontend:** Firebase App Hosting (Cloud Run) — one backend per customer. Auto-deploys on push to `main` once the GitHub repo is linked to the backend. The demo fork uses backend `web-patient-demo` on project `patient-demo-project` in `us-central1` (App Hosting doesn't offer us-west1 yet; Functions/Firestore/Storage are all us-west1).
- **Functions:** `firebase deploy --only functions`
- **Firestore rules + indexes:** `firebase deploy --only firestore:rules,firestore:indexes`
- **Sidecar:** `cd sidecar && ./deploy.sh` (GCE default, edit constants for host)
- **OpenClaw update:** SSH to host → `openclaw update`
- **Mobile:** Customize package id in `mobile/android/app/build.gradle.kts` and iOS bundle id before building.

## Per-fork setup

Before first deploy to a new customer project:

1. **Branding** — edit `/fork.config.ts` (covers web + functions), then mirror into `mobile/lib/config/branding.dart` for Flutter
2. **Firebase project** — update `.firebaserc` and `web/apphosting.yaml` (with new project's Firebase config values). With `rootDir: "web"` in `firebase.json`, App Hosting reads only `web/apphosting.yaml` — there is no root-level `apphosting.yaml`.
3. **Firebase Web API key in Secret Manager** — NEVER put it in `web/apphosting.yaml` with `value:`; GitHub's scanner flags it, and `secret:` is cleaner for rotation:
   ```bash
   echo -n "AIzaSy..." | gcloud secrets create VITE_FIREBASE_API_KEY \
     --project=<PROJECT_ID> --data-file=-
   firebase apphosting:secrets:grantaccess VITE_FIREBASE_API_KEY \
     --project <PROJECT_ID> --backend <BACKEND_ID>
   ```
   (Firebase Web API keys are public routing identifiers — real security is Firebase Rules + App Check — but routing through Secret Manager keeps scanners quiet and makes rotation trivial.)
4. **Compute SA `tokenCreator` on itself** — required for `createCustomToken` (used by phone-OTP sign-in and the bootstrap trigger). Run once per project:
   ```bash
   gcloud iam service-accounts add-iam-policy-binding \
     <PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
     --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
     --role=roles/iam.serviceAccountTokenCreator \
     --project=<PROJECT_ID>
   ```
   Without this, `createCustomToken` throws `Permission 'iam.serviceAccounts.signBlob' denied`.
5. **AI agent workspace tokens** — rewrite `{{PLACEHOLDER}}` tokens in `openclaw/**/*.md` and `openclaw/openclaw.json`. See [`docs/AI_AGENTS.md`](docs/AI_AGENTS.md) for the full placeholder list.
6. **Secret Manager for EHR integrations** — enable the API + grant IAM. Without this, the Integrations admin tab can save clientId but `saveCredentials` will fail on `clientSecret`:
   ```bash
   gcloud services enable secretmanager.googleapis.com --project=<PROJECT_ID>
   gcloud projects add-iam-policy-binding <PROJECT_ID> \
     --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
     --role=roles/secretmanager.admin
   ```
   Sidecar SA needs `roles/secretmanager.secretAccessor` (or `admin` via the default compute SA). See [`docs/EHR_INTEGRATIONS.md`](docs/EHR_INTEGRATIONS.md#per-fork-setup) for details.

## Detailed docs

- **[`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)** — architecture + credential storage + playbook for adding a new integration
- **[`docs/AI_AGENTS.md`](docs/AI_AGENTS.md)** — agents, hosts, Slack channel, sidecar ops, health checks, session management, per-fork setup
- **[`docs/SIMULATION.md`](docs/SIMULATION.md)** — sim/real middleware, one switch, how to add a new domain, detach path
- **[`docs/DEMO_DEPLOY.md`](docs/DEMO_DEPLOY.md)** — demo deployment walkthrough
- **[`docs/FORK_CHECKLIST.md`](docs/FORK_CHECKLIST.md)** — per-customer fork checklist

## Notes

- No test suite yet
- When adding new collections: update `firestore.rules` and `firestore.indexes.json` in the same change. Add composite indexes for any `where()` + `orderBy()` query.
