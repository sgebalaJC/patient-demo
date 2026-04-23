# Patient Portal — Template

A generic, HIPAA-posture patient engagement platform for small medical
practices. Fork this repo per customer, set up a dedicated Firebase project,
swap in branding + secrets, and deploy.

## What's in the box

- **Web app** — React + TypeScript + Vite + Tailwind admin & patient portal
- **Mobile app** — Flutter (iOS + Android) patient app
- **Cloud Functions** — Firebase Functions v2 (Node 20) for SMS reminders,
  appointment sync, user management, Stripe webhooks
- **Sidecar** — Bun HTTP API (deployed to a customer-owned VPS) that proxies
  chat traffic to the AI agent gateway and exposes file/config/backup tools
- **OpenClaw agents** — template workspaces for a dedicated admin assistant
  and a patient-facing support bot. Each fork gets its own agent personality.
- **Stripe billing** — practice-owned Stripe account, patient membership
  subscriptions, webhook → Firestore state mirror
- **Firestore rules + indexes** for every collection used

## Feature summary

Patient-side
- Secure email/password, email-link, Google, and phone sign-in
- Biometric unlock (mobile) — fingerprint / Face ID
- Appointments (book, reschedule, cancel) with Google Calendar sync
- Message threads with the care team (attachments, notifications)
- Prescription refill requests
- Document uploads
- Digital intake forms
- Membership subscription (Stripe Checkout)
- Patient support chatbot (OpenClaw-backed)

Admin-side
- User management
- Appointment calendar
- Specialist referral requests
- Refill request approval queue
- To-do list with SMS reminders
- Intake form review
- SMS template editor (24-hour & same-day reminder templates)
- Subscription plan management (CRUD over Stripe price ids)
- Admin AI agent chat (dedicated per-customer agent)
- Agent health, backups, skills, workflows

## Fork-per-customer workflow

This template is designed for **one Firebase project per customer**. Multi-tenancy
is deliberately out of scope — it makes setup simpler, billing isolated, and
HIPAA posture clearer (no shared database). When you onboard a new customer:

1. **Clone this repo** into a fresh location:
   ```bash
   git clone https://github.com/your-org/patient-portal-template customer-name-portal
   cd customer-name-portal
   rm -rf .git && git init && git add -A && git commit -m "Initial import"
   ```

2. **Create a Firebase project**
   - Firebase console → create project (under your Google Workspace org so the
     BAA applies). Note the project id.
   - Enable: Authentication (Email/Password, Email Link, Google, Phone),
     Firestore, Storage, Functions, App Hosting.
   - **BAA:** Firebase is HIPAA-eligible under a Google Cloud BAA. Confirm one
     is in place before accepting PHI.

3. **Update Firebase project id**
   - `.firebaserc` → replace `YOUR_FIREBASE_PROJECT` with the new id
   - `web/apphosting.yaml` → replace all `YOUR_FIREBASE_PROJECT`,
     `REPLACE_WITH_*` placeholders (the App Hosting `rootDir` is `web/`, so
     this is the only apphosting file read at build time)
   - Run `flutterfire configure` from `mobile/` — this will generate
     `mobile/lib/firebase_options.dart`,
     `mobile/android/app/google-services.json`, and
     `mobile/ios/Runner/GoogleService-Info.plist` with the right values.
     The template ships placeholder versions (`*.template` files for the
     mobile configs) so the project type-checks before you configure.

4. **Update branding**
   - Edit `web/src/config/branding.ts` (practice name, domain, colors, agent names, logos)
   - Edit `mobile/lib/config/branding.dart` to match
   - Edit `functions/src/branding.ts` (shortName + signature name for SMS/emails)
   - Drop your logo files into `web/public/branding/` (`logo.svg`, `logo-dark.svg`, `icon.svg`)
     and `mobile/assets/branding/` (`logo.png`, `logo-dark.png`, `icon.png`)
   - Edit `web/src/index.css` — update the `:root[data-theme="brand"]` CSS variables
     to match `BRANDING.colors`
   - Edit `mobile/lib/providers/theme_provider.dart` — update the `AppThemeId.brand`
     colors to match

5. **Change the app id**
   - Android: `mobile/android/app/build.gradle.kts` → `applicationId` and `namespace`
     (default: `com.example.patient`)
   - Android: move `mobile/android/app/src/main/kotlin/com/example/patient/` to the new package path
   - iOS: open Xcode → Runner → Signing & Capabilities → change bundle identifier
   - iOS: update `PRODUCT_BUNDLE_IDENTIFIER` in `mobile/ios/Runner.xcodeproj/project.pbxproj`

6. **Secrets + env**
   - `cp web/.env.example web/.env` — fill in Firebase keys
   - `cp functions/.env.example functions/.env` — fill in Twilio, Stripe test keys for emulator
   - Production function secrets (use `firebase functions:secrets:set` — these are
     stored in Cloud Secret Manager, never committed):
     - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
     - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
     - `GOOGLE_SA_KEY` (for Calendar sync, if using)

7. **Stand up the AI agent (optional)**
   - Provision a VPS (any Linux box works) or a GCE VM
   - Install Node.js 22 + Bun + OpenClaw + QMD on the host
   - Edit the OpenClaw markdown templates under `openclaw/workspace/` and
     `openclaw/agents/patient-support/workspace/` — replace every
     `{{PRACTICE_NAME}}`, `{{ADMIN_AGENT_NAME}}`, `{{PATIENT_AGENT_NAME}}`, etc.
   - Deploy sidecar: `cd sidecar && ./deploy.sh`
   - Set `VITE_SIDECAR_PROXY_URL` in App Hosting env

8. **Deploy**
   ```bash
   # Rules + indexes
   firebase deploy --only firestore:rules,firestore:indexes,storage:rules

   # Functions
   cd functions && npm install && npm run build && firebase deploy --only functions

   # Web (App Hosting)
   firebase apphosting:rollouts:create web-patient --git-branch main
   ```

9. **Stripe setup**
   - Create the practice's Stripe account
   - In Stripe dashboard → Products, create one Product per membership tier
     with a recurring Price
   - In your deployed admin UI → Subscription Plans, add a row for each price
     (doc id = Stripe price id)
   - In Stripe dashboard → Developers → Webhooks, add a webhook pointing at
     `https://us-central1-YOUR_FIREBASE_PROJECT.cloudfunctions.net/stripeWebhook`
     with events: `checkout.session.completed`,
     `customer.subscription.{created,updated,deleted}`,
     `invoice.payment_{succeeded,failed}`. Copy the signing secret into
     the `STRIPE_WEBHOOK_SECRET` Firebase secret.

## Local development

Prereqs: Node 20, Java 21+ (for emulators), Flutter 3.41+.

```bash
# Install deps
cd web && npm install && cd ..
cd functions && npm install && cd ..
cd mobile && flutter pub get && cd ..

# Start emulators (from web/)
cd web && npm run emulators         # persisted data
cd web && npm run emulators:fresh   # empty state

# Web dev server (from web/)
cd web && npm run dev

# Mobile (emulator hostnames: Android 10.0.2.2, iOS localhost)
cd mobile && flutter run
```

Emulator ports: Firestore 8080, Auth 9099, Storage 9199, Functions 5001, UI 4000.

Set `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`
if emulators fail to start.

## Project layout

```
web/                    React + Vite + Tailwind (admin & patient portal)
  src/
    config/branding.ts  ★ edit per customer
    pages/              Route-level page components
    components/         Feature-organized UI
    lib/firestore/      CRUD modules per collection
    lib/firebase.ts     Firebase init + emulator connection
mobile/                 Flutter (patient app)
  lib/
    config/branding.dart ★ edit per customer
    screens/            Feature screens
    services/           Firestore & HTTP services
    widgets/            Shared widgets
    providers/          ChangeNotifier state
functions/              Firebase Functions v2 (Node 20)
  src/
    branding.ts         ★ edit per customer
    index.ts            Shared entry (appointments, SMS, users, reminders)
    stripe.ts           Stripe webhook + callable functions
sidecar/                Bun HTTP API for the VPS (chat proxy, files, backups)
openclaw/               AI agent workspace templates (admin + patient support)
scripts/                Deployment + VPS setup scripts
firestore.rules         ★ per-customer only if you add/rename collections
storage.rules
firestore.indexes.json
```

★ = files you'll touch for every fork.

## Security checklist before going live

- [ ] BAA signed with Google Cloud for the new Firebase project
- [ ] BAA signed with Twilio if SMS is enabled
- [ ] Every `REPLACE_*` / `YOUR_FIREBASE_PROJECT` placeholder swapped
- [ ] No `.env` or `google-services.json` committed (verify `.gitignore`)
- [ ] Firestore + Storage rules deployed (`firebase deploy --only firestore:rules,storage:rules`)
- [ ] Secrets set via `firebase functions:secrets:set`, not inline
- [ ] Client-error reporter wired (`logClientError` Cloud Function deployed; `initClientErrorReporter` called in `main.tsx`)
- [ ] PII logging reviewed — log UIDs and roles, never emails/phones
- [ ] Stripe webhook signature verification working (test via Stripe CLI)
- [ ] Admin account created and tested end-to-end

## License

Internal template. Do not redistribute without permission.
