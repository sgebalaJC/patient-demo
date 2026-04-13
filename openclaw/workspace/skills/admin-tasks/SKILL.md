---
name: admin-tasks
description: Manage admin todos, notifications, and specialist referral requests
user-invocable: true
---

# Admin Tasks

Manage todos, notifications, and specialist requests via the `admin-api` CLI.

---

## Todos

```bash
admin-api GET /todos
admin-api GET /todos?filter=upcoming
admin-api GET /todos?filter=overdue
admin-api POST /todos '{"title":"Call Dr. Smith","scheduledDateTime":"2026-04-14T10:00:00Z"}'
admin-api PATCH /todos/TODO_ID '{"isCompleted":true}'
admin-api DELETE /todos/TODO_ID
```

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
