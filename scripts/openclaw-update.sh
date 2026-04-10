#!/usr/bin/env bash
set -euo pipefail

# Update OpenClaw on Vultr VPS with pre-update backup to GCS
#
# Usage:
#   ./openclaw-update.sh                    # update to latest stable
#   ./openclaw-update.sh v2026.3.22         # update to specific tag
#   ./openclaw-update.sh --dry-run          # preview without changes

SSH_KEY="${SSH_KEY:-$HOME/.ssh/vps-key}"
HOST="root@YOUR_VPS_IP"
GCS_BUCKET="gs://YOUR_BACKUP_BUCKET/openclaw"
BACKUP_DIR="/root/.openclaw-backups"

TAG="${1:-}"
DRY_RUN=false

if [[ "$TAG" == "--dry-run" ]]; then
  DRY_RUN=true
  TAG=""
fi

SSH="ssh -i $SSH_KEY $HOST"
SCP="scp -i $SSH_KEY"

echo "==> Checking current OpenClaw version..."
CURRENT=$($SSH "source /root/.bashrc && openclaw --version 2>&1" | head -1)
echo "    $CURRENT"

if $DRY_RUN; then
  echo "==> [DRY RUN] Would create backup, upload to GCS, then update"
  if [[ -n "$TAG" ]]; then
    echo "    Target tag: $TAG"
  else
    echo "    Target: latest stable"
  fi
  exit 0
fi

# Step 1: Create backup on VPS
echo "==> Creating pre-update backup on VPS..."
TIMESTAMP=$(date -u +%Y-%m-%dT%H-%M-%S)
BACKUP_NAME="pre-update-${TIMESTAMP}.tar.gz"
$SSH "tar czf ${BACKUP_DIR}/${BACKUP_NAME} -C /root .openclaw/"
echo "    Created: ${BACKUP_NAME}"

# Step 2: Download backup locally (temp)
echo "==> Downloading backup..."
TMPFILE=$(mktemp /tmp/openclaw-backup-XXXXXX.tar.gz)
$SCP "${HOST}:${BACKUP_DIR}/${BACKUP_NAME}" "$TMPFILE"
SIZE=$(du -h "$TMPFILE" | cut -f1)
echo "    Downloaded: ${SIZE}"

# Step 3: Upload to GCS
echo "==> Uploading to GCS..."
gsutil -q cp "$TMPFILE" "${GCS_BUCKET}/${BACKUP_NAME}"
echo "    Uploaded: ${GCS_BUCKET}/${BACKUP_NAME}"

# Cleanup local temp
rm -f "$TMPFILE"

# Step 4: Update OpenClaw
echo "==> Updating OpenClaw..."
if [[ -n "$TAG" ]]; then
  $SSH "source /root/.bashrc && openclaw update --tag ${TAG} --yes 2>&1"
else
  $SSH "source /root/.bashrc && openclaw update --yes 2>&1"
fi

# Step 5: Recompile web-chat plugin (SDK paths change between versions)
echo "==> Recompiling web-chat plugin..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/vultr-compile-webchat.sh"
$SSH "openclaw gateway restart 2>&1" | grep -E "Restarted|Error" | head -3

# Step 6: Verify
echo ""
echo "==> Verifying..."
NEW_VERSION=$($SSH "source /root/.bashrc && openclaw --version 2>&1" | head -1)
echo "    Before: $CURRENT"
echo "    After:  $NEW_VERSION"

sleep 5
HEALTH=$($SSH "curl -sf http://localhost:18789/health")
echo "    Gateway: $HEALTH"

# Step 6: Check web-chat plugin loaded
echo ""
echo "==> Checking web-chat plugin..."
PLUGIN_ERR=$($SSH "grep 'web-chat.*failed\|Cannot find module' /tmp/openclaw/openclaw-\$(date +%Y-%m-%d).log 2>/dev/null | tail -1" || true)
if [[ -n "$PLUGIN_ERR" && "$PLUGIN_ERR" == *"Cannot find module"* ]]; then
  echo ""
  echo "    *** WARNING: web-chat plugin FAILED to load! ***"
  echo "    The update likely broke plugin-sdk/compat exports."
  echo "    Chat (support + admin) is DOWN."
  echo ""
  echo "    To rollback: npm install -g openclaw@2026.3.13"
  echo "    Then:        openclaw gateway restart"
  echo ""
  echo "    See: feedback_openclaw_update.md in project memory"
else
  echo "    web-chat plugin: OK"
fi

echo ""
echo "==> Update complete! Backup stored at: ${GCS_BUCKET}/${BACKUP_NAME}"
