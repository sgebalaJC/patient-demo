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

# Self-heal runtime deps for document/image pipelines. pdftoppm from
# poppler-utils (PDF→JPG), `convert` from imagemagick (PNG/WEBP/GIF→JPG),
# `file` detects real MIME type regardless of extension.
echo "==> Ensuring system deps on VM (poppler-utils, imagemagick, file)..."
$SSH "command -v pdftoppm >/dev/null && command -v convert >/dev/null && command -v file >/dev/null \
  || (sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq poppler-utils imagemagick file)"

echo "==> Uploading binary to GCE..."
gcloud compute scp "$SCRIPT_DIR/patient-sidecar" \
  "$GCE_VM:/tmp/patient-sidecar.new" \
  --zone="$GCE_ZONE" --project="$GCE_PROJECT"

echo "==> Stopping remote sidecar..."
$SSH "sudo systemctl stop patient-sidecar"

echo "==> Moving binary into place..."
$SSH "sudo mv /tmp/patient-sidecar.new $REMOTE_BIN && sudo chmod +x $REMOTE_BIN"

# Ensure SIDECAR_API_KEY is in the OpenClaw gateway environment so the CLI inherits it
echo "==> Provisioning CLI environment..."
$SSH "sudo bash -c '
  KEY=\$(grep SIDECAR_API_KEY /root/sidecar.env 2>/dev/null | cut -d= -f2)
  if [ -n \"\$KEY\" ]; then
    grep -q SIDECAR_API_KEY /root/.bashrc 2>/dev/null || echo \"export SIDECAR_API_KEY=\$KEY\" >> /root/.bashrc
    echo \"SIDECAR_API_KEY set in .bashrc\"
  else
    echo \"WARNING: SIDECAR_API_KEY not found in /root/sidecar.env\"
  fi
'"

# Deploy CLI wrapper + skills if present
CLI_SCRIPT="$SCRIPT_DIR/../openclaw/scripts/admin-api"
if [ -f "$CLI_SCRIPT" ]; then
  echo "==> Deploying admin-api CLI..."
  gcloud compute scp "$CLI_SCRIPT" \
    "$GCE_VM:/tmp/admin-api-cli" \
    --zone="$GCE_ZONE" --project="$GCE_PROJECT"
  $SSH "sudo mv /tmp/admin-api-cli /usr/local/bin/admin-api && sudo chmod +x /usr/local/bin/admin-api"
fi

SKILLS_DIR="$SCRIPT_DIR/../openclaw/workspace/skills"
if [ -d "$SKILLS_DIR" ]; then
  echo "==> Deploying skills..."
  for skill_dir in "$SKILLS_DIR"/*/; do
    skill_name=$(basename "$skill_dir")
    $SSH "sudo mkdir -p /root/.openclaw/workspace/skills/$skill_name"
    gcloud compute scp "$skill_dir"SKILL.md \
      "$GCE_VM:/tmp/skill-${skill_name}.md" \
      --zone="$GCE_ZONE" --project="$GCE_PROJECT" 2>/dev/null || true
    $SSH "sudo mv /tmp/skill-${skill_name}.md /root/.openclaw/workspace/skills/$skill_name/SKILL.md"
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
