#!/bin/bash
# Deploy Cloud Functions (all or specific)
# Usage: ./scripts/deploy-functions.sh [functionName]
# Examples:
#   ./scripts/deploy-functions.sh              # deploy all
#   ./scripts/deploy-functions.sh serveFile    # deploy one

set -e

cd "$(dirname "$0")/.."

if [ -n "$1" ]; then
  echo "=== Deploying function: $1 ==="
  firebase deploy --only "functions:$1"
else
  echo "=== Deploying all functions ==="
  firebase deploy --only functions
fi

echo "=== Done ==="
