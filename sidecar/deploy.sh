#!/usr/bin/env bash
set -euo pipefail

# Deploy showmd-sidecar to the primary OpenClaw host.
#
# Primary host (as of 2026-04-11) is the GCE VM `openclaw` in us-central1-a
# under project showmd-patient. Vultr (149.28.89.89) is still running as hot
# standby — to deploy there instead, set TARGET=vultr.
#
# Usage:
#   ./deploy.sh               # deploy to GCE (default)
#   TARGET=vultr ./deploy.sh  # deploy to Vultr standby

TARGET="${TARGET:-gce}"
REMOTE_BIN="/root/showmd-sidecar"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Building sidecar binary..."
cd "$SCRIPT_DIR"
bun run build

if [[ "$TARGET" == "gce" ]]; then
  GCE_VM="openclaw"
  GCE_ZONE="us-central1-a"
  GCE_PROJECT="showmd-patient"
  SSH="gcloud compute ssh $GCE_VM --zone=$GCE_ZONE --project=$GCE_PROJECT --command"

  echo "==> Uploading binary to GCE..."
  gcloud compute scp "$SCRIPT_DIR/showmd-sidecar" \
    "$GCE_VM:/tmp/showmd-sidecar.new" \
    --zone="$GCE_ZONE" --project="$GCE_PROJECT"

  echo "==> Stopping remote sidecar..."
  $SSH "sudo systemctl stop showmd-sidecar"

  echo "==> Moving binary into place..."
  $SSH "sudo mv /tmp/showmd-sidecar.new $REMOTE_BIN && sudo chmod +x $REMOTE_BIN"

  echo "==> Starting remote sidecar..."
  $SSH "sudo systemctl start showmd-sidecar"

  echo "==> Verifying health..."
  sleep 2
  HEALTH=$($SSH "curl -sf http://localhost:8081/healthz")
elif [[ "$TARGET" == "vultr" ]]; then
  SSH_KEY="${SSH_KEY:-$HOME/.ssh/vultr-showmd-rsa}"
  HOST="root@149.28.89.89"

  echo "==> Stopping remote sidecar (Vultr)..."
  ssh -i "$SSH_KEY" "$HOST" "systemctl stop showmd-sidecar"

  echo "==> Uploading binary..."
  scp -i "$SSH_KEY" "$SCRIPT_DIR/showmd-sidecar" "$HOST:$REMOTE_BIN"

  echo "==> Starting remote sidecar..."
  ssh -i "$SSH_KEY" "$HOST" "chmod +x $REMOTE_BIN && systemctl start showmd-sidecar"

  echo "==> Verifying health..."
  sleep 1
  HEALTH=$(ssh -i "$SSH_KEY" "$HOST" "curl -sf http://localhost:8081/healthz")
else
  echo "Unknown TARGET: $TARGET (expected 'gce' or 'vultr')" >&2
  exit 1
fi

echo "$HEALTH"

if echo "$HEALTH" | grep -q '"ok":true'; then
  echo "==> Deploy successful!"
else
  echo "==> WARNING: Health check failed"
  exit 1
fi
