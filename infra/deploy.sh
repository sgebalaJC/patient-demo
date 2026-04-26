#!/usr/bin/env bash
# Render + push OpenClaw config to the host VM, then restart the gateway.
#
# Usage:  ./infra/deploy.sh
#
# Resolves GCE_VM / GCE_ZONE / GCE_PROJECT in this order:
#   1. environment variables (override)
#   2. infra/.openclaw-host.json (written by patient-installer)
#   3. .firebaserc (fallback for project id only) + showmd defaults for vm/zone
#
# Source of truth for the config is this repo (infra/openclaw.base.json +
# infra/agents/*.json). The rendered openclaw.json is written to
# openclaw/openclaw.json and then SCP'd to /root/.openclaw/openclaw.json
# on the VM.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
RENDERED="$REPO/openclaw/openclaw.json"
HOST_CFG="$SCRIPT_DIR/.openclaw-host.json"

# ── Resolve target host ─────────────────────────────────────────────────
read_host_cfg() {
  local key="$1"
  if [[ -f "$HOST_CFG" ]]; then
    node -e "const j=require('$HOST_CFG');process.stdout.write(j['$key']||'')" 2>/dev/null || true
  fi
}

read_firebaserc_project() {
  if [[ -f "$REPO/.firebaserc" ]]; then
    node -e "const j=require('$REPO/.firebaserc');process.stdout.write(j.projects?.default||'')" 2>/dev/null || true
  fi
}

GCE_VM="${GCE_VM:-$(read_host_cfg vm)}"
GCE_ZONE="${GCE_ZONE:-$(read_host_cfg zone)}"
GCE_PROJECT="${GCE_PROJECT:-$(read_host_cfg project)}"

GCE_VM="${GCE_VM:-openclaw}"
GCE_ZONE="${GCE_ZONE:-us-central1-a}"
GCE_PROJECT="${GCE_PROJECT:-$(read_firebaserc_project)}"

if [[ -z "$GCE_PROJECT" ]]; then
  echo "==> No project resolved. Set GCE_PROJECT, write infra/.openclaw-host.json, or fix .firebaserc." >&2
  exit 1
fi

echo "==> Target: $GCE_VM @ $GCE_ZONE in $GCE_PROJECT"

SSH="gcloud compute ssh $GCE_VM --zone=$GCE_ZONE --project=$GCE_PROJECT --command"
SCP="gcloud compute scp --zone=$GCE_ZONE --project=$GCE_PROJECT"

echo "==> Rendering config..."
bun run "$SCRIPT_DIR/build.ts"

echo "==> Validating against the live OpenClaw schema..."
$SCP "$RENDERED" "$GCE_VM:/tmp/openclaw.json.new"
$SSH "sudo -i bash -c 'cp /root/.openclaw/openclaw.json /root/.openclaw/openclaw.json.bak && cp /tmp/openclaw.json.new /root/.openclaw/openclaw.json && openclaw config validate'"

echo "==> Restarting gateway..."
$SSH "sudo pkill -f openclaw-gateway || true; sleep 3; pgrep -f openclaw-gateway | head -1"

echo "==> Deploy successful."
