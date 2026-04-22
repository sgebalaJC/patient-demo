# Fork Checklist

A condensed checklist for standing up a new customer from this template. For
narrative walkthroughs see the other docs in this folder.

## 0. Prerequisites

- [ ] Node 20, npm, Firebase CLI (`npm install -g firebase-tools`)
- [ ] Flutter 3.41+ and Dart 3.11+
- [ ] Java 21+ (for Firebase emulators)
- [ ] A Google Workspace account for the customer (BAA must cover it)
- [ ] A Stripe account for the customer
- [ ] A Twilio account for the customer (if SMS is enabled)
- [ ] A SignalWire account for the customer (if faxes are enabled)
- [ ] OAuth credentials for any EHR the customer uses (DrChrono, Athena, Elation, eCW, NextGen, Tebra, Greenway, Practice Fusion, Cerner, Epic — admins fill them in at runtime; you only need to whitelist the redirect URI per vendor)
- [ ] SSH access to a Linux VPS (if shipping the AI agent)

## 1. Clone and rename

```bash
git clone https://github.com/your-org/patient-portal-template customer-portal
cd customer-portal
rm -rf .git && git init && git add -A && git commit -m "Initial import from template"
```

## 2. Firebase project

- [ ] Create Firebase project in the customer's Google Workspace org (ensures BAA applies)
- [ ] Enable: Authentication (Email/Password, Email Link, Google, Phone), Firestore, Storage, Functions, App Hosting
- [ ] Set `default` in `.firebaserc` to the new project id
- [ ] Replace all `YOUR_FIREBASE_PROJECT` + `REPLACE_*` placeholders in `web/apphosting.yaml` (with `rootDir: "web"` this is the only apphosting config App Hosting reads)
- [ ] Run `flutterfire configure` from `mobile/` — this regenerates `lib/firebase_options.dart`, `android/app/google-services.json`, `ios/Runner/GoogleService-Info.plist`
- [ ] Delete the `*.template` placeholder files once the real ones exist

## 3. Branding (see [BRANDING.md](BRANDING.md))

- [ ] Edit `web/src/config/branding.ts`
- [ ] Edit `mobile/lib/config/branding.dart`
- [ ] Edit `functions/src/branding.ts`
- [ ] Drop logos into `web/public/branding/` (`logo.svg`, `logo-dark.svg`, `icon.svg`)
- [ ] Drop logos into `mobile/assets/branding/` (`logo.png`, `logo-dark.png`, `icon.png`)
- [ ] Update `web/src/index.css` → `:root[data-theme="brand"]` CSS variables
- [ ] Update `mobile/lib/providers/theme_provider.dart` → `AppThemeId.brand` colors
- [ ] Update app display name in `web/index.html`, `mobile/ios/Runner/Info.plist`, `mobile/android/app/src/main/AndroidManifest.xml`

## 4. Native app identifiers

- [ ] Android `applicationId` and `namespace` in `mobile/android/app/build.gradle.kts`
- [ ] Move `mobile/android/app/src/main/kotlin/com/example/patient/` to the new package path + update `MainActivity.kt` `package` line
- [ ] iOS: Xcode → Runner → Signing & Capabilities → bundle identifier (or edit `mobile/ios/Runner.xcodeproj/project.pbxproj` directly)

## 5. Secrets

### Local dev (emulator only, never committed)

```bash
cp web/.env.example web/.env
cp functions/.env.example functions/.env
# Fill in test keys
```

### Production (Cloud Secret Manager)

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_PHONE_NUMBER
firebase functions:secrets:set GOOGLE_SA_KEY       # if using Calendar sync
firebase functions:secrets:set SLACK_ALERTS_WEBHOOK_URL   # '=disabled' is fine if unused

# Fax — if SignalWire is enabled
firebase functions:secrets:set SIGNALWIRE_PROJECT_ID
firebase functions:secrets:set SIGNALWIRE_AUTH_TOKEN
firebase functions:secrets:set SIGNALWIRE_SPACE_URL
firebase functions:secrets:set SIGNALWIRE_SIGNING_KEY
```

The sidecar reads the SignalWire secrets directly from Secret Manager too
(native outbound-fax send lives on the sidecar now — no Cloud Function
hop). Grant the sidecar SA `roles/secretmanager.secretAccessor` on:

- `SIGNALWIRE_PROJECT_ID`, `SIGNALWIRE_AUTH_TOKEN`, `SIGNALWIRE_SPACE_URL`
- `ehr_<provider>_client_secret` for each EHR the customer uses (only
  needed if they reconnect the integration after deploy)

```bash
for s in SIGNALWIRE_PROJECT_ID SIGNALWIRE_AUTH_TOKEN SIGNALWIRE_SPACE_URL; do
  gcloud secrets add-iam-policy-binding "$s" \
    --project=<PROJECT_ID> \
    --member=serviceAccount:<SIDECAR_SA_EMAIL> \
    --role=roles/secretmanager.secretAccessor
done
```

## 6. Install & build

```bash
(cd web && npm install)
(cd functions && npm install && npm run build)
(cd mobile && flutter pub get)
```

Compile checks:

```bash
(cd web && npx tsc --noEmit)
(cd functions && npm run build)
(cd mobile && flutter analyze)
```

All should report 0 errors before you deploy anything.

## 7. Deploy

```bash
# Rules + indexes (do this first so client writes don't 403)
firebase deploy --only firestore:rules,firestore:indexes,storage:rules

# Functions
firebase deploy --only functions

# Web (App Hosting)
firebase apphosting:rollouts:create web-patient --git-branch main
```

## 8. Stripe (see [STRIPE_SETUP.md](STRIPE_SETUP.md))

- [ ] Create Products and Prices in Stripe dashboard
- [ ] Add matching rows in Admin → Subscription Plans (doc id = Stripe price id)
- [ ] Configure webhook endpoint pointing at `stripeWebhook` Cloud Function
- [ ] Test a subscribe flow end-to-end with Stripe test cards

## 9. AI agent (optional — see [AI_AGENTS.md](AI_AGENTS.md))

- [ ] Provision VPS
- [ ] Rewrite `{{PLACEHOLDER}}` tokens in `openclaw/` workspace markdown
- [ ] Run `scripts/vultr-setup.sh <ip> <ssh-key>`
- [ ] Drop the Firebase service-account key at `/root/.openclaw/credentials/google-sa-key.json` (firebase-admin reads it; sidecar sim + signalwire + chart-gap-check all reuse that path)
- [ ] Fill `/root/sidecar.env` with, at minimum:
      ```
      SIDECAR_API_KEY=<random long string>
      GCLOUD_PROJECT=<PROJECT_ID>
      FUNCTION_REGION=us-west1
      PRACTICE_NAME=<short branded name>  # appears on fax cover sheet
      ```
- [ ] Deploy sidecar: `cd sidecar && ./deploy.sh`
- [ ] Verify health via admin dashboard → AI Agent page

## 10. Simulation middleware (optional — see [SIMULATION.md](SIMULATION.md))

- [ ] Set `system/settings.simulationMode: true` in Firestore if you want
      a sandbox demo mode for this fork (leave off for production).
- [ ] Click **Seed demo data** in Admin → Settings to populate
      `simulation/*` — 50 patients shared across every EHR, 3 inbound +
      2 outbound faxes with viewable PDFs, sample SMS + workspace entries.
- [ ] If running a real customer (not a demo fork), consider deleting
      `sidecar/src/sim/`, `functions/src/simulation/`, and
      `web/src/lib/integrations/` per the detach recipe in
      `docs/SIMULATION.md`.

## 11. Pre-launch security review (see [SECURITY.md](SECURITY.md))

- [ ] BAA signed with Google Cloud, Twilio (if applicable), any other subprocessors
- [ ] No `.env`, `google-services.json`, `GoogleService-Info.plist` committed
- [ ] All `REPLACE_*` and `YOUR_FIREBASE_PROJECT` placeholders gone
- [ ] Firestore rules deployed and tested
- [ ] Admin account created and tested
- [ ] Stripe webhook signature verification working (check Stripe dashboard → Webhook attempts)
- [ ] No PII in Cloud Functions logs (log UIDs and roles only)
