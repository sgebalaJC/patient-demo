#!/bin/bash
# Trigger App Hosting rollout for the web frontend
# Usage: ./scripts/deploy-web.sh [project-id] [backend-id]
#
# Defaults match the demo fork. Override per customer fork.

set -e

cd "$(dirname "$0")/.."

PROJECT_ID="${1:-patient-demo-project}"
BACKEND_ID="${2:-web-patient-demo}"

echo "=== Triggering App Hosting rollout for $BACKEND_ID on $PROJECT_ID ==="
firebase apphosting:rollouts:create "$BACKEND_ID" --git-branch main --project="$PROJECT_ID"

echo "=== Done ==="
