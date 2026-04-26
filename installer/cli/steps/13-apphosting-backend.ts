import {run, runCapture} from "../lib/exec.ts";
import type {Step} from "../lib/types.ts";

const APPHOSTING_REGION = "us-central1";

interface BackendInfo {
  name: string;
  uri?: string;
  codebase?: {repository?: string; rootDirectory?: string};
}

interface BackendsList {
  backends?: BackendInfo[];
}

/**
 * Provision the App Hosting backend.
 *
 * Honest constraint: the only headless path to create an App Hosting backend
 * needs a Developer Connect `gitRepositoryLinks` resource, which in turn
 * needs a GitHub OAuth token already stored in Secret Manager. There is no
 * CLI command today that produces that OAuth token without a browser-based
 * authorize click — the `firebase apphosting:backends:create` interactive
 * CLI handles it under the hood, and Firebase Console handles it in the
 * browser; nothing exposes it as a fully scriptable API.
 *
 * So this step:
 *   1. Detects whether a backend already exists (re-runs after manual setup)
 *   2. If yes: captures the URL into state.artifacts.apphostingUrl
 *   3. If no: opens the Firebase Console App Hosting page in the operator's
 *      browser + prints a clear command to run, then exits cleanly. Operator
 *      sets up the backend (~2 min in the console), re-runs --rerun 13 to
 *      capture the URL.
 *
 * After the one-time setup, every `git push origin main` auto-deploys via
 * Cloud Build → App Hosting, so this step is "first-fork only" friction.
 */
export const apphostingBackendStep: Step = {
  id: "13-apphosting-backend",
  title: "Provision App Hosting backend",
  idempotent: true,
  async run({state, log}) {
    const {projectId, githubRepo, provisionApphosting} = state.inputs;
    const backendId = state.artifacts.apphostingBackendId;
    if (!projectId || !backendId) throw new Error("prerequisites missing — run firebase-init first");

    if (provisionApphosting === false) {
      log.info(
        "Skipping App Hosting backend (provisionApphosting=false). Re-run with --rerun 13-apphosting-backend after flipping the flag.",
      );
      return;
    }
    if (!githubRepo) {
      log.warn(
        "No GitHub repo set in inputs — App Hosting needs a repo to track. Set inputs.githubRepo and --rerun 13-apphosting-backend, or skip via inputs.provisionApphosting=false.",
      );
      return;
    }

    // 1. Detect existing backend (idempotency).
    let backend: BackendInfo | undefined;
    try {
      const accessToken = runCapture("gcloud", ["auth", "print-access-token"]);
      const r = run(
        "curl",
        [
          "-sS",
          "-H", `Authorization: Bearer ${accessToken}`,
          `https://firebaseapphosting.googleapis.com/v1/projects/${projectId}/locations/${APPHOSTING_REGION}/backends`,
        ],
        {capture: true, allowFail: true},
      );
      if (r.exitCode === 0) {
        const list = JSON.parse(r.stdout) as BackendsList;
        backend = list.backends?.find((b) => b.name.endsWith(`/backends/${backendId}`));
      }
    } catch (err) {
      log.warn(`Could not list backends: ${(err as Error).message.split("\n")[0]}`);
    }

    if (backend) {
      const uri = backend.uri;
      if (uri) {
        state.artifacts.apphostingUrl = uri.startsWith("http") ? uri : `https://${uri}`;
        log.success(`App Hosting backend already exists. URL: ${state.artifacts.apphostingUrl}`);
      } else {
        log.info(`Backend ${backendId} exists but URL not yet provisioned (first build still running).`);
      }
      return;
    }

    // 2. No backend yet — auto-open Firebase Console + print the spec.
    const consoleUrl = `https://console.firebase.google.com/project/${projectId}/apphosting`;
    try {
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      run(opener, [consoleUrl], {capture: true, allowFail: true});
    } catch {
      /* ignore — message below shows the URL */
    }

    log.warn(
      [
        `App Hosting backend ${backendId} doesn't exist yet. There's no fully-headless CLI path`,
        `to create one (App Hosting needs a Developer Connect OAuth token that can only be minted`,
        `via a browser flow). Set it up once in the Firebase Console:`,
        ``,
        `  ${consoleUrl}`,
        ``,
        `Settings:`,
        `  Backend id:       ${backendId}`,
        `  Region:           ${APPHOSTING_REGION}`,
        `  GitHub repo:      ${githubRepo}`,
        `  Live branch:      main`,
        `  Root directory:   web`,
        ``,
        `After clicking through (~2 min), re-run:`,
        `  bun run installer/cli/create-fork.ts --target ${state.inputs.targetDir} --rerun 13-apphosting-backend`,
        ``,
        `That picks up the now-existing backend, captures its URL, and finishes the install.`,
        `Subsequent forks reuse the GitHub App install — only the per-project setup repeats.`,
      ].join("\n"),
    );
  },
};
