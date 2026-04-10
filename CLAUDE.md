# Patient Portal (template)

Generic HIPAA-posture patient engagement platform — fork per customer, one
dedicated Firebase project per fork. See `README.md` for the customer
onboarding workflow.

## Tech Stack

- **Frontend (Web):** React 18 + TypeScript, Vite, Tailwind CSS, React Router v6
- **Frontend (Mobile):** Flutter 3.41+, Dart 3.11+, Provider for state management
- **Backend:** Firebase (Auth, Firestore, Cloud Storage, Cloud Functions v2)
- **External:** Twilio (SMS), Google Maps API, Google Workspace APIs, Stripe (billing)
- **AI agents:** OpenClaw-based admin + patient support agents on a
  customer-owned VPS, proxied via Firebase Functions
- **Node:** v20

## Project Structure

```
web/                    # React SPA (Vite)
  src/
    config/
      branding.ts       # ★ PER-CUSTOMER: name, logo, colors, agent identities
      features.ts       # feature flags (all enabled by default)
    pages/              # Route-level page components
    components/         # Feature-organized components
      ui/               # Shared UI primitives (BrandLogo, LoadingSpinner, PageHeader, etc.)
      chat/             # Shared chat components (ChatMarkdown, ChatInput)
    lib/
      firebase.ts       # Firebase init, auth helpers, emulator connection
      firestore/        # Firestore CRUD operations per collection (incl. subscriptions.ts)
      sidecar.ts        # HTTP client for sidecar API
      storage.ts        # Cloud Storage operations
      validation.ts     # Centralized field length limits (FIELD_LIMITS)
      logger.ts         # Logging utility
    contexts/           # AuthContext (global auth state)
    hooks/              # useAuth, useFeatures, usePagination
    types/index.ts      # All TypeScript type definitions
mobile/                 # Flutter mobile app (patient-only, iOS + Android)
  lib/
    config/
      branding.dart     # ★ PER-CUSTOMER: mirror of web/src/config/branding.ts
      constants.dart    # Field limits + Places API key
      colors.dart       # AppColors — mutated at runtime by ThemeProvider
      firebase_config.dart
    models/             # Dart data models
    services/           # Auth, biometric, Firestore CRUD, Storage
      firestore/        # Per-collection service classes (incl. subscriptions_service.dart)
    providers/          # ChangeNotifier providers (auth, biometric, theme)
    screens/            # Feature screens
    widgets/            # Shared widgets (SubscriptionStatusCard, etc.)
functions/              # Firebase Cloud Functions (Node 20)
  src/
    branding.ts         # ★ PER-CUSTOMER: short name for SMS/email/admin signatures
    index.ts            # Shared entry (SMS reminders, user management, calendar sync)
    stripe.ts           # Stripe Checkout, cancel, webhook → Firestore mirror
    google-calendar.ts  # Appointment / calendar sync
sidecar/                # Bun sidecar API deployed to customer VPS
openclaw/               # ★ PER-CUSTOMER: AI agent workspace templates with {{PLACEHOLDER}} tokens
  workspace/            # Admin agent (id: main)
  agents/patient-support/workspace/  # Patient support agent
firestore.rules         # Firestore security rules
storage.rules           # Cloud Storage security rules
firebase.json           # Emulator and deployment config
```

★ = files that every fork edits.

## Development

```bash
# Frontend dev server (from web/)
npm run dev

# Firebase emulators with persisted data (from web/)
npm run emulators

# Fresh emulators (no data) (from web/)
npm run emulators:fresh

# Build frontend (from web/)
npm run build

# Build functions (from functions/)
npm run build

# Lint (from web/)
npm run lint

# Mobile app (from mobile/)
flutter run
flutter analyze
flutter build apk
flutter build ios
```

Emulator ports: Firestore 8080, Auth 9099, Storage 9199, Functions 5001, UI 4000.

Java 21+ required for emulators. Set
`JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` if
not default.

## Key Patterns

- **Branding:** Single source of truth is `web/src/config/branding.ts` (web),
  `mobile/lib/config/branding.dart` (mobile), `functions/src/branding.ts`
  (functions). These three must stay in sync — Functions cannot import from
  the web workspace. Never hardcode the practice name in new code — import
  BRANDING and template it.
- **Auth:** Firebase Auth (email/password, Google OAuth, email link, phone).
  Roles: `patient`, `admin`, `assistant`.
- **Routing:** Protected routes redirect to `/auth`. Admins access `/admin/*`.
  Patients use `/dashboard`, `/messages`, `/refills`, `/billing`, etc.
- **Data layer:** Firestore operations in `web/src/lib/firestore/` modules.
  Each module exports CRUD functions for its collection.
- **Validation:** Centralized field limits in `web/src/lib/validation.ts`
  (`FIELD_LIMITS`). Never hardcode limits in individual forms.
- **Feature flags:** `web/src/config/features.ts` — all features enabled by
  default. Check with `useFeatures()` hook.
- **Forms:** React Hook Form + Zod. All text fields must have max length from
  `FIELD_LIMITS`.
- **Shared UI:** Reusable primitives in `components/ui/` — use `BrandLogo`,
  `LoadingSpinner`, `AccessDenied`, `PageHeader`, `StatsGrid`, `FilterTabs`,
  `EmptyState`, `PaginationBar` instead of inline markup.
- **Styling:** Tailwind with custom `primary-*` and `secondary-*` color
  tokens. Three themes: Classic, Brand (configurable via branding.ts), Dark.
  After editing `branding.ts` colors, also update
  `web/src/index.css[data-theme="brand"]` and
  `mobile/lib/providers/theme_provider.dart`.
- **Emulators:** Web auto-detected via `window.location.hostname === 'localhost'`.
  Mobile uses `FirebaseConfig.initialize(useEmulator: true)` with Android
  `10.0.2.2` / iOS `localhost`.
- **Mobile auth gate:** Admin/assistant → blocked modal. Inactive → pending
  screen. Biometric locked → fingerprint/face prompt. Active patient → main app.
- **Mobile biometric:** Enabled by default via `local_auth`. Skipped on fresh
  sign-in. Toggle in Profile. Android requires `FlutterFragmentActivity` +
  `USE_BIOMETRIC` permission.
- **Mobile notifications:** Patient actions create admin notifications.
  Tapping a message notification deep-links via `meta.threadId`. Patients can
  read+update own notifications (rules enforced).
- **File uploads:** Cloud Storage at
  `patients/{patientId}/documents/{documentType}/{fileName}`.
- **AI Agents:** Two OpenClaw agents on a customer-owned VPS — an admin agent
  (`main`) and a patient support agent (`patient-support`). Unified auth via
  `sidecarProxy` Cloud Function. **The patient support agent has NO patient
  data access** (HIPAA compliance — no PHI on the VPS); it acts as a practice
  navigator and FAQ bot. The admin agent can optionally get Google Workspace
  access via `gog` CLI with SA domain-wide delegation. VPS config mirrored in
  `openclaw/` directory with `{{PLACEHOLDER}}` tokens — fill these in per
  customer before shipping.
- **Sidecar:** Bun binary on the VPS (`sidecar/`). Chat proxy to OpenClaw
  gateway, file ops, config, backups. Dual auth: static API key (internal) +
  user context headers (proxied). Patients restricted to `/chat` only.
- **Chat persistence:** Admin chat in `agent-chat` collection (global).
  Patient support chat in `support-chat` collection (per-patient via
  `patientId` field, cursor-based pagination). **All Firestore saves in chat
  are non-blocking** (fire-and-forget with `.catch()`). Show the message in
  UI first, persist in background. Never `await` Firestore writes in the
  send flow. Never pass `undefined` field values to Firestore; use
  conditional spread `...(field ? { field } : {})`.
- **No PHI on the VPS:** Patient Firebase tokens are NOT forwarded to the
  sidecar for the patient agent. The patient agent cannot access any patient
  data API. The patient agent's `TOOLS.md` must say "no tools, no API" —
  never add API endpoint docs there (it overrides SOUL.md rules).
- **Stripe billing:** Practice-owned Stripe account. Admins manage
  `subscription-plans` (doc id = Stripe price id). Patients subscribe via
  Stripe Checkout (hosted). `stripeWebhook` Cloud Function mirrors
  subscription state into `patient-subscriptions/{uid}`. The mobile app
  reads subscription state from Firestore but delegates checkout to the web
  `/billing` page via `url_launcher`.

## Security

- **API keys:** All keys in `.env` file (gitignored), referenced via
  `import.meta.env.VITE_*`. Never hardcode keys in source. Production
  secrets go through Cloud Secret Manager via
  `firebase functions:secrets:set NAME`.
- **PII logging:** Never log email addresses, phone numbers, or other PII.
  Log only UIDs and roles.
- **Input validation:** Frontend (Zod) AND backend (Cloud Functions) must
  both validate. Limits defined in `FIELD_LIMITS`.
- **Storage rules:** Only patient owner and admins can read documents. No
  public access.
- **Firestore rules:** Admin role verified from user document, not from data
  being accessed.
- **Session storage:** Email for sign-in link stored in `sessionStorage`
  (not `localStorage`) — cleared when tab closes.
- **Stripe webhook:** Signature verified via `STRIPE_WEBHOOK_SECRET`.
  Clients cannot write to `patient-subscriptions` — rules force all writes
  through the webhook Cloud Function.

## Firestore Collections

`users`, `message-threads`, `thread-messages`, `appointments`,
`prescription-refills`, `patient-documents`, `patient-intake-forms`,
`admin-todos`, `notifications`, `phone-verifications`, `rate-limits`,
`agent-chat`, `support-chat`, `agent-skills`, `agent-workflows`,
`workflow-runs`, `specialist-requests`, `daily-reminders`, `system`,
`subscription-plans`, `patient-subscriptions`

## Cloud Functions

- `calendarReminderScheduler` — every 5 min, reads Calendar events 24h ahead,
  sends 24h SMS + queues 8AM reminder
- `morningReminderScheduler` — daily 8AM PT, sends queued same-day reminders
- `todoReminderScheduler` — every 30 min, sends SMS via Twilio for admin todos
- `createUserWithAuth` / `updateUserAuth` — callable admin user management
- `sendPhoneVerificationCode` / `verifyPhoneCode` — phone verification via Twilio
- `deleteAccount` — cascade delete user data (Firestore, Storage, Auth)
- `logAuditEvent` — HIPAA-safe audit logging
- `getAvailableSlots` / `validateAppointmentSlot` — appointment scheduling
- `onAppointmentWrite` / `syncCalendarChanges` — bidirectional Google Calendar sync
- `sidecarProxy` — HTTP proxy to the VPS sidecar
- `serveFile` — secure file proxy with signed URLs
- `cleanupCancelledAppointments` — daily cleanup
- `createCheckoutSession` — callable; creates a Stripe Checkout Session.
  Returns hosted checkout URL.
- `cancelSubscription` — callable; cancels patient's subscription at period end.
- `stripeWebhook` — HTTPS; receives Stripe events and mirrors subscription
  state into `patient-subscriptions/{uid}`.

## AI Agent setup (per fork)

Each customer runs its own VPS with OpenClaw + the sidecar. Template
workspace files live in `openclaw/` with `{{PLACEHOLDER}}` tokens:

- `{{PRACTICE_NAME}}` — full practice name
- `{{LEGAL_ENTITY}}` — legal entity for compliance text
- `{{DOMAIN}}` — patient portal domain (without protocol)
- `{{SUPPORT_EMAIL}}`, `{{SUPPORT_PHONE}}`, `{{ADDRESS}}`, `{{HOURS}}`
- `{{ADMIN_AGENT_NAME}}` — admin assistant display name
- `{{PATIENT_AGENT_NAME}}` — patient support assistant display name
- `{{PRIMARY_CONTACT_NAME}}`, `{{PRIMARY_CONTACT_EMAIL}}`

Before first deploy, rewrite these tokens in:
- `openclaw/workspace/*.md` (admin agent)
- `openclaw/agents/patient-support/workspace/*.md` (patient support agent)
- `openclaw/openclaw.json`

Keep the patient-support agent's SOUL.md small (~5KB max) — large system
prompts are often ignored by the model.

## Health check

After an agent is deployed:

**Via sidecar API (admin auth required):**
- `GET /healthz` — sidecar alive check
- `GET /status` — gateway process state + health
- `GET /stats` — memory, CPU, uptime, disk

**Via web app:** Admin dashboard → AI Agent page → status indicator

**Via CLI (direct SSH for debugging):**
```bash
SSH="ssh -i ~/.ssh/vps-key root@YOUR_VPS_IP"
$SSH "curl -s http://localhost:18789/health"   # Gateway
$SSH "curl -s http://localhost:8081/healthz"   # Sidecar
$SSH "openclaw agents list"
$SSH "systemctl restart patient-sidecar"
$SSH "openclaw gateway restart"
```

## Deployment

- **Frontend:** Firebase App Hosting (Cloud Run) — one backend per customer.
  Update the project id in `apphosting.yaml` and `.firebaserc` before first
  deploy.
- **Functions:** `firebase deploy --only functions`
- **Sidecar:** `cd sidecar && ./deploy.sh`
- **OpenClaw update:** `./scripts/openclaw-update.sh [tag]` — creates backup
  on VPS, uploads to GCS, then runs `openclaw update`. `--dry-run` to preview.
- **Mobile:** Customize package id in `mobile/android/app/build.gradle.kts`
  and iOS bundle id before building.

## Notes

- `dataconnect/` directory is unused and can be ignored
- No test suite yet — to be added later
- When adding new collections, always update both `firestore.rules` and
  `firestore.indexes.json` in the same change. Add composite indexes
  whenever you create a `where()` + `orderBy()` query.
