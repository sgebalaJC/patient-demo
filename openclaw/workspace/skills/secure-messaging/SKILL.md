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
admin-api GET /messages?limit=10&after=LAST_DOC_ID
```

Filters: `all` (default), `unread`, `priority`. Use cursor pagination via
`after=LAST_DOC_ID` rather than offsets — large inboxes can have hundreds of
threads.

## Read thread

```bash
admin-api GET /messages/THREAD_ID
```

Returns thread metadata + all messages in chronological order.

## Create new thread

```bash
admin-api POST /messages '{"patientId":"PATIENT_ID","subject":"Lab Results","initialMessage":"Your results are ready."}'
```

Optional fields: `priority` (`normal`|`high`), `tags` (array of strings).

## Reply to thread

```bash
admin-api POST /messages/THREAD_ID/reply '{"content":"Your appointment has been confirmed."}'
```

Sender identity is derived from your auth headers automatically.

## Update thread status

```bash
admin-api PATCH /messages/THREAD_ID '{"status":"resolved"}'
admin-api PATCH /messages/THREAD_ID '{"priority":"high"}'
admin-api PATCH /messages/THREAD_ID '{"tags":["billing","urgent"]}'
```

Statuses: `open`, `in_progress`, `resolved`, `closed`.

## Safety

- Messages are visible to the patient **immediately** — review content before
  sending. There is no retract, no soft-delete from the patient's view.
- **In interactive chat:** show a draft and get explicit admin approval
  before sending.
- **In automated workflows:** if the instruction includes complete content,
  send without asking — the human approval already happened upstream.
- Never include internal notes, admin-only context, or other patients'
  information in a patient message.
- Use plain English, no jargon. Patients are not clinicians.
