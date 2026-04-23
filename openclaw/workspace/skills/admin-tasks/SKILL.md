---
name: admin-tasks
description: Manage admin notifications and specialist referral requests
user-invocable: true
---

# Admin Tasks

Manage admin notifications and specialist referral requests via the `admin-api` CLI.

---

## Notifications

### List admin notifications

```bash
admin-api GET /notifications
admin-api GET /notifications?limit=10
```

### Create notification

```bash
admin-api POST /notifications '{"title":"Refill Approved","message":"Your refill for Lisinopril has been approved","recipientRole":"patient","recipientId":"PATIENT_ID","type":"refill_approved","meta":{"refillId":"REFILL_ID"}}'
```

Fields: `title` (required), `message` (required), `recipientRole` (`admin`|`patient`), `recipientId` (optional — omit for broadcasts to a role), `type`, `meta`.

Common `type` values: `refill_approved`, `refill_denied`, `appointment_confirmed`, `appointment_cancelled`, `intake_received`, `message_received`, `document_ready`.

---

## Specialist Requests

### List requests

```bash
admin-api GET /specialist-requests
admin-api GET /specialist-requests?limit=10
```

### Update request

```bash
admin-api PATCH /specialist-requests/REQUEST_ID '{"status":"approved","notes":"Referred to Dr. Lee, cardiology"}'
```

Allowed `status` values: `pending`, `approved`, `denied`, `completed`. Always include `notes` explaining the decision — patients see this in their portal.

---

## When to create notifications

After processing a refill, appointment change, intake form, specialist request, or message that affects a patient, create a notification for the patient so they see the update in their portal. Always set `recipientRole: "patient"` and `recipientId: <patient uid>` so it lands in the right inbox.

For routine writes you initiated yourself, this is the close-out step — without it, the patient has no in-app signal that anything changed.
