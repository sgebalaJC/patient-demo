# Demo Deploy — `patient-demo-project`

Concrete notes for the zero-idle-cost demo at
**https://patient-demo-project.web.app**. Captures what was deployed, what was
deliberately skipped, and how to enable each skipped feature when you're ready.

## What was deployed (2026-04-10)

| Layer | Status | Notes |
|---|---|---|
| Firebase Hosting (classic) | ✅ | `web/dist` → `https://patient-demo-project.web.app` |
| Firestore | ✅ | `(default)` db, `us-west1`, rules + indexes from repo |
| Cloud Storage | ✅ | bucket in `US-WEST1`, rules from repo |
| Firebase Auth | ✅ | Email/Password + Google enabled |
| Cloud Functions | ✅ | 10 of 17 functions, pinned to `us-west1` |
| Artifact Registry cleanup | ✅ | `us-west1` — images >1 day auto-deleted |

Functions deployed:
`createUserWithAuth`, `updateUserAuth`, `deleteAccount`, `logAuditEvent`,
`sendPhoneVerificationCode`, `verifyPhoneCode`, `sendPhoneLoginCode`,
`verifyPhoneLogin`, `serveFile`, `sidecarProxy`

## Idle cost: $0/month

Achieved by skipping everything that would trigger a recurring charge:

- No Cloud Scheduler jobs (no scheduled functions deployed)
- No Secret Manager secrets (refactored `defineSecret` → `process.env`)
- Functions scale to zero when idle
- Classic Hosting is static files on Google's CDN (no compute)
- Artifact Registry cleanup policy set → no image accumulation bill

## Missing step 1 — bootstrap an admin account

The site is deployed but nobody is signed up yet. There's no "make me admin"
button because admin promotion has to go through Firestore directly (anyone
could hit a public endpoint otherwise).

1. Go to https://patient-demo-project.web.app/auth
2. Sign up with any email (Email/Password or Google). This creates a **patient**
   user in Firebase Auth and a matching doc in `users/{uid}`.
3. Open the Firestore console:
   https://console.firebase.google.com/project/patient-demo-project/firestore/data/~2Fusers
4. Find the new user doc → edit:
   - `role`: change from `"patient"` to `"admin"`
   - `isActive`: ensure it's `true` (should be by default)
5. Refresh https://patient-demo-project.web.app → you should now see the admin
   dashboard at `/admin` and the admin nav in the header.

## Missing step 2 — fake seed data (optional, improves demo feel)

The demo site is empty — no appointments, no messages, no refills. For a
sales/screenshare demo, you'll want fake data. Two options:

### Option A: manual via admin UI
1. Log in as admin (see step 1 above)
2. Admin → User Management → create 3 fake patient users
3. Log in as each patient → book appointments, send messages, request refills
4. Takes ~15 minutes. Realistic but tedious.

### Option B: seed script (not yet written)
Sketch of the approach — write when needed:

```ts
// scripts/seed-demo.ts
import * as admin from 'firebase-admin';
import {readFileSync} from 'fs';

// Requires a service account key — download from:
// https://console.firebase.google.com/project/patient-demo-project/settings/serviceaccounts/adminsdk
// Save as scripts/sa-key.json (gitignored).
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(readFileSync('./scripts/sa-key.json', 'utf-8'))
  ),
});

const db = admin.firestore();
const auth = admin.auth();

// Create admin user + 3 patient users
// Create ~20 fake appointments over the next 30 days
// Create ~15 message threads with 2-5 messages each
// Create ~10 refill requests in various states
// Create 3 subscription plans (referencing fake Stripe price ids for display)
```

Run with `npx tsx scripts/seed-demo.ts` after installing `tsx` + `firebase-admin`.

## Missing step 3 — Stripe (enable when you want to demo subscribe flow)

Currently `createCheckoutSession`, `cancelSubscription`, and `stripeWebhook` are
**not deployed**. The UI at `/billing` will render but "Subscribe" will fail.

To enable:

1. Create a Stripe account (free). Stay in **Test mode**.
2. Dashboard → Developers → API keys → copy the **test** secret key (`sk_test_...`)
3. Dashboard → Products → create 2-3 products with recurring monthly prices, e.g.:
   - "Basic Membership" — $49/month — price `price_...`
   - "Standard Membership" — $99/month — price `price_...`
   - "Premium Membership" — $199/month — price `price_...`
4. Add the secret to `functions/.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=  # set after step 6
   ```
5. Deploy the Stripe functions:
   ```bash
   cd /Users/stan/Projects/patient
   firebase deploy --only "functions:createCheckoutSession,functions:cancelSubscription,functions:stripeWebhook" --project patient-demo-project
   ```
6. Dashboard → Developers → Webhooks → Add endpoint:
   - URL: `https://stripewebhook-yyyd7cxnba-uw.a.run.app` (the URL from the deploy output — find it with `firebase functions:list`)
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`
   - Copy the signing secret (`whsec_...`) → paste into `functions/.env` as `STRIPE_WEBHOOK_SECRET`
   - Redeploy stripeWebhook so it picks up the env var
7. In the admin UI → Subscription Plans → add one row per Stripe price. Doc id = Stripe price id.
8. Test by subscribing as a patient with test card `4242 4242 4242 4242` (any future date, any CVC).

## Missing step 4 — Google Calendar sync (optional)

Currently `onAppointmentWrite`, `getAvailableSlots`, `validateAppointmentSlot`
are **not deployed**. Appointments work in the UI but don't sync with any
external calendar.

To enable:

1. Create a service account in the Firebase project (Project Settings →
   Service accounts → Generate new private key). Save the JSON.
2. Grant the service account Calendar access — either:
   - Give it domain-wide delegation if the customer is on Google Workspace, OR
   - Share a specific calendar with the SA email (simpler for demo)
3. Get the calendar id from Google Calendar → Settings → calendar name → "Integrate calendar" → Calendar ID.
4. Add to `functions/.env`:
   ```
   GOOGLE_SA_KEY='{"type":"service_account",...}'  # full JSON, single line
   GOOGLE_CALENDAR_ID=abc123@group.calendar.google.com
   ```
5. Deploy:
   ```bash
   firebase deploy --only "functions:onAppointmentWrite,functions:getAvailableSlots,functions:validateAppointmentSlot" --project patient-demo-project
   ```

## Missing step 5 — SignalWire SMS (optional)

Phone verification currently throws at runtime (the function is deployed, but
there's no SignalWire account configured). To enable phone sign-in and SMS
reminders:

1. Create a SignalWire account (or reuse the existing fax account — same
   credentials can drive both), buy or pick a phone number.
2. Add to `functions/.env`:
   ```
   SIGNALWIRE_PROJECT_ID=...
   SIGNALWIRE_AUTH_TOKEN=...
   SIGNALWIRE_SPACE_URL=example.signalwire.com
   SIGNALWIRE_SMS_FROM=+14155551234
   ```
3. Redeploy the phone functions:
   ```bash
   firebase deploy --only "functions:sendPhoneVerificationCode,functions:verifyPhoneCode,functions:sendPhoneLoginCode,functions:verifyPhoneLogin" --project patient-demo-project
   ```
4. In Firebase console → Authentication → Sign-in method → enable Phone.
5. Register A2P 10DLC brand + campaign on SignalWire (required for
   production US SMS — unregistered traffic gets filtered). See
   [SIGNALWIRE_SMS.md](SIGNALWIRE_SMS.md) for the walkthrough.

Note: SignalWire SMS is ~$0.004 per segment (cheaper than Twilio). Not free.
Only enable if you're actually going to demo SMS flow.

## Missing step 6 — scheduled functions (reminder crons)

The template has 7 scheduled functions (`todoReminderScheduler`,
`syncCalendarChanges`, `cleanupCancelledAppointments`, `dailySidecarBackup`,
`trimAgentChat`, `calendarReminderScheduler`, `morningReminderScheduler`).

**None are deployed to the demo** because each scheduled function creates a
Cloud Scheduler job at $0.10/month after the first 3 free. 7 jobs − 3 free =
$0.40/month, which breaks the zero-idle-cost target.

If you want to enable a subset, e.g. just the appointment reminders:

```bash
firebase deploy --only "functions:calendarReminderScheduler,functions:morningReminderScheduler,functions:todoReminderScheduler" --project patient-demo-project
```

Expect ~$0/month for up to 3 scheduled functions (Firebase's free quota).

Warning: the reminder functions call SignalWire and will silently skip the
send (logging a warning) if `SIGNALWIRE_PROJECT_ID` / `SIGNALWIRE_SMS_FROM`
aren't set — set the SignalWire env vars first (step 5).

## Missing step 7 — AI agent (optional, big lift)

Currently `sidecarProxy` is deployed but `VITE_SIDECAR_PROXY_URL` in the web
client points nowhere real, and there's no VPS running the sidecar or OpenClaw
agents. The `/admin/agent` and `/support` pages will fail when hit.

To enable:

1. Provision a VPS (~$6/month on DigitalOcean, Hetzner, etc.) or a GCE VM
2. Install Node.js 22 + Bun + OpenClaw + QMD on the host
3. Rewrite `{{PLACEHOLDER}}` tokens in `openclaw/` workspace markdown
4. Deploy the sidecar: `cd sidecar && ./deploy.sh`
5. Set `VITE_SIDECAR_PROXY_URL` in `web/.env` → rebuild + redeploy web
6. Smoke-test via admin dashboard → AI Agent page

The VPS is the only recurring cost in this path (~$6/mo). If you want to keep
demo costs at $0, leave this out and hide the agent UI routes in the demo.

## Missing step 8 — mobile app build

The Flutter app was not built or deployed. To ship it to TestFlight / Play
Internal Testing:

1. `cd mobile && flutterfire configure --project patient-demo-project`
   - Overwrites `lib/firebase_options.dart`, `android/app/google-services.json`,
     `ios/Runner/GoogleService-Info.plist` with real values
2. Update Android `applicationId` + iOS bundle id from `com.example.patient`
   to something unique (e.g. `com.acme-demo.patient`)
3. `flutter build apk` / `flutter build ios`
4. Upload to Play Console / App Store Connect

Not needed for a web-only sales demo.

## Deploy commands (cheat sheet)

```bash
cd /Users/stan/Projects/patient

# Rules + indexes
firebase deploy --project patient-demo-project --only firestore:rules,firestore:indexes,storage

# Minimal functions (no secrets, $0 idle)
firebase deploy --project patient-demo-project --only "functions:createUserWithAuth,functions:updateUserAuth,functions:logAuditEvent,functions:deleteAccount,functions:sendPhoneVerificationCode,functions:verifyPhoneCode,functions:sendPhoneLoginCode,functions:verifyPhoneLogin,functions:serveFile,functions:sidecarProxy"

# Web build + hosting
(cd web && npm run build)
firebase deploy --project patient-demo-project --only hosting

# Full redeploy (after config changes)
firebase deploy --project patient-demo-project --only hosting,firestore:rules
```

## Template vs. demo divergence

The following files were edited specifically for the zero-cost demo and differ
from the "pure template" state:

- `functions/src/stripe.ts` — removed `defineSecret`, uses `process.env` for
  `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
- `functions/src/index.ts` — removed `defineSecret("GOOGLE_SA_KEY")` +
  `secrets: [googleSaKey]` on 5 functions; added `setGlobalOptions({region: "us-west1"})`
- `firebase.json` — added `hosting` block for classic Firebase Hosting (App Hosting block preserved)
- `.firebaserc` — project id `patient-demo-project`
- `web/src/config/branding.ts`, `mobile/lib/config/branding.dart`,
  `functions/src/branding.ts` — "Acme Primary Care" demo brand
- `web/.env` — real Firebase config values (gitignored)

For real customer forks you can either:
- Keep the `process.env` pattern (simpler, no Secret Manager)
- Or restore `defineSecret` + Secret Manager for proper production posture
  (costs $0.06/secret-version/month)
