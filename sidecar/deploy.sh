#!/usr/bin/env bash
set -euo pipefail

# Deploy patient-sidecar to the GCE VM.
#
# ★ Per-fork: update GCE_VM, GCE_ZONE, GCE_PROJECT for your instance.
#
# Usage:
#   ./deploy.sh

REMOTE_BIN="/root/patient-sidecar"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

GCE_VM="openclaw"                    # ★ your GCE VM name
GCE_ZONE="us-central1-a"            # ★ your GCE zone
GCE_PROJECT="patient-demo-project"   # ★ your GCP project
SSH="gcloud compute ssh $GCE_VM --zone=$GCE_ZONE --project=$GCE_PROJECT --command"

echo "==> Building sidecar binary..."
cd "$SCRIPT_DIR"
bun run build

echo "==> Uploading binary to GCE..."
gcloud compute scp "$SCRIPT_DIR/patient-sidecar" \
  "$GCE_VM:/tmp/patient-sidecar.new" \
  --zone="$GCE_ZONE" --project="$GCE_PROJECT"

echo "==> Stopping remote sidecar..."
$SSH "sudo systemctl stop patient-sidecar"

echo "==> Moving binary into place..."
$SSH "sudo mv /tmp/patient-sidecar.new $REMOTE_BIN && sudo chmod +x $REMOTE_BIN"

# Deploy CLI wrapper + skills if present
CLI_SCRIPT="$SCRIPT_DIR/../openclaw/scripts/admin-api"
if [ -f "$CLI_SCRIPT" ]; then
  echo "==> Deploying admin-api CLI..."
  gcloud compute scp "$CLI_SCRIPT" \
    "$GCE_VM:/usr/local/bin/admin-api" \
    --zone="$GCE_ZONE" --project="$GCE_PROJECT"
  $SSH "chmod +x /usr/local/bin/admin-api"
fi

SKILLS_DIR="$SCRIPT_DIR/../openclaw/workspace/skills"
if [ -d "$SKILLS_DIR" ]; then
  echo "==> Deploying skills..."
  for skill_dir in "$SKILLS_DIR"/*/; do
    skill_name=$(basename "$skill_dir")
    $SSH "mkdir -p /root/.openclaw/workspace/skills/$skill_name"
    gcloud compute scp "$skill_dir"SKILL.md \
      "$GCE_VM:/root/.openclaw/workspace/skills/$skill_name/SKILL.md" \
      --zone="$GCE_ZONE" --project="$GCE_PROJECT" 2>/dev/null || true
  done
fi

echo "==> Starting remote sidecar..."
$SSH "sudo systemctl start patient-sidecar"

echo "==> Verifying health..."
sleep 2
HEALTH=$($SSH "curl -sf http://localhost:8081/healthz")

echo "$HEALTH"

if echo "$HEALTH" | grep -q '"ok":true'; then
  echo "==> Deploy successful!"
else
  echo "==> WARNING: Health check failed"
  exit 1
fi
