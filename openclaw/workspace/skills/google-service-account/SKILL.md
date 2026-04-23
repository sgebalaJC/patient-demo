---
name: google-service-account
description: Gmail, Calendar, and Drive access via a Workspace service account impersonating a subject user (domain-wide delegation)
user-invocable: true
---

# Google Workspace — service-account mode

You are operating via **domain-wide delegation**: a Google Workspace
service account signs a JWT with a `sub` claim naming the subject email
configured in Agent → Integrations → Google Workspace. Every outgoing
email shows that subject's address as the sender; calendar events and
Drive files belong to the subject user.

The practice may be configured with the other Google mode (`google-oauth`)
instead — in that case this skill's calls return **409** and you should
use the OAuth skill. Do not switch modes on the user's behalf; ask the
admin to reconnect if the wrong mode is active.

## How to use

All actions use the same endpoint via `curl`.

**Endpoint:** `{{GOOGLE_WORKSPACE_PROXY_URL}}`
**Auth header:** `X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}`

Calendar actions default to the calendar id configured on the integration
doc — pass an explicit `calendarId` only when you need to touch a
different calendar that the subject user can access.

---

## Gmail

### Check inbox

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "gmail", "action": "inbox", "maxResults": 10}'
```

### Read full email

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "gmail", "action": "read", "messageId": "<id>"}'
```

### Send email

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "gmail", "action": "send", "to": "recipient@example.com", "subject": "Subject", "body": "Email body"}'
```

### Reply to email

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "gmail", "action": "reply", "messageId": "<id>", "body": "Reply body"}'
```

---

## Google Calendar

### List upcoming events

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "calendar", "action": "list", "timeMin": "2026-04-01T00:00:00Z", "timeMax": "2026-04-07T23:59:59Z"}'
```

### Get event details

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "calendar", "action": "get", "eventId": "<id>"}'
```

### Create event

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "calendar", "action": "create", "event": {"summary": "Meeting", "start": {"dateTime": "2026-04-03T10:00:00-07:00"}, "end": {"dateTime": "2026-04-03T11:00:00-07:00"}}}'
```

### Update event

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "calendar", "action": "update", "eventId": "<id>", "updates": {"summary": "Updated Meeting"}}'
```

### Delete event

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "calendar", "action": "delete", "eventId": "<id>"}'
```

---

## Google Drive

### List recent files

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "drive", "action": "list", "maxResults": 20}'
```

### Search files

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "drive", "action": "list", "query": "name contains '\''report'\''"}'
```

### Read file content

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "drive", "action": "read", "fileId": "<id>"}'
```

### Create file

```bash
curl -s -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -d '{"service": "drive", "action": "create", "name": "notes.txt", "content": "File content here", "mimeType": "text/plain"}'
```

---

## Safety + workflow rules

- **Identity matters.** You are emailing + scheduling + saving files AS the
  Workspace subject user the service account is impersonating. Outgoing
  mail appears to that user's teammates as though the user sent it. Do not
  send anything the subject wouldn't send personally.
- **In interactive chat:** Show a draft (recipient, subject, body) and get
  explicit approval **before** sending an email. Do the same for calendar
  events and Drive file creation.
- **In workflows or automated tasks:** If the instruction includes complete
  parameters, execute immediately without asking for confirmation.
- For replies, show the original email context so the user knows what they're
  replying to.
- Send sends; reply replies. Never use `send` to fake a reply.
- For large Drive files, summarize rather than outputting the full content.
- Use the practice's timezone for calendar operations (default Pacific:
  `-07:00` / `-08:00` depending on DST).
- If the integration is disconnected or in OAuth mode, every call returns a
  clear error — surface it to the admin rather than retrying.
