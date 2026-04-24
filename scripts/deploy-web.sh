#!/bin/bash
# Trigger App Hosting rollout for the web frontend.
# Usage: ./scripts/deploy-web.sh <project-id> <backend-id>
#
# Both arguments are required. The previous version silently defaulted to
# the demo project, which meant a forgotten argument could publish a
# customer fork's branch to the public demo. Fail fast instead.

set -e

cd "$(dirname "$0")/.."

PROJECT_ID="${1:-}"
BACKEND_ID="${2:-}"

if [ -z "$PROJECT_ID" ] || [ -z "$BACKEND_ID" ]; then
  echo "usage: $0 <project-id> <backend-id>" >&2
  echo "  e.g. $0 patient-demo-project web-patient-demo" >&2
  exit 64
fi

echo "=== Triggering App Hosting rollout for $BACKEND_ID on $PROJECT_ID ==="
firebase apphosting:rollouts:create "$BACKEND_ID" --git-branch main --project="$PROJECT_ID"

echo "=== Done ==="
