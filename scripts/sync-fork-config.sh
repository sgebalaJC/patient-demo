#!/usr/bin/env bash
# Copies /fork.config.ts into functions/src/_fork.config.ts so Cloud
# Functions can import it. Functions deployment packages only functions/,
# so the file must live inside the workspace at build time. Runs
# automatically as functions' `prebuild` npm script; keep it idempotent
# and silent on success.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/fork.config.ts"
DEST="$REPO_ROOT/functions/src/_fork.config.ts"

if [[ ! -f "$SRC" ]]; then
  echo "sync-fork-config: $SRC not found" >&2
  exit 1
fi

HEADER="// GENERATED — do not edit. Source: /fork.config.ts. Regenerate via scripts/sync-fork-config.sh."
{
  echo "$HEADER"
  cat "$SRC"
} > "$DEST.tmp"
mv "$DEST.tmp" "$DEST"
