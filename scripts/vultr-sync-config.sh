#!/bin/bash
# Sync OpenClaw config from Vultr to local git (redacted)
# Usage: ./scripts/vultr-sync-config.sh

set -e

SSH_KEY="$HOME/.ssh/vps-key"
HOST="root@YOUR_VPS_IP"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/vultr-config"

mkdir -p "$CONFIG_DIR"

echo "=== Syncing config from Vultr ==="

ssh -i "$SSH_KEY" "$HOST" "cat /root/.openclaw/openclaw.json" > "$CONFIG_DIR/openclaw.json"
ssh -i "$SSH_KEY" "$HOST" "cat /etc/systemd/system/patient-sidecar.service" > "$CONFIG_DIR/patient-sidecar.service"
ssh -i "$SSH_KEY" "$HOST" "cat /root/sidecar.env" > "$CONFIG_DIR/sidecar.env.example"
ssh -i "$SSH_KEY" "$HOST" "ufw status verbose" > "$CONFIG_DIR/firewall.txt"
ssh -i "$SSH_KEY" "$HOST" "openclaw plugins list 2>/dev/null" > "$CONFIG_DIR/plugins.txt" || true

echo "=== Redacting secrets ==="
python3 -c "
import json
with open('$CONFIG_DIR/openclaw.json') as f:
    cfg = json.load(f)
if 'gateway' in cfg and 'auth' in cfg['gateway']:
    cfg['gateway']['auth']['token'] = '<REDACTED>'
if 'channels' in cfg and 'web-chat' in cfg['channels']:
    if 'webhookSecret' in cfg['channels']['web-chat']:
        cfg['channels']['web-chat']['webhookSecret'] = '<REDACTED>'
# Redact any credential profiles
if 'auth' in cfg and 'profiles' in cfg['auth']:
    for k in cfg['auth']['profiles']:
        p = cfg['auth']['profiles'][k]
        if 'token' in p: p['token'] = '<REDACTED>'
        if 'apiKey' in p: p['apiKey'] = '<REDACTED>'
with open('$CONFIG_DIR/openclaw.json', 'w') as f:
    json.dump(cfg, f, indent=2)
"

sed -i '' 's/SIDECAR_API_KEY=.*/SIDECAR_API_KEY=<REDACTED>/' "$CONFIG_DIR/sidecar.env.example"

echo "=== Synced to $CONFIG_DIR ==="
ls -la "$CONFIG_DIR/"
