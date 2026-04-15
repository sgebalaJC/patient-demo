# Patient Portal (template)

Generic HIPAA-posture patient engagement platform. Fork per customer, one dedicated Firebase project per fork. See `README.md` for the customer onboarding workflow.

## Tech Stack

- **Web:** React 18 + TypeScript, Vite, Tailwind CSS, React Router v6
- **Mobile:** Flutter 3.41+, Dart 3.11+, Provider state
- **Backend:** Firebase (Auth, Firestore, Storage, Cloud Functions v2)
- **External:** Twilio (SMS), Google Maps, Google Workspace, Stripe (billing)
- **AI agents:** OpenClaw admin + patient support agents on a customer-owned VPS, proxied via Cloud Functions
- **Node:** v20

## Project Structure

```
web/           # React SPA (Vite)
  src/config/
    branding.ts      # ★ PER-CUSTOMER: name, logo, colors, agent identities
    features.ts      # feature flags
  src/pages/         # Route-level pages
  src/components/    # Feature-organized; ui/ primitives; chat/ shared admin+patient
  src/lib/           # firebase, firestore/ (incl. subscriptions.ts), sidecar, slack, storage, validation
  src/contexts/      # AuthContext
  src/hooks/         # useAuth, useFeatures, usePagination
  src/types/         # TypeScript types
mobile/        # Flutter patient app
  lib/config/
    branding.dart    # ★ PER-CUSTOMER: mirror of web/src/config/branding.ts
    constants.dart, colors.dart, firebase_config.dart
  lib/services/firestore/   # Per-collection service classes incl. subscriptions_service.dart
  lib/widgets/              # Shared widgets (SubscriptionStatusCard, etc.)
functions/     # Cloud Functions (Node 20)
  src/branding.ts    # ★ PER-CUSTOMER: short name for SMS/email/admin signatures
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

- **Branding:** Single source of truth is `web/src/config/branding.ts` (web), `mobile/lib/config/branding.dart` (mobile), `functions/src/branding.ts` (functions). These three must stay in sync — Functions cannot import from the web workspace. Never hardcode the practice name in new code; import `BRANDING` and template it.
- **Auth:** Firebase Auth (email/password, Google OAuth, email link, phone OTP). Roles: `patient`, `admin`, `assistant`. **Passwordless by default** — admin-created users sign in via email link, Google OAuth, or phone OTP.
- **App Settings:** Global knobs in `system/settings` Firestore doc (`registrationEnabled`, `paginationSize`, `bootstrapped`). Publicly readable, admin-only write. `AppSettingsProvider` + `useAppSettings()` hook. `registrationEnabled: false` by default — self-signup blocked at every chokepoint when off.
- **Bootstrap first admin:** WordPress-style. `AuthPage` renders `BootstrapAdminForm` when `system/settings.bootstrapped === false`. Client writes `bootstrap-requests/{uuid}`, `onBootstrapRequestCreated` Firestore trigger processes it and writes a custom token back, client signs in via `signInWithCustomToken`. **Firestore trigger, not `onCall`** — GCP orgs with `iam.allowedPolicyMemberDomains` (HIPAA-hardened) block public Cloud Run invocation. Trigger auto-heals by flipping `bootstrapped: true` if any user exists.
- **Admin invites:** `createUserWithAuth` creates passwordless users; `UserForm` then calls `sendInviteLink()` from the admin's browser. Optional welcome SMS via Twilio.
- **Phone normalization:** All writes to `users.phoneNumber` MUST route through `normalizePhoneNumber`. Server `functions/src/index.ts`, web `web/src/lib/phone.ts`, mobile `mobile/lib/utils/phone.dart` — all three produce identical `+1XXXXXXXXXX`. Never write raw input.
- **Routing:** Protected routes redirect to `/auth`. Admins access `/admin/*`. Patients use `/dashboard`, `/messages`, `/refills`, `/billing`, etc.
- **Data layer:** Firestore ops in `web/src/lib/firestore/` — one module per collection.
- **Validation:** Centralized `FIELD_LIMITS` in `web/src/lib/validation.ts`. Never hardcode limits in forms.
- **Feature flags:** `web/src/config/features.ts` — all enabled by default. Check with `useFeatures()`.
- **Forms:** React Hook Form + Zod. Max lengths from `FIELD_LIMITS`.
- **Shared UI:** Primitives in `components/ui/` — `BrandLogo`, `LoadingSpinner`, `PageHeader`, `StatsGrid`, `FilterTabs`, `EmptyState`, `PaginationBar`, `AccessDenied`. Never inline.
- **Styling:** Tailwind with `primary-*` / `secondary-*` tokens. Three themes: Classic, Brand (via branding.ts), Dark. After editing branding colors, also update `web/src/index.css[data-theme="brand"]` and `mobile/lib/providers/theme_provider.dart`.
- **Mobile auth gate:** Admin/assistant → blocked modal. Inactive → pending. Biometric locked → fingerprint/face prompt. Active patient → main app. Biometric default via `local_auth`, skipped on fresh sign-in. Android requires `FlutterFragmentActivity` + `USE_BIOMETRIC`.
- **Mobile notifications:** Patient actions create admin notifications. Message notifications deep-link via `meta.threadId`. Patients can read+update their own notifications.
- **File uploads:** Cloud Storage at `patients/{patientId}/documents/{documentType}/{fileName}`.
- **Chat persistence (non-blocking):** Admin chat in `agent-chat`, patient support in `support-chat`. **All Firestore saves in chat are fire-and-forget with `.catch()`** — show message in UI first, persist in background. Never `await` Firestore writes in the send flow. Never pass `undefined` fields; use conditional spread `...(field ? { field } : {})`.
- **Stripe billing:** Practice-owned Stripe account. Admins manage `subscription-plans` (doc id = Stripe price id). Patients subscribe via Stripe Checkout (hosted). `stripeWebhook` Cloud Function mirrors subscription state into `patient-subscriptions/{uid}`. Mobile app reads subscription state from Firestore but delegates checkout to the web `/billing` page via `url_launcher`.
- **AI Agents:** Two OpenClaw agents on a customer-owned host — admin agent (`main`) and patient support agent (`patient-support`). Unified auth via `sidecarProxy` Cloud Function. **Patient support agent has NO patient data access** (HIPAA defense in depth). Slack integration available via `/admin/agent → Channels`. **See [`docs/AI_AGENTS.md`](docs/AI_AGENTS.md) for hosts, health checks, Slack config, sidecar ops, and per-fork setup.**
- **Integrations (admin-configurable):** `integrations/{id}` Firestore collection holds admin-entered credentials (admin-only rules; writes go through callables). Current modules: Google Workspace (Gmail/Calendar/Drive via OAuth) and **DrChrono** (EHR, OAuth, with enable/disable toggle). The DrChrono admin agent skill lives at `openclaw/workspace/skills/drchrono/` — it's always present but calls fail-fast with 403 when the integration is disabled. Proxy path: `sidecarProxy → sidecar /admin-api/drchrono/<path>`.

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

- **Frontend:** Firebase App Hosting (Cloud Run) — one backend per customer. Auto-deploys on push to `main` once the GitHub repo is linked to the backend. The demo fork uses backend `web-patient-demo` on project `patient-demo-project` in `us-central1`.
- **Functions:** `firebase deploy --only functions`
- **Firestore rules + indexes:** `firebase deploy --only firestore:rules,firestore:indexes`
- **Sidecar:** `cd sidecar && ./deploy.sh` (GCE default, edit constants for host)
- **OpenClaw update:** `./scripts/openclaw-update.sh [tag]`
- **Mobile:** Customize package id in `mobile/android/app/build.gradle.kts` and iOS bundle id before building.

## Per-fork setup

Before first deploy to a new customer project:

1. **Branding** — edit `web/src/config/branding.ts`, `mobile/lib/config/branding.dart`, `functions/src/branding.ts`
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

## Detailed docs

- **[`docs/AI_AGENTS.md`](docs/AI_AGENTS.md)** — agents, hosts, Slack channel, sidecar ops, health checks, session management, per-fork setup
- **[`docs/DEMO_DEPLOY.md`](docs/DEMO_DEPLOY.md)** — demo deployment walkthrough
- **[`docs/FORK_CHECKLIST.md`](docs/FORK_CHECKLIST.md)** — per-customer fork checklist

## Notes

- `dataconnect/` unused, can be removed
- No test suite yet
- When adding new collections: update `firestore.rules` and `firestore.indexes.json` in the same change. Add composite indexes for any `where()` + `orderBy()` query.
