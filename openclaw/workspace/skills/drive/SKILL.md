---
name: drive
description: Search, list, read, and create Google Drive files
user-invocable: true
---

# Google Drive

Access Google Drive files via the `gog` CLI. Default account: `admin@example.com`.

When the user specifies a different `@example.com` account, use `--account <that-email>` instead of the default. Domain-wide delegation allows impersonating any `@example.com` user.

## Commands

### Search files

```bash
gog drive search "report" --max 10 --account <user>@example.com --json
```

### List recent files

```bash
gog drive search "" --max 20 --account <user>@example.com --json
```

### Read Google Doc content

```bash
gog docs cat <docId> --account <user>@example.com
```

### Export Google Doc to text

```bash
gog docs export <docId> --format txt --out /tmp/doc.txt --account <user>@example.com
```

### Read Google Sheet data

```bash
gog sheets get <sheetId> "Sheet1!A1:Z100" --json --account <user>@example.com
```

### Update Google Sheet

```bash
gog sheets update <sheetId> "Sheet1!A1:B2" --values-json '[["A","B"],["1","2"]]' --input USER_ENTERED --account <user>@example.com --json
```

### Get sheet metadata

```bash
gog sheets metadata <sheetId> --json --account <user>@example.com
```

## Safety rules

- **Never create or modify files without showing the user a preview and getting explicit approval**
- For large files, summarize rather than outputting full content
- When searching, prefer narrow queries to avoid overwhelming results
- Use `--json` for structured output when parsing results
- Default to `admin@example.com` when no account is specified
- Only impersonate `@example.com` accounts — never external domains
