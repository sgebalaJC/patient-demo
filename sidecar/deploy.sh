#!/usr/bin/env bash
set -euo pipefail

# Deploy patient-sidecar to the host that runs it.
#
# Supports two transports:
#   1. Plain SSH/SCP (default — any generic Linux host)
#      Set SIDECAR_HOST to an IP/hostname; optionally SIDECAR_SSH_USER
#      (default: root) and SIDECAR_SSH_KEY (default: ~/.ssh/id_ed25519).
#   2. gcloud compute (GCE VMs)
#      Set GCE_VM / GCE_ZONE / GCE_PROJECT to enable this path.
#
# ★ Per-fork: edit the constants below OR export them before running.
#
# Usage:
#   ./deploy.sh
#   SIDECAR_HOST=1.2.3.4 SIDECAR_SSH_KEY=~/.ssh/my-key ./deploy.sh

REMOTE_BIN="/root/patient-sidecar"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Per-fork configuration ──────────────────────────────────────────────
# The demo AI agent runs on a Hetzner VPS at 5.78.123.70. For GCE VMs, blank
# SIDECAR_HOST and set the three GCE_* vars below.
SIDECAR_HOST="${SIDECAR_HOST:-5.78.123.70}"        # ★ hostname or IP (empty → use gcloud)
SIDECAR_SSH_USER="${SIDECAR_SSH_USER:-root}"
SIDECAR_SSH_KEY="${SIDECAR_SSH_KEY:-$HOME/.ssh/kitt-hetzner}"

GCE_VM="${GCE_VM:-openclaw}"                       # ★ GCE VM name (used when SIDECAR_HOST is empty)
GCE_ZONE="${GCE_ZONE:-us-central1-a}"              # ★ GCE zone
GCE_PROJECT="${GCE_PROJECT:-patient-demo-project}" # ★ GCP project
# ────────────────────────────────────────────────────────────────────────

if [[ -n "$SIDECAR_HOST" ]]; then
  TRANSPORT="ssh"
  SSH_TARGET="${SIDECAR_SSH_USER}@${SIDECAR_HOST}"
  SSH_OPTS=(-i "$SIDECAR_SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
  echo "==> Transport: plain SSH → $SSH_TARGET (key: $SIDECAR_SSH_KEY)"

  run_remote() {
    ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"
  }
  copy_to_remote() {
    local src="$1" dst="$2"
    scp "${SSH_OPTS[@]}" "$src" "${SSH_TARGET}:${dst}"
  }
else
  TRANSPORT="gcloud"
  echo "==> Transport: gcloud → $GCE_VM ($GCE_ZONE, $GCE_PROJECT)"

  run_remote() {
    gcloud compute ssh "$GCE_VM" --zone="$GCE_ZONE" --project="$GCE_PROJECT" --command="$*"
  }
  copy_to_remote() {
    local src="$1" dst="$2"
    gcloud compute scp "$src" "${GCE_VM}:${dst}" --zone="$GCE_ZONE" --project="$GCE_PROJECT"
  }
fi

echo "==> Building sidecar binary..."
cd "$SCRIPT_DIR"
bun run build

# Self-heal runtime deps for document/image pipelines. pdftoppm from
# poppler-utils (PDF→JPG), `convert` from imagemagick (PNG/WEBP/GIF→JPG),
# `file` detects real MIME type regardless of extension.
echo "==> Ensuring system deps on VM (poppler-utils, imagemagick, file)..."
run_remote "command -v pdftoppm >/dev/null && command -v convert >/dev/null && command -v file >/dev/null \
  || (sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq poppler-utils imagemagick file)"

echo "==> Uploading binary..."
copy_to_remote "$SCRIPT_DIR/patient-sidecar" "/tmp/patient-sidecar.new"

echo "==> Stopping remote sidecar..."
run_remote "sudo systemctl stop patient-sidecar"

echo "==> Moving binary into place..."
run_remote "sudo mv /tmp/patient-sidecar.new $REMOTE_BIN && sudo chmod +x $REMOTE_BIN"

# Ensure SIDECAR_API_KEY is in the OpenClaw gateway environment so the CLI inherits it
echo "==> Provisioning CLI environment..."
run_remote "sudo bash -c '
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
  copy_to_remote "$CLI_SCRIPT" "/tmp/admin-api-cli"
  run_remote "sudo mv /tmp/admin-api-cli /usr/local/bin/admin-api && sudo chmod +x /usr/local/bin/admin-api"
fi

SKILLS_DIR="$SCRIPT_DIR/../openclaw/workspace/skills"
if [ -d "$SKILLS_DIR" ]; then
  # Discover where Aurelia's runtime + sidecar actually read skills from.
  # OPENCLAW_STATE_DIR in /root/sidecar.env wins; if absent we default to
  # /root/.openclaw to match the sidecar's paths.ts fallback. Without this
  # the skills land in /root but the agent reads from /home/openclaw and
  # never sees them.
  REMOTE_STATE_DIR=$(run_remote "grep -E '^OPENCLAW_STATE_DIR=' /root/sidecar.env 2>/dev/null | cut -d= -f2- | tr -d '\"' | tr -d \"'\"" | tr -d '\r')
  REMOTE_STATE_DIR="${REMOTE_STATE_DIR:-/root/.openclaw}"
  REMOTE_SKILLS_DIR="$REMOTE_STATE_DIR/workspace/skills"
  echo "==> Deploying skills to $REMOTE_SKILLS_DIR"
  # Figure out who owns the parent state dir so we can chown after writing
  # as root (e.g. /home/openclaw/.openclaw is owned by user 'openclaw').
  REMOTE_OWNER=$(run_remote "stat -c '%U:%G' '$REMOTE_STATE_DIR' 2>/dev/null" | tr -d '\r')
  for skill_dir in "$SKILLS_DIR"/*/; do
    skill_name=$(basename "$skill_dir")
    run_remote "sudo mkdir -p '$REMOTE_SKILLS_DIR/$skill_name'"
    if [ -f "${skill_dir}SKILL.md" ]; then
      copy_to_remote "${skill_dir}SKILL.md" "/tmp/skill-${skill_name}.md"
      run_remote "sudo mv /tmp/skill-${skill_name}.md '$REMOTE_SKILLS_DIR/$skill_name/SKILL.md'"
    fi
  done
  if [ -n "$REMOTE_OWNER" ] && [ "$REMOTE_OWNER" != "root:root" ]; then
    run_remote "sudo chown -R '$REMOTE_OWNER' '$REMOTE_SKILLS_DIR'"
  fi
fi

echo "==> Starting remote sidecar..."
run_remote "sudo systemctl start patient-sidecar"

echo "==> Verifying health..."
sleep 2
HEALTH=$(run_remote "curl -sf http://localhost:8081/healthz")

echo "$HEALTH"

if echo "$HEALTH" | grep -q '"ok":true'; then
  echo "==> Deploy successful!"
else
  echo "==> WARNING: Health check failed"
  exit 1
fi
