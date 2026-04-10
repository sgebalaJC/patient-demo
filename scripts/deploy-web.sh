#!/bin/bash
# Trigger App Hosting rollout for the web frontend
# Usage: ./scripts/deploy-web.sh

set -e

cd "$(dirname "$0")/.."

echo "=== Triggering App Hosting rollout ==="
firebase apphosting:rollouts:create web-patient --git-branch main --project=YOUR_FIREBASE_PROJECT

echo "=== Done ==="
