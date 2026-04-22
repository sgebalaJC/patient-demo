---
name: admin-tasks
description: Manage admin notifications and specialist referral requests
user-invocable: true
---

# Admin Tasks

Manage notifications and specialist requests via the `admin-api` CLI.

---

## Notifications

```bash
admin-api GET /notifications
admin-api POST /notifications '{"title":"Refill Approved","message":"Your Lisinopril refill was approved","recipientRole":"patient","recipientId":"PID","type":"refill_approved"}'
```

---

## Specialist Requests

```bash
admin-api GET /specialist-requests
admin-api PATCH /specialist-requests/REQ_ID '{"status":"approved","notes":"Referred to Dr. Lee"}'
```

---

After processing refills, appointments, or intake forms, create a notification for the patient.
