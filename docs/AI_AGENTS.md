# AI Agents — Architecture & Operations (template)

This is the generic template version of the AI agents doc. Fill in the `{{PLACEHOLDERS}}` when forking for a new customer.

Two OpenClaw agents power the AI experience:

- **Admin agent** (`main`) — staff assistant, full data access. Can optionally get Google Workspace access (Gmail, Calendar, Drive) via `gog` CLI with SA domain-wide delegation for the customer domain.
- **Patient support agent** (`patient-support`) — patient-facing chatbot, **NO patient data access** (HIPAA defense in depth; acts as practice navigator and FAQ bot).

Unified auth flows through the `sidecarProxy` Cloud Function. Agent routing uses agent-scoped session keys (`agent:patient-support:web-chat-{sessionId}`) — NOT accountId-based.

QMD memory enabled (local BM25 + vector search, 5-min refresh, embedding model under `/root/.cache/qmd/models/`).

## Host (per customer)

Each customer runs its own host with OpenClaw + the sidecar. The reference deployment is a GCE `e2-medium` in us-central1-a, but Vultr and other providers work too — adjust `sidecar/deploy.sh` constants accordingly.

**Minimum specs:** `e2-medium` class (2 shared vCPU, 4 GB RAM, 4 GB swap). `e2-small` (2 GB) is **not** enough — the gateway hangs during cold-start under CPU pressure.

**Firewall:** port 8081 (sidecar) open to the world OR tunneled through a load balancer. Gateway port 18789 is loopback-only.

**Systemd units (on the host):**
- `{{SIDECAR_UNIT_NAME}}.service` — runs the sidecar as root (`ExecStart=/root/{{SIDECAR_UNIT_NAME}}`). The default template name is `showmd-sidecar`; rename before shipping if you prefer.
- `openclaw-gateway.service` — **user-scope** (under root's user systemd, lingered via `loginctl enable-linger root`), managed by `openclaw gateway install`.

## Agent admin UI

`/admin/agent` renders `AgentPage.tsx` with tabs:

**Chat · Skills · Channels · Integrations · Backups · Health**

- **Chat** — direct chat with the admin agent
- **Skills** — install/uninstall OpenClaw skills
- **Channels** — connect messaging channels (Slack wired; Telegram/Discord/WhatsApp stubs)
- **Integrations** — view of `openclaw.json` channels + plugins
- **Backups** — create/restore sidecar workspace backups
- **Health** — sidecar + gateway status, stats, version

## Slack → admin agent

Connected via **Channels tab** in the admin UI. All logic is browser-side in `web/src/lib/slack.ts` — it reads/writes `openclaw.json` via the existing `/config PATCH` + `/restart` sidecar endpoints, so adding new channels needs no sidecar rebuild.

**Binding shape:**
```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "groupPolicy": "open",
      "accounts": {
        "main": {
          "botToken": "xoxb-...",
          "appToken": "xapp-...",
          "dmPolicy": "open",
          "allowFrom": ["*"],
          "groupPolicy": "open"
        }
      }
    }
  },
  "bindings": [
    { "type": "route", "agentId": "main", "match": { "channel": "slack", "accountId": "main" } }
  ]
}
```

Tokens live **only** in `openclaw.json` on the host — never in Firestore.

### CRITICAL: OpenClaw config schema is strict

OpenClaw's validator has `additionalProperties: false` under `channels.slack.accounts.<id>`. **Only write schema-known keys** (`botToken`, `appToken`, `dmPolicy`, `allowFrom`, `groupPolicy`). Writing unknown fields (e.g., a `workspaceName` cache) bricks gateway boot with `invalid config: must NOT have additional properties`. Workspace name is fetched fresh on each status read via `slackAuthTest()`, not cached in config.

### Slack `auth.test` CORS workaround

Slack's Web API rejects browser preflight requests that carry an `Authorization` header. Workaround: **`sidecarProxy` Cloud Function special-cases `?path=/slack/auth-test`** — handled locally inside the CF (server-side `fetch`, no CORS), NOT forwarded to the sidecar. Any Slack validation call from the web routes through this.

### Slack mention gotcha

Typing `@bot_name` in Slack only becomes a real mention if you **select it from the autocomplete dropdown**. Plain text `@bot_name` does NOT trigger `app_mention` events. If the bot isn't responding to channel mentions, check the log for `gateway/channels/slack` entries — no events = plain-text mention.

## Sidecar

Bun binary on the host (`sidecar/`). HTTP API for chat proxy, file ops, config read/PATCH, backups, process lifecycle.

**Auth:** Dual — static `SIDECAR_API_KEY` header (from the Cloud Function) + `X-User-Uid`/`X-User-Role`/`X-User-Name` user context. Patients restricted to `/chat` and `/healthz` only.

**Runs as root** under a systemd unit. `ExecStart=/root/{{SIDECAR_UNIT_NAME}}`, `WorkingDirectory=/root`, no explicit `User=`.

**Gateway lifecycle:** `sidecar/src/lib/process.ts` shells out to `/usr/bin/openclaw gateway {restart,start,stop}` with `HOME=/root` via `execSync`. **NOT** `systemctl restart openclaw-gateway` — the gateway unit is user-scope and direct system-scope `systemctl` throws `ShellError: exit 5`. The openclaw CLI wraps the right scope internally.

`getStatus()` derives `running`/`stopped` from `checkGatewayHealth()` (hitting `http://localhost:18789/healthz`).

**Deploy:** `cd sidecar && ./deploy.sh`. Edit the GCE constants inside the script for your host (`GCE_VM`, `GCE_ZONE`, `GCE_PROJECT`). A `TARGET=vultr ./deploy.sh` escape hatch is available for Vultr-based installs.

## Health checks

Everything goes through the `sidecarProxy` Cloud Function with an admin Firebase token — no SSH needed from the web.

**Via sidecar API:**
- `GET /healthz` — sidecar alive check
- `GET /status` — gateway process state + health
- `GET /stats` — memory, CPU, uptime, disk, gateway health

**Via web app:** `/admin/agent → Health` tab (green/red dot in sidebar reflects `/status`)

**Via CLI (direct SSH for debugging):**
```bash
SSH="ssh -i ~/.ssh/YOUR_KEY root@YOUR_VPS_IP"
$SSH "curl -s http://localhost:18789/healthz"   # Gateway (loopback)
$SSH "curl -s http://localhost:8081/healthz"    # Sidecar
$SSH "sudo su -l -c 'openclaw agents list' | grep -v '^\[plugins\]'"
$SSH "sudo systemctl restart {{SIDECAR_UNIT_NAME}}"
$SSH "sudo su -l -c 'openclaw gateway restart'"
$SSH "sudo tail -200 /tmp/openclaw/openclaw-\$(date +%Y-%m-%d).log | grep gateway/channels/slack"
```

## Key files on the host

- `/root/.openclaw/openclaw.json` — gateway config, agent routing bindings, channel tokens
- `/root/.openclaw/workspace/SOUL.md` — admin agent instructions
- `/root/.openclaw/agents/patient-support/workspace/SOUL.md` — patient-support instructions (**keep ≤ 5 KB**; large system prompts get ignored)
- `/root/.openclaw/agents/patient-support/workspace/AGENTS.md` — must have `## Session Startup` and `## Red Lines` H2 sections (OpenClaw re-injects these after context compaction; without them, instructions get summarized away)
- `/root/.openclaw/agents/patient-support/workspace/TOOLS.md` — must NOT contain API endpoint docs (contradicts the "no data access" rule and causes the model to ignore SOUL.md)
- `/root/.openclaw/extensions/web-chat/index.ts` — web-chat plugin (patched for agent-scoped routing)

Repo mirror of the workspace lives in the `openclaw/` directory with `{{PLACEHOLDER}}` tokens — fill these in per customer before shipping:

- `{{PRACTICE_NAME}}`, `{{LEGAL_ENTITY}}`, `{{DOMAIN}}`
- `{{SUPPORT_EMAIL}}`, `{{SUPPORT_PHONE}}`, `{{ADDRESS}}`, `{{HOURS}}`
- `{{ADMIN_AGENT_NAME}}`, `{{PATIENT_AGENT_NAME}}`
- `{{PRIMARY_CONTACT_NAME}}`, `{{PRIMARY_CONTACT_EMAIL}}`

Rewrite these tokens in:
- `openclaw/workspace/*.md`
- `openclaw/agents/patient-support/workspace/*.md`
- `openclaw/openclaw.json`

## Session management

Patient-support sessions persist in `/root/.openclaw/agents/patient-support/sessions/*.jsonl` — **gateway restart does NOT clear them**.

To reset after changing SOUL.md:
```bash
$SSH "rm /root/.openclaw/agents/patient-support/sessions/*.jsonl && echo '{}' > /root/.openclaw/agents/patient-support/sessions/sessions.json"
$SSH "sudo su -l -c 'openclaw gateway restart'"
```

## No PHI on the host (design constraint)

Patient Firebase tokens are **NOT** forwarded to the sidecar for patient-facing calls. The patient agent cannot access any patient data API. Even if the host is HIPAA-safe (e.g., GCE under a BAA), keeping the patient agent architecturally cut off from patient data is preserved for defense in depth. The patient agent's `TOOLS.md` must explicitly say "no tools, no API" to keep it in practice-navigator mode.

## Host bring-up gotchas

- `vultr-setup.sh` (if using Vultr) installs `qmd` (wrong) instead of `@tobilu/qmd`. Use `bun install -g @tobilu/qmd`.
- Debian 12 default image lacks `dbus-user-session` — without it, `systemctl --user` can't talk to root's user systemd and `openclaw gateway install` fails with `Transport endpoint is not connected`. `apt-get install dbus-user-session && systemctl restart user@0.service`.
- `lsof` is not installed on Debian 12 by default — OpenClaw uses it to scan for stale processes on port 18789. `apt-get install lsof`.
- Root linger is required: `loginctl enable-linger root`.
- WhatsApp channel can't run on two hosts simultaneously — fights for the session with `status=440`. During parallel runs, disable on the non-primary via `channels.whatsapp.enabled = false`.
- `memory.backend = "none"` is invalid — only `"builtin"` or `"qmd"`.

## Platform token budget — pending OpenClaw hook

The platform subscription feature tracks per-month token usage and falls back
to the economy model (default `gpt-4.1-mini`) when the practice has
exhausted its monthly allowance + bonus top-ups. Enforcement lives in the
sidecar: `sidecar/src/routes/chat.ts` reads budget state from the
`platform/*` Firestore docs, injects an **`X-Model-Override`** request
header on the gateway call when over budget, and records usage
fire-and-forget after each reply.

Two OpenClaw-side hooks are required for this to work end-to-end. Both are
optional for shipping the feature — without them the sidecar falls back to
a char/4 token estimate and the override header is a no-op — but they're
necessary for accurate accounting and real model fallback:

1. **Honor `X-Model-Override` on the web-chat webhook.** When present and
   non-empty, OpenClaw should treat its value as the effective model id for
   that single turn, overriding the agent's configured model.
2. **Surface `usage` in the web-chat JSON response.** Current response shape
   is `{ reply: string }`; the sidecar additionally reads a `usage` object
   of shape `{ inputTokens, outputTokens, model }` when present and uses
   those numbers instead of estimating.

Until these land in OpenClaw, monitoring remains approximate (char/4
estimation) and the "fall back to economy model" step is a no-op — but the
admin UI, subscription lifecycle, and top-up flow are fully functional.

## OpenClaw update

`./scripts/openclaw-update.sh [tag]` — creates a backup on the host, uploads to GCS, runs `openclaw update`. `--dry-run` to preview. **Always recompile the web-chat plugin after an update** (it's patched for agent-scoped routing).
