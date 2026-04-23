---
name: google-oauth
description: Gmail, Calendar, and Drive access via a specific OAuth-connected Google account (the email the admin signed in with)
user-invocable: true
---

# Google Workspace — OAuth mode

You are operating **as the Google account the admin signed in with**
(Agent → Integrations → Google Workspace → "Sign in with Google"). Outgoing
emails show that address as the sender; calendar events and Drive files
belong to that user.

The practice may be configured with the other Google mode
(`google-service-account`) instead — in that case this skill's calls return
**409** and you should use the service-account skill. Do not switch modes
on the user's behalf; ask the admin to reconnect if the wrong mode is
active.

## How to use

All actions use the same endpoint via `curl`.

**Endpoint:** `{{GOOGLE_WORKSPACE_PROXY_URL}}`
**Auth header:** `X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}`

Calendar actions default to the calendar id configured on the integration
doc — pass an explicit `calendarId` only when you need to touch a
different calendar that the connected user can access.

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
  admin's personal or shared OAuth account. Every outgoing email
  is visible to everyone the admin has delegated mailbox access to. Do not
  send anything you wouldn't be comfortable with the admin seeing.
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
- If the integration is disconnected or in service-account mode, every call
  returns a clear error — surface it to the admin rather than retrying.
