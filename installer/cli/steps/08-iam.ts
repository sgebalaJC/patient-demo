import {gcloud} from "../lib/gcloud.ts";
import type {Step} from "../lib/types.ts";

/**
 * Bind required IAM roles. Two critical bindings (per CLAUDE.md "Per-fork setup"):
 *   1. Compute SA self `tokenCreator` — needed for createCustomToken (phone-OTP + bootstrap trigger).
 *   2. Compute SA `secretAccessor` — Cloud Functions read secrets at runtime.
 *
 * Plus we create the dedicated openclaw-vm SA up front so step 09 can attach it.
 */
export const iamStep: Step = {
  id: "08-iam",
  title: "Configure IAM bindings",
  idempotent: true,
  async run({state, log}) {
    const {projectId} = state.inputs;
    const projectNumber = state.artifacts.projectNumber;
    if (!projectId || !projectNumber) throw new Error("prerequisites missing — run gcp-project first");

    const computeSa = `${projectNumber}-compute@developer.gserviceaccount.com`;

    // 1. Compute SA → tokenCreator on itself.
    addBinding(projectId, `serviceAccount:${computeSa}`, "roles/iam.serviceAccountTokenCreator", {
      onSelf: computeSa,
      log,
    });

    // 2. Compute SA → secretAccessor on the project (so Functions read SM at runtime).
    addProjectBinding(projectId, `serviceAccount:${computeSa}`, "roles/secretmanager.secretAccessor", log);

    // 3. Create the dedicated openclaw VM SA (used by step 09).
    const openclawSa = `openclaw-vm@${projectId}.iam.gserviceaccount.com`;
    const exists = (() => {
      const r = gcloud(["iam", "service-accounts", "describe", openclawSa, `--project=${projectId}`], {
        allowFail: true,
        capture: true,
      });
      return r.exitCode === 0;
    })();
    if (!exists) {
      const sp = log.spinner(`Creating SA openclaw-vm`);
      try {
        gcloud([
          "iam",
          "service-accounts",
          "create",
          "openclaw-vm",
          "--display-name=OpenClaw VM runtime SA",
          `--project=${projectId}`,
        ]);
        sp.stop(`Created openclaw-vm SA.`);
      } catch (err) {
        sp.fail();
        throw err;
      }
    } else {
      log.info("openclaw-vm SA already exists.");
    }

    // 4. openclaw-vm SA roles: secretAccessor + datastore.user + logging.logWriter + storage.objectViewer.
    for (const role of [
      "roles/secretmanager.secretAccessor",
      "roles/datastore.user",
      "roles/logging.logWriter",
      "roles/storage.objectViewer",
    ]) {
      addProjectBinding(projectId, `serviceAccount:${openclawSa}`, role, log);
    }

    // 5. Cloud Build P4SA — Secret Manager admin for `gcloud builds
    //    connections create github` (used by old step 13 path). The P4SA
    //    is auto-created when the Cloud Build API is enabled (step 05).
    const cloudBuildP4SA = `service-${projectNumber}@gcp-sa-cloudbuild.iam.gserviceaccount.com`;
    addProjectBinding(projectId, `serviceAccount:${cloudBuildP4SA}`, "roles/secretmanager.admin", log);

    // 6. Default Cloud Build SA — used by the in-app `enableIntegration`
    //    callable to run `firebase deploy --only functions:<group>` after
    //    admin connects an integration. Needs:
    //    - cloudfunctions.developer: deploy/update functions
    //    - firebase.admin: firebase-tools needs this for deploy
    //    - iam.serviceAccountUser on the compute SA: deploy "as" the compute SA
    //    - secretmanager.secretAccessor: functions read secrets at runtime
    const cloudBuildSA = `${projectNumber}@cloudbuild.gserviceaccount.com`;
    for (const role of [
      "roles/cloudfunctions.developer",
      "roles/firebase.admin",
      "roles/secretmanager.secretAccessor",
      "roles/storage.objectViewer", // pull source from gs://<project>-installer-source/
    ]) {
      addProjectBinding(projectId, `serviceAccount:${cloudBuildSA}`, role, log);
    }
    // Cloud Build SA must be allowed to "act as" the compute SA (the runtime
    // identity the deployed functions use).
    try {
      gcloud(
        [
          "iam",
          "service-accounts",
          "add-iam-policy-binding",
          computeSa,
          `--member=serviceAccount:${cloudBuildSA}`,
          "--role=roles/iam.serviceAccountUser",
          `--project=${projectId}`,
        ],
        {capture: true},
      );
      log.info(`Bound roles/iam.serviceAccountUser → ${cloudBuildSA} on compute SA`);
    } catch (err) {
      log.warn(`Cloud Build → compute-SA binding failed: ${(err as Error).message.split("\n")[0]}`);
    }
  },
};

function addProjectBinding(projectId: string, member: string, role: string, log: import("../lib/types.ts").Logger): void {
  // gcloud projects add-iam-policy-binding is idempotent.
  try {
    gcloud([
      "projects",
      "add-iam-policy-binding",
      projectId,
      `--member=${member}`,
      `--role=${role}`,
      "--condition=None",
    ], {capture: true});
    log.info(`Bound ${role} → ${member}`);
  } catch (err) {
    log.warn(`Binding ${role} → ${member} returned non-zero: ${(err as Error).message.split("\n")[0]}`);
  }
}

function addBinding(
  projectId: string,
  member: string,
  role: string,
  opts: {onSelf: string; log: import("../lib/types.ts").Logger},
): void {
  // SA self-binding (member = SA, resource = same SA).
  try {
    gcloud(
      [
        "iam",
        "service-accounts",
        "add-iam-policy-binding",
        opts.onSelf,
        `--member=${member}`,
        `--role=${role}`,
        `--project=${projectId}`,
      ],
      {capture: true},
    );
    opts.log.info(`Bound ${role} → ${member} (on self ${opts.onSelf})`);
  } catch (err) {
    opts.log.warn(`Self-binding ${role} returned non-zero: ${(err as Error).message.split("\n")[0]}`);
  }
}
