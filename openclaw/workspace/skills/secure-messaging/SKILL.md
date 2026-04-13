---
name: secure-messaging
description: Read and reply to patient message threads — HIPAA-compliant secure messaging
user-invocable: true
---

# Secure Messaging

Manage patient message threads via the `admin-api` CLI.

## List threads

```bash
admin-api GET /messages
admin-api GET /messages?filter=unread
admin-api GET /messages?filter=priority
```

## Read thread

```bash
admin-api GET /messages/THREAD_ID
```

## Create thread

```bash
admin-api POST /messages '{"patientId":"PID","subject":"Lab Results","initialMessage":"Your results are ready."}'
```

## Reply

```bash
admin-api POST /messages/THREAD_ID/reply '{"content":"Your appointment has been confirmed."}'
```

## Update thread

```bash
admin-api PATCH /messages/THREAD_ID '{"status":"resolved"}'
admin-api PATCH /messages/THREAD_ID '{"priority":"high"}'
```

## Safety

- Messages are visible to the patient immediately — review before sending
- In interactive chat: show draft and get approval before sending
- In automated workflows: send if content is complete
- Never include internal notes in patient messages
