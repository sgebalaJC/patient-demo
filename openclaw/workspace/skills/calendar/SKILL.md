---
name: calendar
description: List, create, update, and delete Google Calendar events
user-invocable: true
---

# Google Calendar

Manage events on Google Calendar via the `gog` CLI. Default account: `admin@example.com`.

When the user specifies a different `@example.com` account, use `--account <that-email>` instead of the default. Domain-wide delegation allows impersonating any `@example.com` user.

## Commands

### List upcoming events

```bash
gog calendar events primary --from 2026-03-23T00:00:00Z --to 2026-03-30T23:59:59Z --account <user>@example.com --json
```

### List events on a specific calendar

```bash
gog calendar events <calendarId> --from <isoStart> --to <isoEnd> --account <user>@example.com --json
```

### Create event

```bash
gog calendar create primary --summary "Meeting Title" --from 2026-03-24T10:00:00-07:00 --to 2026-03-24T11:00:00-07:00 --account <user>@example.com --json
```

### Create event with location and description

```bash
gog calendar create primary --summary "Team Standup" --from 2026-03-24T09:00:00-07:00 --to 2026-03-24T09:30:00-07:00 --location "Office" --description "Weekly sync" --account <user>@example.com --json
```

### Update event

```bash
gog calendar update primary <eventId> --summary "New Title" --account <user>@example.com --json
```

### Delete event

```bash
gog calendar delete primary <eventId> --account <user>@example.com --force --json
```

### Show calendar colors

```bash
gog calendar colors
```

## Safety rules

- **Never create, update, or delete events without showing the user a preview and getting explicit approval**
- Always confirm: title, time, location, and attendees before creating
- When listing events, use the user's timezone (Pacific: -07:00)
- Use `--json` for structured output when parsing results
- Default to `admin@example.com` when no account is specified
- Only impersonate `@example.com` accounts — never external domains
