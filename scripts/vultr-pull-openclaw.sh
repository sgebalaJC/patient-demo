#!/bin/bash
# Pull all .md files from Vultr OpenClaw instance for backup/reference
# Usage: ./scripts/vultr-pull-openclaw.sh
#
# Syncs: agents, workspace, skills, memory, and root config .md files
# Destination: scripts/vultr-config/openclaw/

set -e

SSH_KEY="$HOME/.ssh/vps-key"
HOST="root@YOUR_VPS_IP"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$(dirname "$SCRIPT_DIR")/openclaw"

echo "=== Pulling OpenClaw .md files from Vultr ==="

# Clean previous sync
rm -rf "$DEST"
mkdir -p "$DEST"

# Pull all .md files preserving directory structure
ssh -i "$SSH_KEY" "$HOST" "
cd /root/.openclaw && \
find . -name '*.md' -not -path './workspace/.git/*' -not -path '*/node_modules/*' \
  | tar cf - -T -
" | tar xf - -C "$DEST"

# Also pull openclaw.json (redacted) and any .yaml/.yml config
ssh -i "$SSH_KEY" "$HOST" "cat /root/.openclaw/openclaw.json" > "$DEST/openclaw.json" 2>/dev/null || true
ssh -i "$SSH_KEY" "$HOST" "
cd /root/.openclaw && \
find . -name '*.yaml' -o -name '*.yml' -o -name '*.json' \
  -not -path './workspace/.git/*' -not -path '*/node_modules/*' -not -name 'package*.json' -not -name 'tsconfig*' -not -name 'bun.lock*' \
  | head -50
" > "$DEST/_config_files.txt" 2>/dev/null

# Redact secrets from openclaw.json
python3 -c "
import json, sys
try:
    with open('$DEST/openclaw.json') as f:
        cfg = json.load(f)
    # Redact known secret fields
    def redact(obj, keys={'token','apiKey','secret','webhookSecret','password','authToken'}):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in keys and isinstance(v, str):
                    obj[k] = '<REDACTED>'
                else:
                    redact(v, keys)
        elif isinstance(obj, list):
            for item in obj:
                redact(item, keys)
    redact(cfg)
    with open('$DEST/openclaw.json', 'w') as f:
        json.dump(cfg, f, indent=2)
except Exception as e:
    print(f'Warning: could not redact openclaw.json: {e}', file=sys.stderr)
" 2>/dev/null || true

# Summary
echo ""
echo "=== Synced to $DEST ==="
find "$DEST" -name '*.md' | sort | while read f; do
  echo "  $(echo "$f" | sed "s|$DEST/||")"
done

MD_COUNT=$(find "$DEST" -name '*.md' | wc -l | tr -d ' ')
echo ""
echo "Total: $MD_COUNT .md files"
echo ""
echo "To commit: git add openclaw/ && git commit -m 'chore: sync OpenClaw config from Vultr'"
