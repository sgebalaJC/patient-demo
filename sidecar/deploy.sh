#!/usr/bin/env bash
set -euo pipefail

# Deploy patient-sidecar to the host that runs it.
#
# Supports two transports:
#   1. Plain SSH/SCP (default — any generic Linux host)
#      Set SIDECAR_HOST to an IP/hostname; optionally SIDECAR_SSH_USER
#      (default: root) and SIDECAR_SSH_KEY (default: ~/.ssh/id_ed25519).
#   2. gcloud compute (GCE VMs)
#      Set GCE_VM / GCE_ZONE / GCE_PROJECT to enable this path.
#
# ★ Per-fork: edit the constants below OR export them before running.
#
# Usage:
#   ./deploy.sh
#   SIDECAR_HOST=1.2.3.4 SIDECAR_SSH_KEY=~/.ssh/my-key ./deploy.sh

REMOTE_BIN="/root/patient-sidecar"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Per-fork configuration ──────────────────────────────────────────────
# The demo AI agent runs on a Hetzner VPS at 5.78.123.70. For GCE VMs, blank
# SIDECAR_HOST and set the three GCE_* vars below.
SIDECAR_HOST="${SIDECAR_HOST:-5.78.123.70}"        # ★ hostname or IP (empty → use gcloud)
SIDECAR_SSH_USER="${SIDECAR_SSH_USER:-root}"
SIDECAR_SSH_KEY="${SIDECAR_SSH_KEY:-$HOME/.ssh/kitt-hetzner}"

GCE_VM="${GCE_VM:-openclaw}"                       # ★ GCE VM name (used when SIDECAR_HOST is empty)
GCE_ZONE="${GCE_ZONE:-us-central1-a}"              # ★ GCE zone
GCE_PROJECT="${GCE_PROJECT:-patient-demo-project}" # ★ GCP project
# ────────────────────────────────────────────────────────────────────────

if [[ -n "$SIDECAR_HOST" ]]; then
  TRANSPORT="ssh"
  SSH_TARGET="${SIDECAR_SSH_USER}@${SIDECAR_HOST}"
  SSH_OPTS=(-i "$SIDECAR_SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
  echo "==> Transport: plain SSH → $SSH_TARGET (key: $SIDECAR_SSH_KEY)"

  run_remote() {
    ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"
  }
  copy_to_remote() {
    local src="$1" dst="$2"
    scp "${SSH_OPTS[@]}" "$src" "${SSH_TARGET}:${dst}"
  }
else
  TRANSPORT="gcloud"
  echo "==> Transport: gcloud → $GCE_VM ($GCE_ZONE, $GCE_PROJECT)"

  run_remote() {
    gcloud compute ssh "$GCE_VM" --zone="$GCE_ZONE" --project="$GCE_PROJECT" --command="$*"
  }
  copy_to_remote() {
    local src="$1" dst="$2"
    gcloud compute scp "$src" "${GCE_VM}:${dst}" --zone="$GCE_ZONE" --project="$GCE_PROJECT"
  }
fi

echo "==> Building sidecar binary..."
cd "$SCRIPT_DIR"

# Extract the fork's CORS allow-list from /fork.config.ts and inject via
# Bun's build-time define, so the compiled binary carries the right portal
# origin per customer. Falls back to empty — then the deployed process relies
# on SIDECAR_ALLOWED_ORIGINS env (see index.ts).
FORK_ORIGINS=$(node -e '
  const src = require("fs").readFileSync("../fork.config.ts", "utf8");
  const m = src.match(/additionalOrigins:\s*\[([^\]]*)\]/);
  if (!m) { process.stdout.write(""); process.exit(0); }
  const origins = Array.from(m[1].matchAll(/["\x27]([^"\x27]+)["\x27]/g)).map(x => x[1]);
  process.stdout.write(origins.join(","));
' 2>/dev/null || echo "")

if [[ -n "$FORK_ORIGINS" ]]; then
  echo "    fork origins: $FORK_ORIGINS"
  bun build src/index.ts \
    --compile \
    --outfile patient-sidecar \
    --target=bun-linux-x64 \
    --define "SIDECAR_FORK_ORIGINS=\"${FORK_ORIGINS}\""
else
  bun run build
fi

# Self-heal runtime deps for document/image pipelines. pdftoppm from
# poppler-utils (PDF→JPG), `convert` from imagemagick (PNG/WEBP/GIF→JPG),
# `file` detects real MIME type regardless of extension.
echo "==> Ensuring system deps on VM (poppler-utils, imagemagick, file)..."
run_remote "command -v pdftoppm >/dev/null && command -v convert >/dev/null && command -v file >/dev/null \
  || (sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq poppler-utils imagemagick file)"

echo "==> Uploading binary..."
copy_to_remote "$SCRIPT_DIR/patient-sidecar" "/tmp/patient-sidecar.new"

# Ensure SIDECAR_API_KEY is in the OpenClaw gateway environment so the CLI inherits it
echo "==> Provisioning CLI environment..."
run_remote "sudo bash -c '
  KEY=\$(grep SIDECAR_API_KEY /root/sidecar.env 2>/dev/null | cut -d= -f2)
  if [ -n \"\$KEY\" ]; then
    grep -q SIDECAR_API_KEY /root/.bashrc 2>/dev/null || echo \"export SIDECAR_API_KEY=\$KEY\" >> /root/.bashrc
    echo \"SIDECAR_API_KEY set in .bashrc\"
  else
    echo \"WARNING: SIDECAR_API_KEY not found in /root/sidecar.env\"
  fi
'"

# Deploy CLI wrapper + skills if present
CLI_SCRIPT="$SCRIPT_DIR/../openclaw/scripts/admin-api"
if [ -f "$CLI_SCRIPT" ]; then
  echo "==> Deploying admin-api CLI..."
  copy_to_remote "$CLI_SCRIPT" "/tmp/admin-api-cli"
  run_remote "sudo mv /tmp/admin-api-cli /usr/local/bin/admin-api && sudo chmod +x /usr/local/bin/admin-api"

  # Aurelia runs inside the openclaw-gateway docker container, which has
  # its own /usr/local/bin and its own env — copying the CLI to the host
  # alone is invisible to her. Two pieces here:
  #   1. `docker cp` admin-api into the running container so PATH resolves
  #      it. Survives until the container is recreated; on next openclaw
  #      restart the container is rebuilt and we re-cp via this same step
  #      on the next sidecar deploy.
  #   2. Drop a sidecar.env file into the bind-mounted state dir
  #      (/home/openclaw/.openclaw on host → /home/node/.openclaw in
  #      container) so the script can source SIDECAR_API_KEY/SIDECAR_URL
  #      regardless of container env. The script auto-defaults SIDECAR_URL
  #      to the docker-bridge gateway when running in-container.
  echo "==> Wiring admin-api into the openclaw-gateway container..."
  run_remote "sudo bash -c '
    set -e
    if docker ps --format \"{{.Names}}\" | grep -q \"^openclaw-gateway\$\"; then
      docker cp /usr/local/bin/admin-api openclaw-gateway:/usr/local/bin/admin-api
      docker exec openclaw-gateway chmod +x /usr/local/bin/admin-api
      KEY=\$(grep \"^SIDECAR_API_KEY=\" /root/sidecar.env 2>/dev/null | cut -d= -f2-)
      if [ -n \"\$KEY\" ] && [ -d /home/openclaw/.openclaw ]; then
        cat > /home/openclaw/.openclaw/sidecar.env <<EOF
SIDECAR_API_KEY=\$KEY
SIDECAR_URL=http://172.17.0.1:8081
EOF
        chown openclaw:openclaw /home/openclaw/.openclaw/sidecar.env
        chmod 600 /home/openclaw/.openclaw/sidecar.env
        echo \"  sidecar.env written to bind-mounted state dir\"
      fi
      echo \"  admin-api installed in container\"
    else
      echo \"  openclaw-gateway container not running — skipped\"
    fi
  '"
fi

SKILLS_DIR="$SCRIPT_DIR/../openclaw/workspace/skills"
SKILLS_MANIFEST_FILE="$SCRIPT_DIR/../openclaw/workspace/skills.manifest.json"
if [ -d "$SKILLS_DIR" ]; then
  # Discover where Aurelia's runtime + sidecar actually read skills from.
  # OPENCLAW_STATE_DIR in /root/sidecar.env wins; if absent we default to
  # /root/.openclaw to match the sidecar's paths.ts fallback. Without this
  # the skills land in /root but the agent reads from /home/openclaw and
  # never sees them.
  REMOTE_STATE_DIR=$(run_remote "grep -E '^OPENCLAW_STATE_DIR=' /root/sidecar.env 2>/dev/null | cut -d= -f2- | tr -d '\"' | tr -d \"'\"" | tr -d '\r')
  REMOTE_STATE_DIR="${REMOTE_STATE_DIR:-/root/.openclaw}"
  REMOTE_SKILLS_DIR="$REMOTE_STATE_DIR/workspace/skills"
  REMOTE_SKILLS_SOURCE="$REMOTE_STATE_DIR/workspace/skills-source"

  # Compute the set of integration-bundled skill ids from the manifest so
  # we can route them to the source library (not the active dir). The
  # install/uninstall cycle, driven by save*Credentials / setEnabled /
  # disconnect* callables, owns the active copy from here on.
  if [ -f "$SKILLS_MANIFEST_FILE" ]; then
    BUNDLED_SKILLS=$(node -e '
      const m = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      const out = new Set();
      for (const ids of Object.values(m.integrations || {})) for (const id of ids) out.add(id);
      process.stdout.write([...out].join(" "));
    ' "$SKILLS_MANIFEST_FILE" 2>/dev/null || echo "")
  else
    BUNDLED_SKILLS=""
  fi
  echo "==> Deploying skills to $REMOTE_SKILLS_DIR (always-on) + $REMOTE_SKILLS_SOURCE (integration-bundled library)"
  [ -n "$BUNDLED_SKILLS" ] && echo "    bundled (source-only): $BUNDLED_SKILLS"

  is_bundled() {
    for b in $BUNDLED_SKILLS; do [ "$b" = "$1" ] && return 0; done
    return 1
  }

  REMOTE_OWNER=$(run_remote "stat -c '%U:%G' '$REMOTE_STATE_DIR' 2>/dev/null" | tr -d '\r')
  for skill_dir in "$SKILLS_DIR"/*/; do
    skill_name=$(basename "$skill_dir")
    # Every skill ships to the read-only source library so /skills/sync
    # has something to copy from on install.
    run_remote "sudo mkdir -p '$REMOTE_SKILLS_SOURCE/$skill_name'"
    if [ -f "${skill_dir}SKILL.md" ]; then
      copy_to_remote "${skill_dir}SKILL.md" "/tmp/skill-${skill_name}.md"
      run_remote "sudo cp /tmp/skill-${skill_name}.md '$REMOTE_SKILLS_SOURCE/$skill_name/SKILL.md'"
      if is_bundled "$skill_name"; then
        # Integration-bundled: the active copy is owned by the
        # install/uninstall cycle, not the deploy. Clean up the tmp file.
        run_remote "rm -f /tmp/skill-${skill_name}.md"
      else
        # Always-on (admin-tasks, scheduling, secure-messaging, …) —
        # deploy owns it; copy straight into the active workspace.
        run_remote "sudo mkdir -p '$REMOTE_SKILLS_DIR/$skill_name'"
        run_remote "sudo mv /tmp/skill-${skill_name}.md '$REMOTE_SKILLS_DIR/$skill_name/SKILL.md'"
      fi
    fi
  done
  if [ -f "$SKILLS_MANIFEST_FILE" ]; then
    copy_to_remote "$SKILLS_MANIFEST_FILE" "/tmp/skills.manifest.json"
    run_remote "sudo mv /tmp/skills.manifest.json '$REMOTE_STATE_DIR/workspace/skills.manifest.json'"
  fi
  if [ -n "$REMOTE_OWNER" ] && [ "$REMOTE_OWNER" != "root:root" ]; then
    run_remote "sudo chown -R '$REMOTE_OWNER' '$REMOTE_SKILLS_DIR' '$REMOTE_SKILLS_SOURCE' '$REMOTE_STATE_DIR/workspace/skills.manifest.json'"
  fi
fi

# Atomic binary swap + restart + health check + rollback. One SSH session for
# everything that touches the running service. A connection drop here either
# fails the script (set -e on the parent) or leaves the prior binary intact;
# the partial-deploy footgun that bit us before — stop succeeded, ssh dropped,
# start never ran — is closed because the remote script controls its own
# completion.
ATOMIC_SCRIPT='set -euo pipefail
BIN=/root/patient-sidecar
NEW=/tmp/patient-sidecar.new
PREV=/tmp/patient-sidecar.prev

if [ ! -f "$NEW" ]; then
  echo "FATAL: $NEW missing — upload step did not complete" >&2
  exit 2
fi

# Snapshot current binary so we can rollback on bad health.
if [ -f "$BIN" ]; then
  cp -f "$BIN" "$PREV"
fi

mv "$NEW" "$BIN"
chmod +x "$BIN"

# `restart` is one operation, half the failure window of stop+start.
systemctl restart patient-sidecar

# Probe localhost so we measure the service itself, not the network in front
# of it. The workstation-side check after this script does the network half.
for i in 1 2 3 4 5; do
  sleep 2
  if curl -sf --max-time 4 http://localhost:8081/healthz 2>/dev/null | grep -q "\"ok\":true"; then
    echo "[remote] healthz ok on attempt $i"
    rm -f "$PREV"
    exit 0
  fi
done

echo "[remote] healthz failed after 5 tries — rolling back" >&2
if [ -f "$PREV" ]; then
  mv "$PREV" "$BIN"
  systemctl restart patient-sidecar
  sleep 2
  if curl -sf --max-time 4 http://localhost:8081/healthz 2>/dev/null | grep -q "\"ok\":true"; then
    echo "[remote] rollback healthz ok — previous binary restored" >&2
  else
    echo "[remote] rollback also unhealthy — operator intervention required" >&2
  fi
fi
exit 1
'

# A transient SSH reset on the atomic step shouldn'"'"'t fail the deploy if a
# retry would succeed. 3 attempts with a brief backoff covers Hetzner'"'"'s
# occasional kex_exchange_identification drops without masking real failures
# (each attempt is itself idempotent — the remote script handles missing
# /tmp/patient-sidecar.new by failing fast).
echo "==> Atomic swap + restart + health (with rollback)..."
ATOMIC_OK=false
for attempt in 1 2 3; do
  if [[ "$TRANSPORT" == "ssh" ]]; then
    if printf '%s' "$ATOMIC_SCRIPT" | ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "sudo bash -s"; then
      ATOMIC_OK=true
      break
    fi
  else
    # gcloud compute ssh forwards stdin via the underlying ssh after `--`.
    if printf '%s' "$ATOMIC_SCRIPT" | gcloud compute ssh "$GCE_VM" --zone="$GCE_ZONE" --project="$GCE_PROJECT" -- "sudo bash -s"; then
      ATOMIC_OK=true
      break
    fi
  fi
  echo "    attempt $attempt failed — sleeping 5s before retry"
  sleep 5
done

if [[ "$ATOMIC_OK" != "true" ]]; then
  echo "==> FAIL: atomic swap exhausted retries"
  exit 1
fi

# Workstation-side probe — verifies the public network path the agent +
# Cloud Function proxy actually use, not just localhost on the VM.
echo "==> Verifying health from workstation..."
HEALTH_URL="http://${SIDECAR_HOST:-localhost}:8081/healthz"
if curl -sf --max-time 10 "$HEALTH_URL" | grep -q '"ok":true'; then
  echo "==> Deploy successful — sidecar healthy at $HEALTH_URL"
else
  echo "==> WARNING: workstation-side healthz did not return ok"
  echo "    (remote-side check passed; check firewall / port forwarding)"
  exit 1
fi
