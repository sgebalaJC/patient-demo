#!/bin/bash
# Deploy Firestore rules, indexes, and storage rules
# Usage: ./scripts/deploy-rules.sh [--project <id>]

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

echo "=== Deploying Firestore rules + indexes ${PROJECT_ARGS[*]} ==="
firebase "${PROJECT_ARGS[@]}" deploy --only firestore:rules,firestore:indexes

echo "=== Deploying Storage rules ${PROJECT_ARGS[*]} ==="
firebase "${PROJECT_ARGS[@]}" deploy --only storage

echo "=== Done ==="
