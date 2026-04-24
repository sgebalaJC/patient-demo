---
name: google-workspace
description: Gmail, Calendar, and Drive access via the practice's connected Google Workspace account — read inbox, manage events, read/write Drive files
user-invocable: true
---

# Google Workspace

Read and send email, manage calendar events, and read/write Drive files as the practice's connected Google Workspace account (Agent → Integrations → Google Workspace).

The admin chose one of two auth modes at setup time — OAuth (agent acts as the signed-in user) or service-account domain-wide delegation (agent impersonates a named subject email). **You don't need to know which.** The server routes transparently; your responses reference "the practice's Google account" when the caller asks.

If the integration isn't connected, every call returns a clear error (see [Error handling](#error-handling)) — surface it rather than retrying.

## Endpoint

All actions hit one endpoint with `{ service, action, ...args }`:

```bash
curl -sf -X POST "{{GOOGLE_WORKSPACE_PROXY_URL}}" \
  -H "X-Api-Key: {{GOOGLE_WORKSPACE_API_KEY}}" \
  -H "Content-Type: application/json" \
  -d '{ "service": "<gmail|calendar|drive>", "action": "<action>", ... }'
```

Calendar actions default to the `calendarId` configured on the integration doc — pass an explicit `calendarId` only when you need to touch a different calendar that the connected account can access.

## Gmail

### Check inbox

```bash
-d '{ "service": "gmail", "action": "inbox", "maxResults": 10 }'
```

### Read a message

```bash
-d '{ "service": "gmail", "action": "read", "messageId": "<id>" }'
```

### Send

```bash
-d '{ "service": "gmail", "action": "send", "to": "user@example.com", "subject": "Subject", "body": "Plain text body" }'
```

### Reply to a message

```bash
-d '{ "service": "gmail", "action": "reply", "messageId": "<id>", "body": "Reply body" }'
```

`reply` replies in-thread with `In-Reply-To` / `References` headers. Do **not** use `send` to fake a reply — it loses threading and looks wrong to the recipient.

## Google Calendar

### List events in a window

```bash
-d '{ "service": "calendar", "action": "list", "timeMin": "2026-04-01T00:00:00Z", "timeMax": "2026-04-07T23:59:59Z" }'
```

### Get event details

```bash
-d '{ "service": "calendar", "action": "get", "eventId": "<id>" }'
```

### Create, update, delete

```bash
-d '{ "service": "calendar", "action": "create", "event": { "summary": "Meeting", "start": { "dateTime": "2026-04-03T10:00:00-07:00" }, "end": { "dateTime": "2026-04-03T11:00:00-07:00" } } }'

-d '{ "service": "calendar", "action": "update", "eventId": "<id>", "updates": { "summary": "Renamed" } }'

-d '{ "service": "calendar", "action": "delete", "eventId": "<id>" }'
```

Use the practice's timezone for dateTimes — default Pacific (`-07:00` / `-08:00` depending on DST). Timezone-naive timestamps drift by hours.

**Calendar reminders gotcha:** the API accepts `"method": "email"` reminders, but some Google Workspace accounts silently suppress them in the Calendar UI. Popup reminders work reliably. Don't promise email reminders will be visible — if the user asks, note the caveat.

## Google Drive

Extract file IDs from URLs: `https://docs.google.com/document/d/<fileId>/edit`, `https://drive.google.com/file/d/<fileId>/view`.

### List / search

```bash
-d '{ "service": "drive", "action": "list", "maxResults": 20 }'

-d '{ "service": "drive", "action": "list", "query": "name contains '\''report'\''" }'
```

### Read

```bash
-d '{ "service": "drive", "action": "read", "fileId": "<id>" }'
```

### Create

```bash
-d '{ "service": "drive", "action": "create", "name": "notes.txt", "content": "File content here", "mimeType": "text/plain" }'
```

For a Google Doc: `"mimeType": "application/vnd.google-apps.document"`. For a Sheet: `"application/vnd.google-apps.spreadsheet"`.

## Read-before-write rule

Before modifying any existing Drive file, **always read the current state first**. This prevents overwrites, column misalignment on Sheets, and body-loss on Docs.

```
1. drive.read or drive.list  → understand what's actually there
2. Build your change to match the existing structure
3. Write
4. drive.read  → verify the result
```

Never assume a file's current contents or layout. Never write blindly "just to see what happens." If the file isn't yours, a wrong write is a destructive action.

## What NOT to do

- **Don't invent IDs.** `fileId`, `messageId`, `eventId` must come from a list/search result or a URL the user pasted. Never guess.
- **Don't retry blindly on failure.** A 4xx doesn't become a 2xx by trying again. Read the error (see [Error handling](#error-handling)) and decide.
- **Don't loop one-at-a-time writes.** Batch into one request whenever the API supports it.
- **Don't dump large Drive files into chat.** Summarize instead. If the user specifically wants the full content, warn about length and send a chunk.
- **Don't use `send` to fake a reply.** Use `reply` with the original `messageId`.
- **Don't send emails you wouldn't want the admin's teammates to see.** The connected account's colleagues can see outgoing mail if they have delegated mailbox access.

## Error handling

| Error | Meaning | Action |
|---|---|---|
| `not_connected` / 400 | Integration disconnected or not yet configured | Tell the admin to go to Agent → Integrations → Google Workspace and connect |
| 401 | Token refresh failed (OAuth) or SA key invalid (service-account) | Tell the admin to reconnect the integration |
| 403 | File/calendar not shared with the connected account | Ask the user (or admin) to share it with the account shown by the `status` endpoint |
| 404 | Invalid file ID, message ID, or event ID | Verify the ID; don't retry with the same value |
| 409 | Wrong auth mode for this integration | Tell the admin to reconnect in the required mode — do NOT switch modes on their behalf |
| 429 | Google rate limit | Wait and retry once. Do not loop. |
| 500 / 503 | Google transient error | Retry once after a pause |

## Safety + workflow

- **Identity matters.** You are emailing, scheduling, and saving files AS the practice's connected account. Outgoing mail appears to that account's teammates as though the account-holder sent it. In a HIPAA context, assume anything you send could reach the practice's compliance officer.
- **In interactive chat:** show a draft (recipient, subject, body) and get explicit approval **before** sending an email. Same for calendar invites and Drive file creation.
- **In a workflow or scheduled task:** if the instructions include complete parameters, execute immediately. Don't prompt for approval the user can't give.
- For replies, show the original email context first so the user knows what they're replying to.
- If a write fails, read the current state before any retry — don't retry blindly.
