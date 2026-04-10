#!/usr/bin/env bash
set -euo pipefail

# Compile web-chat plugin and create SDK shims for OpenClaw on Vultr VPS
#
# The web-chat plugin is distributed as TypeScript source. OpenClaw's plugin
# loader on bare VPS (no Docker) cannot resolve package.json exports subpaths
# from .ts files. This script:
#   1. Migrates imports from compat → scoped paths (core, runtime-store)
#   2. Compiles .ts → .js with esbuild (openclaw/* kept as externals)
#   3. Creates ESM shim files in node_modules so compiled JS can resolve imports
#   4. Updates package.json extensions entry to point to .js
#
# Run after: openclaw update, plugin reinstall, or web-chat source changes
# Usage: ./scripts/vultr-compile-webchat.sh

SSH_KEY="${SSH_KEY:-$HOME/.ssh/vps-key}"
HOST="root@YOUR_VPS_IP"

echo "==> Compiling web-chat plugin on VPS..."

ssh -i "$SSH_KEY" "$HOST" bash << 'REMOTE'
set -e

PLUGIN_DIR="/root/.openclaw/extensions/web-chat"
OPENCLAW_DIST="/usr/lib/node_modules/openclaw/dist/plugin-sdk"

cd "$PLUGIN_DIR"

# Step 1: Migrate imports to scoped paths
echo "    Migrating imports..."
for f in index.ts src/channel.ts; do
  [ -f "$f" ] && sed -i 's|openclaw/plugin-sdk/compat|openclaw/plugin-sdk/core|g' "$f"
done
for f in src/runtime.ts; do
  [ -f "$f" ] && sed -i 's|openclaw/plugin-sdk/compat|openclaw/plugin-sdk/runtime-store|g' "$f"
done

# Step 2: Ensure esbuild is available
if ! command -v esbuild &>/dev/null; then
  echo "    Installing esbuild..."
  npm install -g esbuild >/dev/null 2>&1
fi

# Step 3: Compile .ts → .js
echo "    Compiling TypeScript..."
for f in index.ts src/channel.ts src/runtime.ts src/accounts.ts src/types.ts; do
  if [ -f "$f" ]; then
    outfile="${f%.ts}.js"
    esbuild "$f" --outfile="$outfile" --bundle --format=esm --platform=node \
      --external:"openclaw" --external:"openclaw/*" --external:zod \
      --external:fs --external:path --external:crypto --external:node:* \
      2>/dev/null
  fi
done

# Step 4: Create ESM shims for openclaw/plugin-sdk/* resolution
echo "    Creating SDK shims..."
mkdir -p node_modules/openclaw/plugin-sdk

cat > node_modules/openclaw/package.json << 'PKG'
{"name":"openclaw","type":"module","exports":{"./*":"./*"}}
PKG

# Map each scoped import to the actual dist files
for mod in core runtime-store infra-runtime; do
  if [ -f "$OPENCLAW_DIST/$mod.js" ]; then
    cat > "node_modules/openclaw/plugin-sdk/$mod.js" << SHIM
export * from "$OPENCLAW_DIST/$mod.js";
SHIM
  fi
done

# Step 5: Update plugin entry to .js
python3 -c "
import json
with open('package.json') as f: pkg = json.load(f)
ext = pkg.get('openclaw', {}).get('extensions', [])
pkg['openclaw']['extensions'] = [e.replace('.ts', '.js') for e in ext]
with open('package.json', 'w') as f: json.dump(pkg, f, indent=2)
"

echo "    Done! Compiled files:"
ls -la *.js src/*.js 2>/dev/null | awk '{print "      " $NF " (" $5 ")"}'
REMOTE

echo ""
echo "==> Web-chat plugin compiled. Restart gateway to apply:"
echo "    ssh -i $SSH_KEY $HOST 'openclaw gateway restart'"
