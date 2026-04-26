import {gcloud} from "../lib/gcloud.ts";
import type {Step} from "../lib/types.ts";

const REQUIRED_APIS = [
  // Firebase + Firestore
  "firebase.googleapis.com",
  "firestore.googleapis.com",
  "firebasestorage.googleapis.com",
  "firebaserules.googleapis.com",
  "identitytoolkit.googleapis.com",
  // Hosting + Functions
  "firebasehosting.googleapis.com",
  "firebaseapphosting.googleapis.com",
  "cloudfunctions.googleapis.com",
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  // Compute (OpenClaw VM)
  "compute.googleapis.com",
  "iap.googleapis.com",
  // IAM + Secrets
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "secretmanager.googleapis.com",
  // Misc
  "logging.googleapis.com",
  "monitoring.googleapis.com",
  "storage.googleapis.com",
  "serviceusage.googleapis.com",
  "cloudresourcemanager.googleapis.com",
] as const;

export const enableApisStep: Step = {
  id: "05-enable-apis",
  title: "Enable required GCP APIs",
  idempotent: true,
  async run({state, log}) {
    const {projectId} = state.inputs;
    if (!projectId) throw new Error("projectId missing");

    // gcloud caps `services enable` at 20 per call (SU_MAX_BATCH_SIZE_EXCEEDED).
    // Chunk into batches of 20 — `services enable` is idempotent so re-running
    // an already-enabled service is a no-op.
    const BATCH = 20;
    const spinner = log.spinner(`Enabling ${REQUIRED_APIS.length} APIs (this can take a few minutes)`);
    try {
      for (let i = 0; i < REQUIRED_APIS.length; i += BATCH) {
        const slice = REQUIRED_APIS.slice(i, i + BATCH);
        spinner.update(`Enabling APIs ${i + 1}–${Math.min(i + BATCH, REQUIRED_APIS.length)} of ${REQUIRED_APIS.length}`);
        gcloud(["services", "enable", ...slice, `--project=${projectId}`]);
      }
      spinner.stop(`Enabled ${REQUIRED_APIS.length} APIs.`);
    } catch (err) {
      spinner.fail();
      throw err;
    }

    // Force-provision service agents that Cloud Functions triggers depend on.
    // Without this, the first deploy after APIs-enable fails on Firestore
    // triggers ("Permission denied while using the Eventarc Service Agent")
    // because the SA hasn't been bootstrapped yet — it normally lazy-creates
    // on first usage but `firebase deploy` doesn't wait for propagation.
    const sp2 = log.spinner("Provisioning Eventarc + Pub/Sub service agents");
    try {
      for (const svc of ["eventarc.googleapis.com", "pubsub.googleapis.com"]) {
        gcloud(["beta", "services", "identity", "create", `--service=${svc}`, `--project=${projectId}`], {
          allowFail: true,
          capture: true,
        });
      }
      sp2.stop("Service agents provisioned.");
    } catch (err) {
      sp2.fail();
      throw err;
    }
  },
};
