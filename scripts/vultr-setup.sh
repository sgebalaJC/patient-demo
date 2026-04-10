#!/bin/bash
# Full Vultr VPS setup from scratch
# Usage: ./scripts/vultr-setup.sh <IP> <SSH_KEY_PATH>
# Example: ./scripts/vultr-setup.sh YOUR_VPS_IP ~/.ssh/vps-key
#
# Prerequisites:
#   - Fresh Debian 12+ VPS (x86_64)
#   - SSH key access as root
#   - Kitt project at ~/Projects/kitt/ (for web-chat plugin)
#   - Sidecar binary built locally (run deploy-sidecar.sh first to build)
#
# What this script does:
#   1. Installs Node.js 22, Bun, OpenClaw, QMD
#   2. Configures OpenClaw with web-chat extension
#   3. Deploys the sidecar binary + systemd service
#   4. Configures firewall (SSH + sidecar port)
#   5. Starts all services
#
# After this script, run these manually (see openclaw/README.md):
#   - Phase 2: Upload openclaw.json + set secrets
#   - Phase 3: Upload agent workspaces
#   - Phase 5: Install gog CLI + upload SA key
#   - Phase 6: ./scripts/vultr-setup-qmd.sh
#   - Phase 8: Update functions/.env + web/.env, deploy

set -e

IP="${1:?Usage: $0 <IP> <SSH_KEY_PATH>}"
SSH_KEY="${2:-$HOME/.ssh/vps-key}"
HOST="root@$IP"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Vultr VPS Setup: $IP ==="

# Generate secrets
SIDECAR_API_KEY=$(openssl rand -hex 32)
GATEWAY_TOKEN=$(openssl rand -hex 24)

echo "Generated secrets:"
echo "  SIDECAR_API_KEY: $SIDECAR_API_KEY"
echo "  GATEWAY_TOKEN:   $GATEWAY_TOKEN"
echo ""
echo "IMPORTANT: Save these! Update functions/.env and web/.env with the new values."
echo ""

ssh -i "$SSH_KEY" "$HOST" bash << REMOTE_SCRIPT
set -e

echo "--- Installing system packages ---"
apt-get update && apt-get install -y curl git build-essential sqlite3

echo "--- Installing Node.js 22 ---"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "--- Installing Bun ---"
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="\$HOME/.bun"
export PATH="\$BUN_INSTALL/bin:\$PATH"

echo "--- Installing OpenClaw ---"
npm install -g openclaw

echo "--- Running OpenClaw onboard ---"
openclaw onboard --non-interactive 2>/dev/null || true

echo "--- Installing QMD ---"
bun install -g qmd

echo "--- Installing web-chat extension ---"
mkdir -p /root/web-chat-ext
REMOTE_SCRIPT

echo "=== Uploading web-chat extension ==="
scp -i "$SSH_KEY" -r "$PROJECT_DIR/sidecar/src/../" "$HOST:/tmp/sidecar-src" 2>/dev/null || true

# Upload web-chat extension from kitt if available
WEBCHAT_SRC="$HOME/Projects/kitt/extensions/web-chat"
if [ -d "$WEBCHAT_SRC" ]; then
  scp -i "$SSH_KEY" -r "$WEBCHAT_SRC" "$HOST:/root/web-chat-ext"
  ssh -i "$SSH_KEY" "$HOST" "openclaw plugins install /root/web-chat-ext && openclaw plugins enable web-chat"
else
  echo "WARNING: Kitt web-chat extension not found at $WEBCHAT_SRC"
  echo "You'll need to install it manually: openclaw plugins install /path/to/web-chat"
fi

echo "=== Configuring OpenClaw ==="
ssh -i "$SSH_KEY" "$HOST" bash << REMOTE_CONFIG
set -e

# Set gateway token and web-chat config
python3 -c "
import json
with open('/root/.openclaw/openclaw.json') as f:
    cfg = json.load(f)
cfg.setdefault('gateway', {}).setdefault('auth', {})['token'] = '$GATEWAY_TOKEN'
cfg.setdefault('channels', {})['web-chat'] = {
    'webhookSecret': '$GATEWAY_TOKEN',
    'enabled': True
}
with open('/root/.openclaw/openclaw.json', 'w') as f:
    json.dump(cfg, f, indent=2)
print('OpenClaw config updated')
"

# Restart gateway
openclaw gateway restart 2>/dev/null || true

# Create sidecar env
cat > /root/sidecar.env << EOF
SIDECAR_API_KEY=$SIDECAR_API_KEY
PORT=8081
WORKSPACE_DIR=/root/workspace
EOF

# Create directories
mkdir -p /root/workspace /root/backups /root/workspace/skills

# Create systemd service for sidecar
cat > /etc/systemd/system/patient-sidecar.service << EOF
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

systemctl daemon-reload
systemctl enable patient-sidecar

# Firewall
ufw allow 22/tcp
ufw allow 8081/tcp
ufw --force enable
ufw reload

echo "VPS configuration complete"
REMOTE_CONFIG

echo "=== Deploying sidecar binary ==="
cd "$PROJECT_DIR/sidecar"
if [ -f patient-sidecar ]; then
  scp -i "$SSH_KEY" patient-sidecar "$HOST:/root/patient-sidecar"
  ssh -i "$SSH_KEY" "$HOST" "chmod +x /root/patient-sidecar && systemctl start patient-sidecar"
else
  echo "WARNING: Sidecar binary not found. Run: cd sidecar && bun build src/index.ts --compile --outfile patient-sidecar --target=bun-linux-x64"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Services:"
ssh -i "$SSH_KEY" "$HOST" "systemctl status patient-sidecar --no-pager | head -3; echo '---'; ss -tlnp | grep -E '8081|18789'"
echo ""
echo "Next steps:"
echo "  1. Update functions/.env:"
echo "     SIDECAR_URL=http://$IP:8081"
echo "     SIDECAR_API_KEY=$SIDECAR_API_KEY"
echo "  2. Update web/.env:"
echo "     VITE_SIDECAR_PROXY_URL=https://us-central1-YOUR_FIREBASE_PROJECT.cloudfunctions.net/sidecarProxy"
echo "     VITE_AGENT_GATEWAY_TOKEN=$GATEWAY_TOKEN"
echo "  3. Deploy functions: ./scripts/deploy-functions.sh"
echo "  4. Test: curl http://$IP:8081/healthz"
