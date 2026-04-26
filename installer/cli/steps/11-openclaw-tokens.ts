import {readFileSync, writeFileSync, statSync, readdirSync} from "node:fs";
import {join, resolve} from "node:path";
import {gcloud, gcloudText} from "../lib/gcloud.ts";
import {run} from "../lib/exec.ts";
import type {InstallerState, Logger, Step} from "../lib/types.ts";

/**
 * Substitute {{PLACEHOLDER}} tokens in openclaw/** and infra/agents/*,
 * render openclaw/openclaw.json via `bun run infra/build.ts`, and upload
 * the rendered config to gs://<project>-openclaw-config/openclaw.json.
 *
 * When the operator skipped step 09 (provisionOpenclaw=false), we still
 * run the placeholder substitution locally so the in-repo workspace is
 * fork-ready — but skip the build + GCS upload (no bucket exists).
 *
 * Placeholder set discovered via `grep -ohE '\\{\\{[A-Z_]+\\}\\}' openclaw infra -r`.
 * Anything not in the map gets a warning so we don't ship literal {{X}} on
 * the VM.
 */
export const openclawTokensStep: Step = {
  id: "11-openclaw-tokens",
  title: "Render OpenClaw workspace + upload config",
  idempotent: true,
  async run({state, log}) {
    const {targetDir, projectId} = state.inputs;
    const configBucket = state.artifacts.openclawConfigBucket;
    if (!targetDir || !projectId) throw new Error("prerequisites missing");

    // 1. Always do the local placeholder substitution — keeps the in-repo
    //    workspace correct whether or not the VM exists.
    substitutePlaceholders(targetDir, state, log);

    // 1b. Substitute the gateway token in infra/openclaw.base.json. This
    //     file is outside the openclaw/ + infra/agents/ walk in
    //     substitutePlaceholders, and the token is fetched from Secret
    //     Manager (step 7 creates `openclaw_gateway_token` with a random
    //     value, never written to state for security).
    substituteGatewayToken(targetDir, projectId, log);

    // 2. Render + upload only when a VM (and config bucket) exist.
    if (state.inputs.provisionOpenclaw === false || !configBucket) {
      log.info(
        "Skipping openclaw.json render + GCS upload — no VM provisioned. Re-run step 09 then 11 to publish.",
      );
      return;
    }

    const root = resolve(targetDir);
    const sp = log.spinner("Rendering openclaw/openclaw.json via infra/build.ts");
    try {
      run("bun", ["run", "infra/build.ts"], {cwd: root, capture: true});
      sp.stop("Rendered openclaw/openclaw.json.");
    } catch (err) {
      sp.fail();
      throw err;
    }

    const rendered = join(root, "openclaw", "openclaw.json");
    const sp2 = log.spinner(`Uploading openclaw.json to gs://${configBucket}/`);
    try {
      gcloud(["storage", "cp", rendered, `gs://${configBucket}/openclaw.json`, `--project=${projectId}`]);
      sp2.stop(`Uploaded → gs://${configBucket}/openclaw.json`);
    } catch (err) {
      sp2.fail();
      throw err;
    }

    log.info(
      "VM startup script pulls this on next boot. To force a refresh now: `gcloud compute instances reset openclaw --zone=" +
        state.inputs.zone +
        " --project=" +
        projectId +
        "`",
    );
  },
};

function substitutePlaceholders(targetDir: string, state: InstallerState, log: Logger): void {
  const {projectId, adminAgentName, patientAgentName, practiceName, practiceShortName, superAdminEmail, portalDomain} =
    state.inputs;
  const apphostingUrl = state.artifacts.apphostingUrl;
  const portal = portalDomain ?? apphostingUrl?.replace(/^https?:\/\//, "") ?? `${projectId}.web.app`;

  const tokens: Record<string, string> = {
    "{{PRACTICE_NAME}}": practiceName!,
    "{{PRACTICE_SHORT_NAME}}": practiceShortName!,
    "{{LEGAL_ENTITY}}": practiceName!,
    "{{ADMIN_AGENT_NAME}}": adminAgentName!,
    "{{ADMIN_AGENT_PRONOUNS}}": "they/them",
    "{{PATIENT_AGENT_NAME}}": patientAgentName!,
    "{{PATIENT_AGENT_PRONOUNS}}": "they/them",
    "{{DOMAIN}}": portal,
    "{{ADDRESS}}": "TODO — set via /admin/install",
    "{{HOURS}}": "Mon–Fri 9 AM – 5 PM",
    "{{SUPPORT_EMAIL}}": `support@${portal}`,
    "{{SUPPORT_PHONE}}": "TODO — set via /admin/install",
    "{{PRIMARY_CONTACT_EMAIL}}": superAdminEmail!,
    "{{PRIMARY_CONTACT_NAME}}": superAdminEmail!.split("@")[0],
    "{{GITHUB_REPO}}": state.artifacts.githubRepoCreated ?? "TBD",
    "{{AGENT_REPO_WORKTREE}}": `/root/${projectId}`,
    "{{GOOGLE_WORKSPACE_API_KEY}}": "TBD — set via /admin/integrations",
    "{{GOOGLE_WORKSPACE_PROXY_URL}}": "TBD — set via /admin/integrations",
  };

  const root = resolve(targetDir);
  const dirs = [join(root, "openclaw"), join(root, "infra", "agents")];
  let touched = 0;
  const unresolved = new Set<string>();
  for (const d of dirs) {
    walk(d, (path) => {
      if (!path.endsWith(".md") && !path.endsWith(".json")) return;
      const before = readFileSync(path, "utf8");
      let after = before;
      for (const [k, v] of Object.entries(tokens)) {
        after = after.split(k).join(v);
      }
      for (const m of after.matchAll(/\{\{[A-Z_]+\}\}/g)) unresolved.add(m[0]);
      if (after !== before) {
        writeFileSync(path, after);
        touched++;
      }
    });
  }
  log.success(`Substituted placeholders in ${touched} file(s).`);
  if (unresolved.size > 0) {
    log.warn(`Unresolved tokens still in repo: ${[...unresolved].join(", ")} — fill via /admin/install or hand-edit.`);
  }
}

function substituteGatewayToken(targetDir: string, projectId: string, log: Logger): void {
  const basePath = resolve(targetDir, "infra", "openclaw.base.json");
  let body: string;
  try {
    body = readFileSync(basePath, "utf8");
  } catch {
    log.warn(`infra/openclaw.base.json not found at ${basePath} — skipping gateway-token substitution.`);
    return;
  }
  if (!body.includes("{{GATEWAY_TOKEN}}")) {
    log.info("infra/openclaw.base.json has no {{GATEWAY_TOKEN}} placeholder — assuming already substituted.");
    return;
  }
  let token: string;
  try {
    token = gcloudText([
      "secrets",
      "versions",
      "access",
      "latest",
      "--secret=openclaw_gateway_token",
      `--project=${projectId}`,
    ]);
  } catch (err) {
    log.warn(`Could not read openclaw_gateway_token from Secret Manager: ${(err as Error).message.split("\n")[0]}`);
    return;
  }
  if (!token || token.trim().length < 32) {
    log.warn(`openclaw_gateway_token looks empty/short; refusing to substitute.`);
    return;
  }
  writeFileSync(basePath, body.split("{{GATEWAY_TOKEN}}").join(token.trim()));
  log.success(`Substituted {{GATEWAY_TOKEN}} → openclaw_gateway_token from Secret Manager (gateway.auth.token + web-chat.webhookSecret).`);
}

function walk(dir: string, fn: (file: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, fn);
    else if (st.isFile()) fn(full);
  }
}
