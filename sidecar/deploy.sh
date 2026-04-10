#!/usr/bin/env bash
set -euo pipefail

# Deploy patient-sidecar to Vultr VPS
# Usage: ./deploy.sh

SSH_KEY="${SSH_KEY:-$HOME/.ssh/vps-key}"
HOST="root@YOUR_VPS_IP"
REMOTE_BIN="/root/patient-sidecar"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Building sidecar binary..."
cd "$SCRIPT_DIR"
bun run build

echo "==> Stopping remote sidecar..."
ssh -i "$SSH_KEY" "$HOST" "systemctl stop patient-sidecar"

echo "==> Uploading binary..."
scp -i "$SSH_KEY" "$SCRIPT_DIR/patient-sidecar" "$HOST:$REMOTE_BIN"

echo "==> Starting remote sidecar..."
ssh -i "$SSH_KEY" "$HOST" "chmod +x $REMOTE_BIN && systemctl start patient-sidecar"

echo "==> Verifying health..."
sleep 1
HEALTH=$(ssh -i "$SSH_KEY" "$HOST" "curl -sf http://localhost:8081/healthz")
echo "$HEALTH"

if echo "$HEALTH" | grep -q '"ok":true'; then
  echo "==> Deploy successful!"
else
  echo "==> WARNING: Health check failed"
  exit 1
fi
