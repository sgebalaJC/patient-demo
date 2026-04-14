# Product Roadmap

Phased plan for expanding the patient portal from its current feature set. Each phase builds on the previous one. Phases are roughly ordered by effort and dependency, but individual items within a phase can be tackled independently.

## Current State

**Built:** Auth (email/password, Google OAuth, email link, phone OTP), patient dashboard, appointments, messages with attachments, prescription refills, document uploads, intake forms, support chat, billing (Stripe), admin dashboard, user management, admin todos, specialist requests, AI agents (admin + patient support), Google Calendar sync, SMS reminders (Twilio), mobile app (Flutter) with biometric auth, three themes.

**Feature flags:** user management, appointments, messages, prescriptions, documents, patient intake, admin tools, admin todos.

---

## Phase 1 — Polish & Complete

Low effort, high impact. Finishes partially-built features.

| Item | Description | Platform |
|------|-------------|----------|
| Push notifications (FCM) | Scaffolding exists in mobile — wire up token registration and Cloud Function triggers | Mobile + Functions |
| Mobile document upload | Camera/gallery picker for patient documents | Mobile |
| Mobile message attachments | Display attachments in thread detail view | Mobile |
| Transactional email templates | Appointment confirmations, refill status updates, welcome emails (replace hardcoded SMS strings) | Functions |
| Appointment reminders | Automated SMS/email N hours before appointment via Cloud Function cron | Functions |
| Mobile release prep | App icon, splash screen, release signing configs | Mobile |

---

## Phase 2 — Patient Experience

Features that directly improve the patient-facing product.

| Item | Description | Platform |
|------|-------------|----------|
| ~~Online scheduling~~ | ~~Already built: patient self-booking with availability grid + admin approval~~ | ~~Done~~ |
| Telehealth / video visits | Embedded video call (Daily, Twilio Video, or WebRTC) linked to appointments | Web + Mobile |
| Electronic signatures | Consent forms, intake agreements with legally-binding e-sign capture | Web + Mobile |
| Patient data export | HIPAA right-of-access: one-click download of all patient records as PDF/ZIP | Web + Functions |
| Waitlist | Patients join a waitlist when no slots are available, auto-notified on cancellations | Web + Mobile + Functions |

---

## Phase 3 — Clinical & Admin Efficiency

Tools that improve provider workflows and practice operations.

| Item | Description | Platform |
|------|-------------|----------|
| Charting / visit notes | Basic SOAP note editor for providers, attached to appointments | Web |
| Lab results viewer | Structured lab data display with trend charts for patients | Web + Mobile |
| Referral management | Expand specialist requests into full referral tracking with patient-facing status updates | Web + Mobile |
| Bulk messaging | Admin broadcasts to patient segments (e.g., flu shot reminders, office closures) | Web + Functions |
| Reporting dashboard | Appointment volume, no-show rates, refill turnaround, patient growth metrics | Web |

---

## Phase 4 — Platform & Integrations

Connects the portal to the broader healthcare ecosystem.

| Item | Description | Platform |
|------|-------------|----------|
| EHR integration | HL7 FHIR adapter for bidirectional sync with Epic, Cerner, athenahealth | Functions |
| Inbound fax ingestion (SignalWire) | Receive faxes via SignalWire webhook, store PDFs, AI-extract sender/document type, match patient, upload to DrChrono chart — see [`docs/FAX_INGESTION.md`](FAX_INGESTION.md) | Functions + Sidecar + Web |
| Insurance verification | Real-time eligibility checks via a clearinghouse API (e.g., Eligible, Change Healthcare) | Web + Functions |
| Payment plans | Extend Stripe billing with installment plans and payment reminders | Web + Functions |
| Patient reviews / NPS | Post-visit satisfaction surveys with aggregate reporting for admins | Web + Mobile + Functions |
| Multi-location support | Per-location branding, staff assignments, and scheduling | All |

---

## Phase 5 — AI & Automation

Leverage the existing AI agent infrastructure for smarter workflows.

| Item | Description | Platform |
|------|-------------|----------|
| AI triage | Patient describes symptoms, agent suggests urgency and routes to appropriate care | Web + Mobile (support chat) |
| Smart scheduling | AI suggests optimal appointment times based on provider availability and patient history | Web + Mobile |
| Auto-coding | Suggest ICD/CPT codes from visit notes | Web (admin) |
| Automated follow-ups | Post-visit check-in messages triggered by appointment type and time elapsed | Functions |

---

## Notes

- Each item should include Firestore rules and indexes updates where new collections are introduced.
- Mobile features should be implemented in both web and Flutter unless noted otherwise.
- All patient-facing features need input validation on both client and server (see `FIELD_LIMITS` pattern).
- PII logging rules apply to all new features — log UIDs and roles only.
