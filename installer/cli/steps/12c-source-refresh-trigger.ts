import {gcloud, gcloudJson} from "../lib/gcloud.ts";
import type {Step} from "../lib/types.ts";

const TRIGGER_NAME = "refresh-functions-source";
const BUILD_CONFIG = "cloudbuild-refresh-source.yaml";

interface TriggerInfo {
  name: string;
  github?: {owner?: string; name?: string};
  filename?: string;
}

/**
 * Cloud Build trigger that auto-refreshes the installer source bundle
 * (gs://<project>-installer-source/functions-source.tar.gz) on every push
 * to main that touches functions/, firebase.json, .firebaserc, or the
 * cloudbuild-refresh-source.yaml itself.
 *
 * Without this, the source bundle uploaded by step 12b at install time
 * goes stale the moment the operator pushes new function code. Subsequent
 * `enableIntegration` calls would deploy the OLD source.
 *
 * Uses the Cloud Build GitHub App (legacy push trigger). Requires:
 *   - the App is installed on the operator's GitHub account
 *     (https://github.com/apps/google-cloud-build) — verified once per
 *     account; the install propagates to every project
 *   - inputs.githubRepo set on the install (we skip otherwise)
 *
 * Skipped when no githubRepo is set or when provisionApphosting=false
 * (no point auto-refreshing source for a fork that has no live admin UI).
 */
export const sourceRefreshTriggerStep: Step = {
  id: "12c-source-refresh-trigger",
  title: "Cloud Build trigger: refresh source bundle on git push",
  idempotent: true,
  async run({state, log}) {
    const {projectId, githubRepo} = state.inputs;
    if (!projectId) throw new Error("projectId missing");

    if (!githubRepo) {
      log.info("Skipping refresh trigger — no GitHub repo set in inputs.");
      return;
    }
    const [repoOwner, repoName] = githubRepo.split("/");
    if (!repoOwner || !repoName) {
      log.warn(`githubRepo "${githubRepo}" not in owner/name form; skipping trigger.`);
      return;
    }

    // Detect existing trigger (idempotency).
    let triggers: TriggerInfo[] = [];
    try {
      triggers = gcloudJson<TriggerInfo[]>(
        ["builds", "triggers", "list", `--project=${projectId}`],
      );
    } catch (err) {
      log.warn(`Could not list triggers (Cloud Build API perhaps not yet enabled?): ${(err as Error).message.split("\n")[0]}`);
      return;
    }

    const existing = triggers.find((t) => t.name === TRIGGER_NAME);
    if (existing) {
      log.info(`Trigger ${TRIGGER_NAME} already exists; skipping create.`);
      return;
    }

    const sp = log.spinner(`Creating refresh trigger ${TRIGGER_NAME} → push to main, functions/**`);
    try {
      gcloud([
        "builds",
        "triggers",
        "create",
        "github",
        `--name=${TRIGGER_NAME}`,
        `--repo-owner=${repoOwner}`,
        `--repo-name=${repoName}`,
        "--branch-pattern=^main$",
        `--build-config=${BUILD_CONFIG}`,
        // Only fire when the build config or its inputs change. Saves
        // Cloud Build minutes on UI-only / docs-only commits.
        "--included-files=functions/**,firebase.json,.firebaserc,cloudbuild-refresh-source.yaml",
        "--description=Refresh gs://<project>-installer-source/ when functions/ changes",
        `--project=${projectId}`,
      ]);
      sp.stop(`Trigger ${TRIGGER_NAME} created.`);
      log.info(
        [
          "From now on, every push to main that touches functions/** will",
          `re-package the source bundle and upload to gs://${projectId}-installer-source/.`,
          "Subsequent `enableIntegration` deploys pull from this fresh bundle.",
        ].join("\n   "),
      );
    } catch (err) {
      sp.fail();
      const msg = (err as Error).message;
      if (msg.includes("FAILED_PRECONDITION") || msg.includes("repository not found") || msg.includes("repository was not found")) {
        log.warn(
          [
            `Trigger create failed: GitHub repo binding missing.`,
            `Install the Cloud Build GitHub App at https://github.com/apps/google-cloud-build,`,
            `grant it access to ${githubRepo}, then re-run --rerun 12c-source-refresh-trigger.`,
          ].join("\n   "),
        );
        return;
      }
      throw err;
    }
  },
};
