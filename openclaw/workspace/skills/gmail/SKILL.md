---
name: gmail
description: Read inbox, read full emails, send emails, and reply to emails via Gmail
user-invocable: true
---

# Gmail

Read and manage emails via the `gog` CLI. Default account: `admin@example.com`.

When the user specifies a different `@example.com` account (e.g. "emails for admin@example.com"), use `--account <that-email>` instead of the default. Domain-wide delegation allows impersonating any `@example.com` user.

## Commands

### Check inbox (recent emails)

```bash
gog gmail search 'newer_than:1d' --max 10 --account <user>@example.com --json
```

### Search emails

```bash
gog gmail search 'from:someone@example.com subject:invoice' --max 10 --account <user>@example.com --json
```

### Search messages (per-message, ignores threading)

```bash
gog gmail messages search 'in:inbox from:example.com' --max 20 --account <user>@example.com --json
```

### Read full email thread

```bash
gog gmail read <threadId> --account <user>@example.com --json
```

### Read single message

```bash
gog gmail messages read <messageId> --account <user>@example.com --json
```

### Send email (plain text)

```bash
gog gmail send --to recipient@example.com --subject "Subject" --body "Email body" --account <user>@example.com --json
```

### Send email (multi-line body via file)

```bash
echo "Multi-line body here" > /tmp/email-body.txt
gog gmail send --to recipient@example.com --subject "Subject" --body-file /tmp/email-body.txt --account <user>@example.com --json
```

### Reply to email

```bash
gog gmail send --to recipient@example.com --subject "Re: Original Subject" --body "Reply body" --reply-to-message-id <messageId> --account <user>@example.com --json
```

### Create draft

```bash
gog gmail drafts create --to recipient@example.com --subject "Subject" --body "Draft body" --account <user>@example.com --json
```

### Send draft

```bash
gog gmail drafts send <draftId> --account <user>@example.com --json
```

## Safety rules

- **In interactive chat:** Show a draft (recipient, subject, body) and get explicit approval before sending
- **In workflows or automated tasks:** If the instruction includes a complete recipient, subject, and body, send immediately without asking for confirmation
- For replies, show the original email context so the user knows what they are replying to
- Use `--json` for structured output when parsing results
- Default to `admin@example.com` when no account is specified
- Only impersonate `@example.com` accounts — never external domains
