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

## Guidelines

- Send emails directly when the user gives clear instructions
- Create, update, or delete calendar events when given clear instructions
- For large Drive files, summarize rather than outputting full content
- Use the user's timezone for calendar operations
