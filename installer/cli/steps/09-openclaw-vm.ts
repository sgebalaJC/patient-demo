import {writeFileSync, mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {exists, gcloud, gcloudJson, gcloudText} from "../lib/gcloud.ts";
import type {Step, Logger} from "../lib/types.ts";

const VM_NAME = "openclaw";
const VM_MACHINE = "e2-standard-2";
const VM_IMAGE_FAMILY = "debian-12";
const VM_IMAGE_PROJECT = "debian-cloud";
const FIREWALL_NAME = "openclaw-sidecar-http";
const SIDECAR_PORT = "8081";
const GATEWAY_PORT = "18789";

interface VmDescribe {
  name: string;
  status: string;
  networkInterfaces?: Array<{
    networkIP?: string;
    accessConfigs?: Array<{natIP?: string}>;
  }>;
}

export const openclawVmStep: Step = {
  id: "09-openclaw-vm",
  title: "Provision OpenClaw GCE VM (showmd pattern)",
  idempotent: true,
  async run({state, log}) {
    const {projectId, zone, region, provisionOpenclaw} = state.inputs;
    const projectNumber = state.artifacts.projectNumber;
    if (!projectId || !zone || !region || !projectNumber) throw new Error("inputs missing");

    if (provisionOpenclaw === false) {
      log.info(
        "Skipping OpenClaw VM provisioning (provisionOpenclaw=false). Re-run with `--rerun 09-openclaw-vm` after flipping the input to true.",
      );
      return;
    }

    const openclawSa = `openclaw-vm@${projectId}.iam.gserviceaccount.com`;
    const configBucket = `${projectId}-openclaw-config`;

    // 1. GCS bucket for staged openclaw.json (startup script pulls from here).
    const bucketExists = exists(["storage", "buckets", "describe", `gs://${configBucket}`, `--project=${projectId}`]);
    if (!bucketExists) {
      const sp = log.spinner(`Creating gs://${configBucket}`);
      try {
        gcloud([
          "storage",
          "buckets",
          "create",
          `gs://${configBucket}`,
          `--location=${region}`,
          "--uniform-bucket-level-access",
          `--project=${projectId}`,
        ]);
        sp.stop(`Created gs://${configBucket}.`);
      } catch (err) {
        sp.fail();
        throw err;
      }
    } else {
      log.info(`Bucket gs://${configBucket} already exists.`);
    }
    state.artifacts.openclawConfigBucket = configBucket;

    // 2. Firewall — sidecar 8081 (SignalWire webhook needs public reachability;
    //    HMAC verification happens at the app layer). Gateway 18789 stays
    //    loopback-only on the VM, no firewall hole needed.
    const fwExists = exists(["compute", "firewall-rules", "describe", FIREWALL_NAME, `--project=${projectId}`]);
    if (!fwExists) {
      const sp = log.spinner(`Creating firewall rule ${FIREWALL_NAME}`);
      try {
        gcloud([
          "compute",
          "firewall-rules",
          "create",
          FIREWALL_NAME,
          "--direction=INGRESS",
          "--action=ALLOW",
          `--rules=tcp:${SIDECAR_PORT}`,
          "--source-ranges=0.0.0.0/0",
          "--target-tags=openclaw",
          "--description=OpenClaw sidecar HTTP (HMAC-verified at app layer)",
          `--project=${projectId}`,
        ]);
        sp.stop(`Firewall rule ${FIREWALL_NAME} created.`);
      } catch (err) {
        sp.fail();
        throw err;
      }
    } else {
      log.info(`Firewall rule ${FIREWALL_NAME} already exists.`);
    }

    // 3. VM — create if absent.
    const vmExists = exists([
      "compute",
      "instances",
      "describe",
      VM_NAME,
      `--zone=${zone}`,
      `--project=${projectId}`,
    ]);
    if (!vmExists) {
      const startupPath = writeStartupScript(projectId, configBucket);
      const sp = log.spinner(`Creating VM ${VM_NAME} in ${zone}`);
      try {
        gcloud([
          "compute",
          "instances",
          "create",
          VM_NAME,
          `--zone=${zone}`,
          `--machine-type=${VM_MACHINE}`,
          `--image-family=${VM_IMAGE_FAMILY}`,
          `--image-project=${VM_IMAGE_PROJECT}`,
          "--boot-disk-size=30GB",
          "--boot-disk-type=pd-balanced",
          `--service-account=${openclawSa}`,
          "--scopes=cloud-platform",
          "--tags=openclaw,http-server",
          `--metadata-from-file=startup-script=${startupPath}`,
          `--project=${projectId}`,
        ]);
        sp.stop(`VM ${VM_NAME} created.`);
      } catch (err) {
        sp.fail();
        throw err;
      }
    } else {
      log.info(`VM ${VM_NAME} already exists; skipping create. (Re-run startup script via \`gcloud compute instances reset\` if needed.)`);
    }

    // 4. Capture IPs.
    const desc = gcloudJson<VmDescribe>([
      "compute",
      "instances",
      "describe",
      VM_NAME,
      `--zone=${zone}`,
      `--project=${projectId}`,
    ]);
    const internalIp = desc.networkInterfaces?.[0]?.networkIP;
    const externalIp = desc.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP;
    state.artifacts.openclawVm = {name: VM_NAME, zone, internalIp, externalIp};
    log.success(`VM ready — internal ${internalIp ?? "?"}, external ${externalIp ?? "?"}.`);

    // 5. Write infra/.openclaw-host.json so the new fork's infra/deploy.sh
    //    auto-resolves the VM target without hand-editing.
    const hostCfgPath = resolve(state.inputs.targetDir!, "infra", ".openclaw-host.json");
    writeFileSync(
      hostCfgPath,
      JSON.stringify({vm: VM_NAME, zone, project: projectId}, null, 2) + "\n",
    );
    log.info(`Wrote ${hostCfgPath} for infra/deploy.sh.`);

    // 6. Write the real SIDECAR_URL secret value now that the VM's external
    //    IP is known. Step 07 seeded a placeholder so `firebase deploy`
    //    (defineSecret check) succeeds; doing the overwrite here — BEFORE
    //    step 12 — means the very first sidecarProxy invocation reads the
    //    real URL, not the placeholder.
    if (externalIp) {
      writeSidecarUrlSecret(projectId, `http://${externalIp}:${SIDECAR_PORT}`, log);
    }

    // 7. Hint about config staging — the actual openclaw.json render+upload
    //    happens in step 11 (which has access to the rewritten placeholders).
    log.info(`Startup script will pull openclaw.json from gs://${configBucket}/openclaw.json on each boot.`);
    log.info(`Gateway port (loopback-only on VM): ${GATEWAY_PORT}.`);
    void gcloudText;
  },
};

/**
 * Idempotent SIDECAR_URL secret update — adds a new version when the secret
 * already exists, creates it otherwise. Logged but not fatal: if the binding
 * fails, step 12 still runs the same logic with sufficient retry runway.
 */
function writeSidecarUrlSecret(projectId: string, sidecarUrl: string, log: Logger): void {
  const secretExists = exists(["secrets", "describe", "SIDECAR_URL", `--project=${projectId}`]);
  try {
    if (secretExists) {
      gcloud(["secrets", "versions", "add", "SIDECAR_URL", `--project=${projectId}`, "--data-file=-"], {input: sidecarUrl});
    } else {
      gcloud(
        ["secrets", "create", "SIDECAR_URL", "--replication-policy=automatic", `--project=${projectId}`, "--data-file=-"],
        {input: sidecarUrl},
      );
    }
    log.info(`Set SIDECAR_URL secret → ${sidecarUrl}`);
  } catch (err) {
    log.warn(`Could not set SIDECAR_URL: ${(err as Error).message.split("\n")[0]}`);
  }
}

/**
 * Write the VM startup script to a temp file (so gcloud can read via
 * --metadata-from-file). The script is small + self-contained so it can
 * be re-run safely via `gcloud compute instances add-metadata` updates.
 */
function writeStartupScript(projectId: string, configBucket: string): string {
  const dir = resolve(tmpdir(), "patient-installer");
  mkdirSync(dir, {recursive: true});
  const path = resolve(dir, `startup-${projectId}.sh`);
  writeFileSync(path, STARTUP_SCRIPT.replace(/__CONFIG_BUCKET__/g, configBucket));
  return path;
}

const STARTUP_SCRIPT = `#!/usr/bin/env bash
# OpenClaw VM startup — runs on every boot. Idempotent.
set -euo pipefail
exec > >(tee -a /var/log/openclaw-startup.log) 2>&1
echo "[startup] $(date -u +%FT%TZ) — begin"

CONFIG_BUCKET="__CONFIG_BUCKET__"

# 1. Base packages
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \\
  curl ca-certificates unzip jq poppler-utils imagemagick file git

# 2. Bun (system-wide install for systemd to find it)
if ! command -v bun >/dev/null; then
  echo "[startup] installing bun..."
  export BUN_INSTALL=/usr/local
  curl -fsSL https://bun.sh/install | bash
  ln -sf /usr/local/bin/bun /usr/bin/bun || true
fi

# 3. OpenClaw — npm-based install (mirrors showmd vultr-setup.sh).
#    Node 22 is needed for the openclaw npm package.
if ! command -v node >/dev/null; then
  echo "[startup] installing Node 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
if ! command -v openclaw >/dev/null; then
  echo "[startup] installing openclaw..."
  npm install -g openclaw
  openclaw onboard --non-interactive 2>/dev/null || true
fi
if ! command -v qmd >/dev/null; then
  echo "[startup] installing qmd (vector memory)..."
  bun install -g qmd
fi

# 4. Pull secrets from Secret Manager into /root/sidecar.env
mkdir -p /root
{
  # Secret names must match step 07's specs exactly. Casing matters: Secret
  # Manager treats names case-sensitively; a mismatch silently writes MISSING.
  echo "OPENCLAW_GATEWAY_TOKEN=$(gcloud secrets versions access latest --secret=openclaw_gateway_token 2>/dev/null || echo MISSING)"
  echo "SIDECAR_API_KEY=$(gcloud secrets versions access latest --secret=SIDECAR_API_KEY 2>/dev/null || echo MISSING)"
  echo "SIGNALWIRE_AUTH_TOKEN=$(gcloud secrets versions access latest --secret=SIGNALWIRE_AUTH_TOKEN 2>/dev/null || echo MISSING)"
  echo "OPENCLAW_STATE_DIR=/root/.openclaw"
} > /root/sidecar.env
chmod 600 /root/sidecar.env

# 5. Pull rendered openclaw.json from GCS (uploaded by installer step 11)
mkdir -p /root/.openclaw
if gsutil -q stat "gs://\${CONFIG_BUCKET}/openclaw.json"; then
  gsutil cp "gs://\${CONFIG_BUCKET}/openclaw.json" /root/.openclaw/openclaw.json
  echo "[startup] pulled openclaw.json from gs://\${CONFIG_BUCKET}/"
else
  echo "[startup] gs://\${CONFIG_BUCKET}/openclaw.json not yet uploaded; skipping"
fi

# 6. systemd unit for openclaw-gateway (only writes if absent).
#    The gateway listens on loopback (port 18789) — that's intentional.
#    The publicly-reachable sidecar HTTP (port 8081, opened by the firewall
#    rule above) is a SEPARATE service deployed via \`infra/deploy.sh\`
#    after this step; it has its own systemd unit and HMAC-verifies inbound
#    requests at the app layer. Do not change \`--bind loopback\` here:
#    that would expose the gateway's unauthenticated control plane.
if [ ! -f /etc/systemd/system/openclaw-gateway.service ]; then
  cat > /etc/systemd/system/openclaw-gateway.service <<'UNIT'
[Unit]
Description=OpenClaw gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=-/root/sidecar.env
ExecStart=/usr/local/bin/openclaw start --bind loopback
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable openclaw-gateway.service
fi

# Try a start; if openclaw isn't installed yet, this no-ops with a journal entry.
systemctl restart openclaw-gateway.service || true

echo "[startup] $(date -u +%FT%TZ) — end"
`;
