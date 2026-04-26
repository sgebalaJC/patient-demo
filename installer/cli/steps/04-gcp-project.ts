import {assertAuthed, exists, gcloud, gcloudJson, gcloudText} from "../lib/gcloud.ts";
import type {Step} from "../lib/types.ts";

interface ProjectInfo {
  projectNumber: string;
  projectId: string;
  name: string;
  lifecycleState: string;
}

export const gcpProjectStep: Step = {
  id: "04-gcp-project",
  title: "Create GCP project + link billing",
  idempotent: true,
  async run({state, log}) {
    assertAuthed();
    const {projectId, projectName, billingAccountId} = state.inputs;
    if (!projectId || !projectName || !billingAccountId) throw new Error("inputs missing");

    if (exists(["projects", "describe", projectId])) {
      log.info(`GCP project ${projectId} already exists; skipping create.`);
    } else {
      const spinner = log.spinner(`Creating GCP project ${projectId}`);
      try {
        gcloud(["projects", "create", projectId, `--name=${projectName}`, "--set-as-default"]);
        spinner.stop(`Created project ${projectId}.`);
      } catch (err) {
        spinner.fail();
        throw err;
      }
    }

    // Capture project number for later IAM bindings.
    const info = gcloudJson<ProjectInfo>(["projects", "describe", projectId]);
    state.artifacts.projectNumber = info.projectNumber;
    log.info(`Project number: ${info.projectNumber}`);

    // Link billing.
    const current = gcloudText(
      ["beta", "billing", "projects", "describe", projectId, "--format=value(billingAccountName)"],
      {allowFail: true},
    );
    const wantSuffix = `billingAccounts/${billingAccountId}`;
    if (current === wantSuffix) {
      log.info(`Billing already linked to ${billingAccountId}.`);
    } else {
      const spinner = log.spinner(`Linking billing account ${billingAccountId}`);
      try {
        gcloud(["beta", "billing", "projects", "link", projectId, `--billing-account=${billingAccountId}`]);
        spinner.stop(`Billing linked.`);
      } catch (err) {
        spinner.fail();
        throw err;
      }
    }
  },
};
