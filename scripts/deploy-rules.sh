#!/bin/bash
# Deploy Firestore rules, indexes, and storage rules
# Usage: ./scripts/deploy-rules.sh

set -e

cd "$(dirname "$0")/.."

echo "=== Deploying Firestore rules + indexes ==="
firebase deploy --only firestore:rules,firestore:indexes

echo "=== Deploying Storage rules ==="
firebase deploy --only storage

echo "=== Done ==="
