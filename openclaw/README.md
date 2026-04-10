# OpenClaw on Vultr — Full Environment Guide

Source of truth for the OpenClaw agent setup on Vultr VPS (`YOUR_VPS_IP`).

## Current Environment

| Component | Version | Install Method |
|-----------|---------|----------------|
| OS | Debian 12 (bookworm) | Vultr image |
| Node.js | 22.x | NodeSource apt |
| Bun | 1.3.x | curl install |
| OpenClaw | 2026.3.22 | `npm install -g openclaw` |
| QMD | 2.0.1 | `bun install -g qmd` |
| gog CLI | 0.12.0 | Binary release |
| Sidecar | Custom | Bun-compiled binary |

## Directory Structure

```
/root/
├── .openclaw/
│   ├── openclaw.json                              # Gateway config
│   ├── workspace/                                 # Admin agent (id: main) — customize via SOUL.md placeholders
│   │   ├── SOUL.md                                # Core personality and rules
│   │   ├── IDENTITY.md, USER.md, AGENTS.md        # Agent identity files
│   │   ├── TOOLS.md, HEARTBEAT.md                 # Tool & heartbeat config
│   │   ├── MEMORY.md                              # Long-term curated memory index
│   │   ├── memory/                                # Daily session logs (auto-generated)
│   │   ├── uploads/                               # Media from WhatsApp/web-chat
│   │   └── skills/
│   │       ├── calendar/SKILL.md                  # Google Calendar via gog
│   │       ├── gmail/SKILL.md                     # Gmail via gog
│   │       └── drive/SKILL.md                     # Google Drive via gog
│   ├── agents/
│   │   ├── main/
│   │   │   ├── agent/                             # Auth profiles, model config
│   │   │   ├── sessions/                          # JSONL session transcripts
│   │   │   └── qmd/                               # QMD index data
│   │   │       ├── xdg-config/
│   │   │       └── xdg-cache/                     # Embedding model (~330MB)
│   │   └── patient-support/
│   │       ├── agent/                             # Auth profiles, model config
│   │       ├── workspace/                         # Patient-support agent workspace
│   │       │   ├── SOUL.md                        # Patient support rules
│   │       │   ├── IDENTITY.md, USER.md, etc.     # Agent identity files
│   │       │   └── memory/                        # Session logs
│   │       ├── sessions/                          # JSONL session transcripts
│   │       └── qmd/                               # QMD index data
│   ├── credentials/
│   │   ├── google-sa-key.json                     # Google SA key (from Firebase secrets)
│   │   └── whatsapp/default/                      # WhatsApp auth state (creds.json + keys)
│   ├── extensions/
│   │   └── web-chat/                              # Web-chat plugin (from Kitt project)
│   ├── canvas/                                    # Built-in canvas UI
│   └── completions/                               # Shell completions
├── patient-sidecar                                 # Compiled sidecar binary
├── sidecar.env                                    # SIDECAR_API_KEY, PORT, WORKSPACE_DIR
├── web-chat/                                      # web-chat plugin source
└── .bun/bin/                                      # Bun-installed binaries (qmd, etc.)
```

## Ports & Services

| Service | Port | Binding | Auth | Systemd Unit |
|---------|------|---------|------|-------------|
| SSH | 22 | 0.0.0.0 | Key only | sshd |
| Sidecar API | 8081 | 0.0.0.0 | Bearer token | patient-sidecar.service |
| OpenClaw Gateway | 18789 | localhost | Token | openclaw-gateway.service |

Firewall (ufw): only ports 22 and 8081 open.

---

## Full Environment Restore (bare Debian 12)

### Prerequisites (local machine)

- SSH key: `~/.ssh/vps-key`
- This repo checked out
- Kitt project at `~/Projects/kitt/` (for web-chat plugin)
- Bun installed locally (for sidecar build)
- Firebase CLI (`npm install -g firebase-tools`, logged in to `YOUR_FIREBASE_PROJECT`)

### Phase 1: Base System + OpenClaw + Sidecar

```bash
# One-shot setup: installs Node.js, Bun, OpenClaw, sidecar, firewall
./scripts/vultr-setup.sh <VPS_IP> ~/.ssh/vps-key
```

**SAVE the output** — it prints `SIDECAR_API_KEY` and `GATEWAY_TOKEN` needed later.

If running manually:

```bash
SSH="ssh -i ~/.ssh/vps-key root@<VPS_IP>"

# System packages
$SSH "apt-get update && apt-get install -y curl git build-essential sqlite3"

# Node.js 22 (for OpenClaw)
$SSH "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"

# Bun (for QMD and sidecar)
$SSH 'curl -fsSL https://bun.sh/install | bash'
# Note: adds BUN_INSTALL to ~/.bashrc, source it or reconnect

# OpenClaw
$SSH "npm install -g openclaw"
$SSH "openclaw onboard --non-interactive"

# Sidecar binary (build locally, upload)
cd sidecar && bun build src/index.ts --compile --outfile patient-sidecar --target=bun-linux-x64
scp -i ~/.ssh/vps-key patient-sidecar root@<VPS_IP>:/root/patient-sidecar
$SSH "chmod +x /root/patient-sidecar"

# Sidecar environment
SIDECAR_API_KEY=$(openssl rand -hex 32)
$SSH "cat > /root/sidecar.env << EOF
SIDECAR_API_KEY=$SIDECAR_API_KEY
PORT=8081
WORKSPACE_DIR=/root/workspace
EOF"

# Sidecar systemd service
$SSH 'cat > /etc/systemd/system/patient-sidecar.service << EOF
[Unit]
Description=Patient Portal Sidecar API
After=network.target

[Service]
Type=simple
EnvironmentFile=/root/sidecar.env
ExecStart=/root/patient-sidecar
WorkingDirectory=/root
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now patient-sidecar'

# Firewall
$SSH "ufw allow 22/tcp && ufw allow 8081/tcp && ufw --force enable"
```

### Phase 2: OpenClaw Configuration

```bash
SSH="ssh -i ~/.ssh/vps-key root@<VPS_IP>"

# Upload gateway config (has secrets redacted — we'll set them next)
scp -i ~/.ssh/vps-key openclaw/openclaw.json root@<VPS_IP>:/root/.openclaw/openclaw.json

# Set gateway auth token
GATEWAY_TOKEN=$(openssl rand -hex 24)
$SSH "python3 -c \"
import json
with open('/root/.openclaw/openclaw.json') as f:
    cfg = json.load(f)
cfg['gateway']['auth']['token'] = '$GATEWAY_TOKEN'
cfg['channels']['web-chat']['webhookSecret'] = '$GATEWAY_TOKEN'
with open('/root/.openclaw/openclaw.json', 'w') as f:
    json.dump(cfg, f, indent=2)
\""
```

### Phase 3: Agent Workspaces

```bash
# Admin agent (main)
scp -r -i ~/.ssh/vps-key openclaw/workspace/ root@<VPS_IP>:/root/.openclaw/workspace/

# Patient-support agent
$SSH "mkdir -p /root/.openclaw/agents/patient-support/workspace"
scp -r -i ~/.ssh/vps-key openclaw/agents/patient-support/workspace/ \
  root@<VPS_IP>:/root/.openclaw/agents/patient-support/workspace/
```

### Phase 4: Web-Chat Plugin

The web-chat plugin source lives in the Kitt project. On a bare VPS (no Docker), it must be **compiled to JS** after installation — OpenClaw's TS plugin loader cannot resolve package.json `exports` subpaths from raw `.ts` files.

```bash
# Copy from kitt project
scp -r -i ~/.ssh/vps-key ~/Projects/kitt/extensions/web-chat root@<VPS_IP>:/root/web-chat

# Install and enable
$SSH "openclaw plugins install /root/web-chat && openclaw plugins enable web-chat"

# Compile the plugin (REQUIRED — raw .ts won't load on v2026.3.22+)
./scripts/vultr-compile-webchat.sh
```

**What `vultr-compile-webchat.sh` does:**
1. Migrates imports from `openclaw/plugin-sdk/compat` → scoped paths (`core`, `runtime-store`)
2. Compiles `.ts` → `.js` with esbuild (openclaw/* kept as externals)
3. Creates ESM shim files in `node_modules/openclaw/plugin-sdk/` that re-export from the global dist
4. Updates `package.json` extensions entry to point to `.js`

This must be re-run after every OpenClaw update (the `openclaw-update.sh` script does this automatically).

### Phase 5: Google Workspace (gog CLI)

```bash
# Install gog CLI
$SSH "curl -sL 'https://github.com/steipete/gogcli/releases/download/v0.12.0/gogcli_0.12.0_linux_amd64.tar.gz' | tar xz -C /usr/local/bin"

# Upload SA key from Firebase secrets
firebase functions:secrets:access GOOGLE_SA_KEY --project YOUR_FIREBASE_PROJECT > /tmp/sa-key.json
$SSH "mkdir -p /root/.openclaw/credentials"
scp -i ~/.ssh/vps-key /tmp/sa-key.json root@<VPS_IP>:/root/.openclaw/credentials/google-sa-key.json
rm /tmp/sa-key.json

# Configure gog for each workspace account
$SSH "gog auth service-account set --key=/root/.openclaw/credentials/google-sa-key.json admin@example.com"
$SSH "gog auth service-account set --key=/root/.openclaw/credentials/google-sa-key.json admin@example.com"

# Verify
$SSH "gog auth list"
$SSH "gog gmail search 'newer_than:1d' --max 3 --account admin@example.com --json"
```

### Phase 6: QMD Memory

```bash
# Full QMD setup (install binary, create collections, index, embed, restart gateway)
./scripts/vultr-setup-qmd.sh
```

Or manually:

```bash
# Install QMD
$SSH "source ~/.bashrc && bun install -g qmd"

# For each agent: create collection, index, embed
for agent_id in main patient-support; do
  if [ "$agent_id" = "main" ]; then
    workspace="/root/.openclaw/workspace"
  else
    workspace="/root/.openclaw/agents/$agent_id/workspace"
  fi

  $SSH "
    export XDG_CONFIG_HOME=/root/.openclaw/agents/$agent_id/qmd/xdg-config
    export XDG_CACHE_HOME=/root/.openclaw/agents/$agent_id/qmd/xdg-cache
    mkdir -p \$XDG_CONFIG_HOME \$XDG_CACHE_HOME
    qmd collection add $workspace --name memory-root --pattern '**/*.md'
    qmd update
    qmd embed
  "
done
```

First run downloads a ~330MB GGUF embedding model. Takes ~2 min on CPU.

### Phase 7: Start Gateway

```bash
$SSH "openclaw gateway restart"
sleep 2
$SSH "curl -sf http://localhost:18789/health"
```

### Phase 8: Firebase Integration

Update local env files with the new VPS secrets:

**`functions/.env`:**
```
SIDECAR_URL=http://<VPS_IP>:8081
SIDECAR_API_KEY=<from Phase 1>
```

**`web/.env`:**
```
VITE_SIDECAR_PROXY_URL=https://us-central1-YOUR_FIREBASE_PROJECT.cloudfunctions.net/sidecarProxy
VITE_AGENT_GATEWAY_TOKEN=<from Phase 2>
```

Deploy:
```bash
./scripts/deploy-functions.sh
./scripts/deploy-rules.sh
./scripts/deploy-web.sh
```

### Phase 9: Verify Everything

```bash
SSH="ssh -i ~/.ssh/vps-key root@<VPS_IP>"

# Sidecar
curl -s http://<VPS_IP>:8081/healthz
# → {"ok":true}

# Gateway
$SSH "curl -sf http://localhost:18789/health"
# → {"ok":true,"status":"live"}

# Agents
$SSH "openclaw agents list 2>&1 | grep -v '^\[plugins\]'"

# QMD search test
$SSH 'XDG_CONFIG_HOME=/root/.openclaw/agents/main/qmd/xdg-config XDG_CACHE_HOME=/root/.openclaw/agents/main/qmd/xdg-cache qmd search "test" --json | head -5'

# gog CLI
$SSH "gog auth list"

# Web frontend
curl -s -o /dev/null -w '%{http_code}' https://patient.example.com
# → 200
```

---

## Updating OpenClaw

**Always use the update script** — it creates a backup, updates, recompiles the web-chat plugin, and verifies:

```bash
./scripts/openclaw-update.sh                    # update to latest
./scripts/openclaw-update.sh v2026.3.24         # specific version
./scripts/openclaw-update.sh --dry-run          # preview
```

**Manual update (if needed):**
```bash
SSH="ssh -i ~/.ssh/vps-key root@YOUR_VPS_IP"

# Update
$SSH "npm install -g openclaw@latest"

# Recompile web-chat plugin (CRITICAL — skip = chat breaks)
./scripts/vultr-compile-webchat.sh

# Restart gateway
$SSH "openclaw gateway restart"

# Verify: plugin should show "registered" not "failed to load"
$SSH "grep 'web-chat' /tmp/openclaw/openclaw-\$(date +%Y-%m-%d).log | tail -3"

# Test chat
$SSH 'curl -sf -X POST http://localhost:8081/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat /root/sidecar.env | grep SIDECAR_API_KEY | cut -d= -f2)" \
  -H "X-User-Role: patient" -H "X-Account-Id: patient" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}"'
```

**Why the compile step is needed:** OpenClaw's plugin loader on bare VPS loads `.ts` files but cannot resolve Node `package.json` `exports` subpaths (e.g., `openclaw/plugin-sdk/core`). Kitt solves this with a Docker build step. We solve it by compiling to `.js` and creating ESM shim files that use absolute paths to the global dist. See `scripts/vultr-compile-webchat.sh` for details.

**If chat breaks after update:** Re-run `./scripts/vultr-compile-webchat.sh` and restart. If the SDK export paths changed, check `ls /usr/lib/node_modules/openclaw/dist/plugin-sdk/*.js` for updated module names.

---

## Quick Sync Commands

```bash
# Sync full admin workspace
scp -r -i ~/.ssh/vps-key openclaw/workspace/ \
  root@YOUR_VPS_IP:/root/.openclaw/workspace/

# Sync skills only
scp -r -i ~/.ssh/vps-key openclaw/workspace/skills/ \
  root@YOUR_VPS_IP:/root/.openclaw/workspace/skills/

# Sync patient-support SOUL.md
scp -i ~/.ssh/vps-key openclaw/agents/patient-support/workspace/SOUL.md \
  root@YOUR_VPS_IP:/root/.openclaw/agents/patient-support/workspace/SOUL.md

# Re-index QMD after memory changes
./scripts/vultr-setup-qmd.sh --warm-only

# Redeploy sidecar
./scripts/deploy-sidecar.sh

# Pull latest workspace state from VPS to repo
./scripts/vultr-pull-openclaw.sh
```

## Google Workspace (gog CLI)

- **SA client ID:** `110721822760423884027`
- **SA email:** `1024582536287-compute@developer.gserviceaccount.com`
- **Configured accounts:** `admin@example.com`, `admin@example.com` (any @example.com works)
- **GCP project:** `YOUR_FIREBASE_PROJECT`
- **GCP APIs required:** Gmail API, Google Calendar API, Google Drive API

**Domain-wide delegation (Google Workspace Admin Console > Security > API controls):**
- App name: {{PRACTICE_NAME}}
- Client ID: `110721822760423884027`
- Scopes (6):
  - `https://www.googleapis.com/auth/calendar`
  - `https://www.googleapis.com/auth/gmail.modify`
  - `https://www.googleapis.com/auth/gmail.settings.basic`
  - `https://www.googleapis.com/auth/gmail.settings.sharing`
  - `https://www.googleapis.com/auth/drive`
  - `https://www.googleapis.com/auth/drive.file`

## QMD Memory

**Config (`openclaw.json` → `memory`):**
```json
{
  "backend": "qmd",
  "citations": "auto",
  "qmd": {
    "includeDefaultMemory": true,
    "update": { "interval": "5m" },
    "limits": { "maxResults": 6, "timeoutMs": 4000 }
  }
}
```

The gateway auto-refreshes every 5 minutes. If QMD fails, it falls back to the built-in SQLite engine.

**Manual QMD commands (on VPS):**
```bash
# Set env for an agent (main or patient-support)
export XDG_CONFIG_HOME=/root/.openclaw/agents/main/qmd/xdg-config
export XDG_CACHE_HOME=/root/.openclaw/agents/main/qmd/xdg-cache

qmd collection list          # Show collections
qmd update                   # Refresh BM25 index
qmd embed                    # Refresh vector embeddings
qmd search "query" --json    # Test search
qmd status                   # Check QMD health
```

## Cloud Functions Environment

**Secrets (Firebase Secret Manager):**
- `GOOGLE_SA_KEY` — Service account JSON key

**Environment vars (`functions/.env`):**
- `GOOGLE_CALENDAR_ID` — practice calendar ID
- `GOOGLE_CALENDAR_SUBJECT` — Workspace user for calendar impersonation
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — SMS
- `SIDECAR_URL` — `http://<VPS_IP>:8081`
- `SIDECAR_API_KEY` — Generated during VPS setup
- `TZ` — `America/Los_Angeles`

## Health Checks

**Via CLI (quick):**
```bash
./scripts/vultr-ssh.sh "curl -sf http://localhost:18789/health && curl -sf http://localhost:8081/healthz"
```

**Via web app:** Admin dashboard → AI Agent page → status indicator

**Full diagnostic:**
```bash
SSH="ssh -i ~/.ssh/vps-key root@YOUR_VPS_IP"
$SSH "curl -sf http://localhost:18789/health"     # Gateway
$SSH "curl -sf http://localhost:8081/healthz"      # Sidecar
$SSH "curl -sf http://localhost:8081/status"        # Sidecar + gateway state
$SSH "openclaw agents list 2>&1 | grep -v '^\[plugins\]'"
$SSH "systemctl status patient-sidecar --no-pager | head -5"
```

## Notes

- `openclaw.json` has secrets redacted in this repo — set via `openclaw configure` or the Python snippet in Phase 2
- The SA key lives in Firebase Secret Manager — **never commit it**
- Admin agent `memory/` files evolve — sync periodically with `./scripts/vultr-pull-openclaw.sh`
- Web-chat plugin source is in the Kitt project (`~/Projects/kitt/extensions/web-chat`), not this repo
- Web-chat plugin must be **compiled to JS** after install or OpenClaw update — see Phase 4 and "Updating OpenClaw"
- The `BOOTSTRAP.md` file is only used on first OpenClaw run
- QMD runs on CPU (no GPU on Vultr) — embedding is slow (~2 min) but search is fast
- QMD auto-refreshes every 5 min; run `./scripts/vultr-setup-qmd.sh --warm-only` after bulk memory changes
- WhatsApp credentials in `/root/.openclaw/credentials/whatsapp/` are device-paired — must re-pair on new instance via `openclaw whatsapp pair`
