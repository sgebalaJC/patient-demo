---
name: google-workspace
description: Gmail, Google Calendar, and Google Drive — read emails, manage events, access files
user-invocable: true
---

# Google Workspace

Access Gmail, Google Calendar, and Google Drive through the connected Google account.

## How to use

All actions use the same endpoint via `curl`.

**Endpoint:** `{{GOOGLE_WORKSPACE_PROXY_URL}}`
**Auth header:** `X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}`

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

- **In interactive chat:** Show a draft (recipient, subject, body) and get
  explicit approval **before** sending an email. Do the same for calendar
  events (title, time, location, attendees) and Drive file creation.
- **In workflows or automated tasks:** If the instruction includes complete
  parameters, execute immediately without asking for confirmation — the human
  approval already happened upstream.
- For replies, show the original email context so the user knows what they're
  replying to.
- Send sends; reply replies. Never use `send` to fake a reply (it loses
  threading and the "Re:" header).
- For large Drive files, summarize rather than outputting the full content.
- Use the user's timezone for calendar operations (default Pacific:
  `-07:00` / `-08:00` depending on DST).
- The connected account is whatever the admin authorized in
  Agent → Integrations → Google Workspace. There is no per-call account
  override — to switch users, reconnect with that account.
