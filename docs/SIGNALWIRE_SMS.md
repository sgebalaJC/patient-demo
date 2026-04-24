# SignalWire SMS — wiring + A2P 10DLC registration

All outbound patient/admin SMS and inbound reply capture goes through SignalWire's LaML namespace (Twilio-API-compatible endpoints). The code paths are documented inline in CLAUDE.md; this file covers the **operational setup** that must be done on the SignalWire side before real SMS will flow.

## Wiring — what the code expects

| Secret | Where | Example | Purpose |
|---|---|---|---|
| `SIGNALWIRE_PROJECT_ID` | Cloud Secret Manager + `/root/sidecar.env` | `a1b2c3d4-…` | LaML API username + signing identity |
| `SIGNALWIRE_AUTH_TOKEN` | Cloud Secret Manager + `/root/sidecar.env` | `PT…` | LaML API password + default webhook HMAC key |
| `SIGNALWIRE_SPACE_URL` | Cloud Secret Manager + `/root/sidecar.env` | `example.signalwire.com` | Host for LaML calls (no scheme, no trailing slash) |
| `SIGNALWIRE_SMS_FROM` | Cloud Secret Manager + `/root/sidecar.env` | `+14155551234` | E.164 sender DID for all outbound SMS |
| `SIGNALWIRE_SIGNING_KEY` | Cloud Secret Manager (optional) | `SK…` | If you configured a project-level signing key in the dashboard; overrides the auth token for webhook HMAC verification |

**Cloud Functions** that send SMS (`sendPhoneVerificationCode`, `sendPhoneLoginCode`, `sendWelcomeSms`, reminder schedulers) bind these via `SMS_SECRETS` in `functions/src/lib/sms-helpers.ts`.

**Sidecar** reads them from env vars for `/admin-api/messaging/send` (outbound) and `/webhooks/signalwire/inbound-sms` (inbound).

### Inbound webhook registration

In the SignalWire dashboard → your SMS DID → **Messaging** section → set the handler URL to:

```
http://<sidecar-host>:8081/webhooks/signalwire/inbound-sms
```

Method: HTTP POST. Content-Type: `application/x-www-form-urlencoded` (SignalWire's default).

The handler verifies `X-SignalWire-Signature` (HMAC-SHA1 over URL + sorted form params, base64) and also accepts the legacy `X-Twilio-Signature` header so a Twilio → SignalWire port can flip without breaking mid-migration.

Plain HTTP is fine for staging. For HIPAA-hardened production, front the sidecar with nginx + Let's Encrypt and point the webhook at the HTTPS URL.

---

## TODO — A2P 10DLC brand + campaign registration (US SMS, required)

Any US SMS sent from a 10-digit long code (`+1XXXXXXXXXX`, which is what we use) **must** be backed by a registered A2P brand + campaign. Unregistered traffic is either rate-limited (~1 msg/sec per DID) or filtered by carriers (T-Mobile is the most aggressive). This applies on SignalWire exactly as it did on Twilio — registration does not carry over between providers.

**Status:** not yet done for the demo project. Welcome SMS, appointment reminders, and phone OTP will work from a test phone during development, but production sends at scale will get filtered.

### Prerequisites

- [ ] Confirm the customer is the "brand" (the entity whose name appears on consent language and in the campaign filing). For the demo it's **Aurelia MD**.
- [ ] Gather brand registration inputs:
  - [ ] Legal company name + DBA (if different)
  - [ ] Country of registration (US)
  - [ ] Business type (private / public / LLC / sole proprietor — affects fee tier)
  - [ ] EIN (for anything other than sole proprietor) or SSN/ITIN (sole proprietor only)
  - [ ] Industry vertical — pick `HEALTHCARE`
  - [ ] Company website URL (must be live, https, and describe the service)
  - [ ] Physical street address (no PO boxes — TCR validates)
  - [ ] Corporate point-of-contact: first/last name, email, phone
- [ ] Gather campaign registration inputs:
  - [ ] Use case: pick `MIXED` or `HEALTHCARE` (both carry the same throughput tier; `HEALTHCARE` unlocks some carrier features but requires an opt-in language audit)
  - [ ] Sample messages (≥ 2, ≤ 5). Must match actual traffic — inventors get rejected. Suggested set:
    - Welcome SMS: *"Welcome to Aurelia MD. Tap the sign-in link we just emailed you to activate your portal. Reply STOP to unsubscribe."*
    - Appointment reminder: *"Aurelia MD: you have an appointment tomorrow at 2:00 PM with Dr. Chen. Reply C to confirm or reschedule at <link>. Reply STOP to unsubscribe."*
    - Phone OTP: *"Aurelia MD verification code: 123456. Do not share this code. Reply STOP to unsubscribe."*
  - [ ] Opt-in flow: screenshot of the place in our UI where the patient consented to SMS. For demo: the sign-up form where they enter their phone number, plus the Profile page SMS-preferences toggle.
  - [ ] Opt-in language: the exact text next to the consent checkbox. Needs to say who's sending, what kinds of messages, "message and data rates may apply", and how to stop (`STOP`).
  - [ ] Opt-out language: we already handle `STOP` / `UNSUBSCRIBE` server-side — confirm the flow writes to a suppression list and never retries.
  - [ ] Help language: reply `HELP` returns contact info.
  - [ ] Estimated monthly volume — pick conservatively; higher tiers cost more and the campaign can be upgraded later.

### Steps on SignalWire

1. [ ] Dashboard → **Compliance** → **Campaign Registry** → **Register Brand**. Fill in brand inputs above. Fee: **$44 one-time** for Standard brand (charged by TCR, the 10DLC registrar — not SignalWire). Vetting takes minutes for low-volume brands, up to a few days for high-volume.
2. [ ] Once the brand is `REGISTERED`, → **Register Campaign** against that brand. Fill in campaign inputs. Fees: **$10/month** campaign fee + **$1.50 one-time** vetting + **$0.0025–$0.01 per carrier per message** pass-through surcharge. Approval takes 1–5 business days; carrier reviews happen in parallel after.
3. [ ] Once the campaign is `APPROVED` for all three majors (AT&T, T-Mobile, Verizon), → **Phone Numbers** → your DID → **Assign to campaign**. This is the step that actually routes traffic through the registered path. Numbers are not usable for real 10DLC sending until assigned.
4. [ ] Smoke test: send one of each sample message template to a phone on each major carrier. T-Mobile is the strictest — if it's going through there, you're good.

### Ongoing

- [ ] If we add a new **kind** of SMS (e.g., survey invites), the message needs to plausibly fall under one of the registered sample templates. Adding a new template after the fact requires an amendment filing.
- [ ] If the practice rebrands or changes legal entity, re-register the brand.
- [ ] Monitor campaign status in SignalWire → Compliance. Carriers can retroactively revoke approval if they detect spammy traffic — unlikely for transactional healthcare but worth a quarterly glance.

### Escape hatch — toll-free

If 10DLC registration stalls (TCR rejections for opt-in language are common on the first pass), SignalWire toll-free numbers also require verification, but it's a single-step form on SignalWire's side (no TCR fee) and approvals are faster. Throughput is higher too (3 msg/sec vs 1 for unregistered 10DLC). Downside: toll-free numbers read as less legitimate to patients — fine as a staging fallback, not ideal for production branding.

---

## References

- SignalWire Compliance docs: https://developer.signalwire.com/compliance/
- TCR (The Campaign Registry): https://www.campaignregistry.com/
- CTIA Messaging Principles (the rules carriers enforce): https://api.ctia.org/wp-content/uploads/2019/07/190719-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf
