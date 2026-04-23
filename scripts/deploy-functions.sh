#!/bin/bash
# Deploy Cloud Functions (all or specific)
# Usage: ./scripts/deploy-functions.sh [--project <id>] [functionName]
# Examples:
#   ./scripts/deploy-functions.sh                       # all, default project
#   ./scripts/deploy-functions.sh serveFile             # one function
#   ./scripts/deploy-functions.sh --project acme-prod   # all, explicit project
#   ./scripts/deploy-functions.sh --project acme-prod serveFile

set -e

cd "$(dirname "$0")/.."

PROJECT_ARGS=()
if [ "${1:-}" = "--project" ]; then
  if [ -z "${2:-}" ]; then
    echo "error: --project requires a value" >&2
    exit 1
  fi
  PROJECT_ARGS=(--project "$2")
  shift 2
fi

if [ -n "${1:-}" ]; then
  echo "=== Deploying function: $1 ${PROJECT_ARGS[*]} ==="
  firebase "${PROJECT_ARGS[@]}" deploy --only "functions:$1"
else
  echo "=== Deploying all functions ${PROJECT_ARGS[*]} ==="
  firebase "${PROJECT_ARGS[@]}" deploy --only functions
fi

echo "=== Done ==="
