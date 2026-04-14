#!/usr/bin/env bash
# Render + push OpenClaw config to the host VM, then restart the gateway.
#
# Usage:  ./infra/deploy.sh
#
# ★ Per-fork: update GCE_VM, GCE_ZONE, GCE_PROJECT for your instance.
#
# Source of truth is this repo (infra/openclaw.base.json + infra/agents/*.json).
# The rendered openclaw.json is written to openclaw/openclaw.json and then
# SCP'd to /root/.openclaw/openclaw.json on the VM.

set -euo pipefail

GCE_VM="openclaw"                    # ★ your GCE VM name
GCE_ZONE="us-central1-a"            # ★ your GCE zone
GCE_PROJECT="patient-demo-project"   # ★ your GCP project
SSH="gcloud compute ssh $GCE_VM --zone=$GCE_ZONE --project=$GCE_PROJECT --command"
SCP="gcloud compute scp --zone=$GCE_ZONE --project=$GCE_PROJECT"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
RENDERED="$REPO/openclaw/openclaw.json"

echo "==> Rendering config..."
bun run "$SCRIPT_DIR/build.ts"

echo "==> Validating against the live OpenClaw schema..."
$SCP "$RENDERED" "$GCE_VM:/tmp/openclaw.json.new"
$SSH "sudo -i bash -c 'cp /root/.openclaw/openclaw.json /root/.openclaw/openclaw.json.bak && cp /tmp/openclaw.json.new /root/.openclaw/openclaw.json && openclaw config validate'"

echo "==> Restarting gateway..."
$SSH "sudo pkill -f openclaw-gateway || true; sleep 3; pgrep -f openclaw-gateway | head -1"

echo "==> Deploy successful."
