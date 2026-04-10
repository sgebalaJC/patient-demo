#!/bin/bash
# Deploy the sidecar binary to Vultr VPS
# Usage: ./scripts/deploy-sidecar.sh

set -e

SSH_KEY="$HOME/.ssh/vps-key"
HOST="root@YOUR_VPS_IP"
SIDECAR_DIR="$(dirname "$0")/../sidecar"

echo "=== Building sidecar binary ==="
cd "$SIDECAR_DIR"
bun build src/index.ts --compile --outfile patient-sidecar --target=bun-linux-x64

echo "=== Stopping remote service ==="
ssh -i "$SSH_KEY" "$HOST" "systemctl stop patient-sidecar"

echo "=== Uploading binary ==="
scp -i "$SSH_KEY" patient-sidecar "$HOST:/root/patient-sidecar"

echo "=== Starting remote service ==="
ssh -i "$SSH_KEY" "$HOST" "chmod +x /root/patient-sidecar && systemctl start patient-sidecar"

echo "=== Verifying ==="
sleep 2
ssh -i "$SSH_KEY" "$HOST" "systemctl status patient-sidecar --no-pager | head -5"
echo ""
curl -s "http://YOUR_VPS_IP:8081/healthz"
echo ""
echo "=== Done ==="
