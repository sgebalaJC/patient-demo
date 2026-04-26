import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {resolve} from "node:path";
import {firebase, gcloud, exists} from "../lib/gcloud.ts";
import {run, runCapture} from "../lib/exec.ts";
import {deployFilterFor, type GroupId} from "../lib/function-groups.ts";
import type {Step} from "../lib/types.ts";

/**
 * First Firebase deploy — rules + indexes + functions only.
 *
 * App Hosting is intentionally NOT created here. The repo is pushed to
 * GitHub in step 03, then the operator creates the App Hosting backend
 * once in the Firebase Console (interactive GitHub auth flow). After
 * that, every subsequent `git push origin main` triggers an auto-deploy
 * via Cloud Build — no installer involvement.
 *
 * What this step does do:
 *   1. firebase deploy --only firestore:rules,firestore:indexes,functions
 *   2. capture sidecarProxy Cloud Run URL → patch web/apphosting.yaml + commit
 *   3. set SIDECAR_URL secret to the OpenClaw VM external IP so the proxy
 *      knows where to forward
 */
export const deployFirstStep: Step = {
  id: "12-deploy-first",
  title: "First Firebase deploy (rules + indexes + functions)",
  idempotent: true,
  async run({state, log}) {
    const {targetDir, projectId, region} = state.inputs;
    if (!targetDir || !projectId || !region) throw new Error("prerequisites missing");

    const cwd = resolve(targetDir);

    // 1. Install function deps.
    if (!existsSync(resolve(cwd, "functions", "node_modules"))) {
      const sp = log.spinner("Installing functions/ dependencies (npm install)");
      try {
        run("npm", ["install"], {cwd: resolve(cwd, "functions"), capture: true});
        sp.stop("functions/ deps installed.");
      } catch (err) {
        sp.fail();
        throw err;
      }
    }

    // 2. Deploy. firebase deploy *exits 0 even when individual triggers fail*
    //    (it treats per-function failures as warnings), so we have to scrape
    //    stdout for the "failed to create function" marker and retry on
    //    partial failure. First deploys on fresh projects often miss
    //    triggers because Eventarc/Pub-Sub service agents are still
    //    propagating IAM. Retry after 60s usually resolves it.
    //    --force auto-accepts the artifact cleanup policy prompt.
    //
    //    --only includes firestore:rules,indexes + a curated list of function
    //    names from `core` + any in `inputs.enabledIntegrations`. Excluded
    //    functions stay undeployed until the operator runs
    //    `firebase deploy --only functions:<group>` later (or admin UI deploys).
    const enabled = (state.inputs.enabledIntegrations ?? []) as GroupId[];
    const fnFilter = deployFilterFor(enabled);
    const onlyFilter = ["firestore:rules", "firestore:indexes", ...fnFilter].join(",");
    log.info(`Deploying ${fnFilter.length} functions (groups: core${enabled.length ? "+" + enabled.join("+") : ""}).`);
    const deployArgs = [
      "deploy",
      "--only",
      onlyFilter,
      `--project=${projectId}`,
      "--non-interactive",
      "--force",
    ];
    const sp = log.spinner(`firebase deploy (rules, indexes, functions) → ${projectId}`);
    const tryDeploy = () => {
      const r = run("firebase", deployArgs, {capture: true, allowFail: true});
      const failures = (r.stdout + "\n" + r.stderr).match(/failed to create function (\S+)/g) ?? [];
      const exitOk = r.exitCode === 0;
      const noPartial = failures.length === 0;
      return {exitOk, noPartial, failures, raw: r.stdout + r.stderr};
    };
    try {
      let result = tryDeploy();
      if (!result.exitOk || !result.noPartial) {
        sp.update(
          result.failures.length > 0
            ? `Partial deploy: ${result.failures.length} trigger(s) failed (Eventarc IAM propagation). Retrying in 60s...`
            : "First deploy failed; retrying in 60s...",
        );
        await new Promise((r) => setTimeout(r, 60_000));
        result = tryDeploy();
        if (!result.exitOk || !result.noPartial) {
          // One more retry after a longer wait — sometimes Eventarc IAM
          // can take 2+ minutes to propagate on a brand-new project.
          sp.update("Second attempt still partial; retrying in 90s...");
          await new Promise((r) => setTimeout(r, 90_000));
          result = tryDeploy();
        }
      }
      if (!result.exitOk || !result.noPartial) {
        sp.fail();
        log.error(
          result.failures.length > 0
            ? `Deploy still failing on these functions after retries: ${result.failures.join(", ")}`
            : "Deploy still failing after retries",
        );
        throw new Error(`firebase deploy failed (exit ${result.exitOk ? "0 with partial failures" : "non-zero"})`);
      }
      sp.stop("Deploy succeeded (all functions created).");
    } catch (err) {
      sp.fail();
      throw err;
    }

    // 3. Capture sidecarProxy URL + patch web/apphosting.yaml.
    let sidecarProxyUrl: string | undefined;
    try {
      sidecarProxyUrl = runCapture("gcloud", [
        "run",
        "services",
        "describe",
        "sidecarproxy",
        `--region=${region}`,
        `--project=${projectId}`,
        "--format=value(status.url)",
      ]);
    } catch {
      log.warn("sidecarproxy Cloud Run service not found — was it renamed?");
    }
    if (sidecarProxyUrl) {
      state.artifacts.sidecarProxyUrl = sidecarProxyUrl;
      log.success(`sidecarProxy URL: ${sidecarProxyUrl}`);

      const yamlPath = resolve(cwd, "web", "apphosting.yaml");
      if (existsSync(yamlPath)) {
        const yaml = readFileSync(yamlPath, "utf8").replace(
          /(- variable: VITE_SIDECAR_PROXY_URL\s*\n\s*value:\s*)\S+/,
          `$1${sidecarProxyUrl}`,
        );
        writeFileSync(yamlPath, yaml);
        log.info(`Patched web/apphosting.yaml → VITE_SIDECAR_PROXY_URL = ${sidecarProxyUrl}`);
      }
    }

    // 4. SIDECAR_URL secret → VM external IP (sidecarProxy reads at runtime).
    //    Skipped when OpenClaw was not provisioned — sidecarProxy will return
    //    "not configured" until a VM is added later.
    const vm = state.artifacts.openclawVm;
    if (state.inputs.provisionOpenclaw === false || !vm?.externalIp) {
      log.info("Skipping SIDECAR_URL secret (no OpenClaw VM provisioned). sidecarProxy stays in 'not configured' state.");
    } else if (vm?.externalIp) {
      const sidecarUrl = `http://${vm.externalIp}:8081`;
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

    // 5. Commit the patched web/apphosting.yaml so the next git push (which
    //    triggers App Hosting auto-deploy) carries the real sidecarProxy URL.
    try {
      const status = runCapture("git", ["status", "--porcelain"], {cwd});
      if (status.trim()) {
        run("git", ["add", "web/apphosting.yaml"], {cwd, capture: true});
        run("git", ["commit", "-m", "chore(installer): pin sidecarProxy URL in apphosting.yaml"], {cwd, capture: true});
        log.info("Committed apphosting.yaml update.");
        // Push if a remote exists; ignore failures (repo may be local-only).
        const remotes = runCapture("git", ["remote"], {cwd, allowFail: true} as never);
        if (remotes.split("\n").includes("origin")) {
          try {
            run("git", ["push", "origin", "main"], {cwd, capture: true});
            log.info("Pushed to origin/main.");
          } catch (err) {
            log.warn(`git push failed (push manually): ${(err as Error).message.split("\n")[0]}`);
          }
        }
      }
    } catch (err) {
      log.warn(`commit step skipped: ${(err as Error).message.split("\n")[0]}`);
    }
  },
};
