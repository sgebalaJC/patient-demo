import {randomBytes} from "node:crypto";
import {firebase, gcloud, exists} from "../lib/gcloud.ts";
import type {Step} from "../lib/types.ts";

interface SecretSpec {
  name: string;
  /** Function returning the value to seed (only invoked when the secret is being created). */
  value: () => string;
  /** When true, also `firebase apphosting:secrets:grantaccess` to the App Hosting backend. */
  grantApphosting?: boolean;
}

/**
 * Every Cloud Function that declares `defineSecret(NAME)` requires that
 * secret to exist before `firebase deploy --non-interactive` will run.
 * We seed all declared secrets with placeholder values up-front; the
 * Integrations admin panel + post-install steps overwrite real values.
 */
const PLACEHOLDER = "PLACEHOLDER_REPLACE_VIA_INTEGRATIONS_PANEL";

export const secretsStep: Step = {
  id: "07-secrets",
  title: "Seed Secret Manager values",
  idempotent: true,
  async run({state, log}) {
    const {projectId, provisionApphosting} = state.inputs;
    const cfg = state.artifacts.firebaseConfig;
    const backendId = state.artifacts.apphostingBackendId;
    if (!projectId || !cfg || !backendId) throw new Error("prerequisites missing — run firebase-init first");
    // Skip apphosting:secrets:grantaccess entirely when no backend will be created.
    const willGrantApphosting = provisionApphosting !== false;

    const specs: SecretSpec[] = [
      // Real values
      {name: "VITE_FIREBASE_API_KEY", value: () => cfg.apiKey, grantApphosting: true},
      {name: "openclaw_gateway_token", value: () => randomBytes(48).toString("hex")},

      // Cloud Function defineSecret() declarations — seeded with placeholders
      // so non-interactive deploys succeed. Overwritten later via the
      // Integrations panel or by step 12 (SIDECAR_URL when VM exists).
      {name: "SIDECAR_URL", value: () => "http://placeholder.invalid:8081"},
      {name: "SIDECAR_API_KEY", value: () => randomBytes(48).toString("hex")},

      {name: "SIGNALWIRE_AUTH_TOKEN", value: () => PLACEHOLDER},
      {name: "SIGNALWIRE_PROJECT_ID", value: () => PLACEHOLDER},
      {name: "SIGNALWIRE_SIGNING_KEY", value: () => PLACEHOLDER},
      {name: "SIGNALWIRE_SPACE_URL", value: () => PLACEHOLDER},
      {name: "SIGNALWIRE_SMS_FROM", value: () => PLACEHOLDER},

      {name: "STRIPE_SECRET_KEY", value: () => PLACEHOLDER},
      {name: "STRIPE_WEBHOOK_SECRET", value: () => PLACEHOLDER},

      {name: "PLATFORM_STRIPE_SECRET_KEY", value: () => PLACEHOLDER},
      {name: "PLATFORM_STRIPE_WEBHOOK_SECRET", value: () => PLACEHOLDER},
      {name: "PLATFORM_STRIPE_PRICE_MONTHLY", value: () => PLACEHOLDER},
      {name: "PLATFORM_STRIPE_PRICE_ANNUAL", value: () => PLACEHOLDER},
      {name: "PLATFORM_STRIPE_PRICE_TOPUP", value: () => PLACEHOLDER},

      {name: "GOOGLE_SA_KEY", value: () => PLACEHOLDER},
      {name: "SLACK_ALERTS_WEBHOOK_URL", value: () => PLACEHOLDER},
    ];

    state.artifacts.createdSecrets ??= [];

    for (const spec of specs) {
      const present = exists(["secrets", "describe", spec.name, `--project=${projectId}`]);
      if (!present) {
        const sp = log.spinner(`Creating secret ${spec.name}`);
        try {
          gcloud(
            ["secrets", "create", spec.name, "--replication-policy=automatic", `--project=${projectId}`, "--data-file=-"],
            {input: spec.value()},
          );
          sp.stop(`Created ${spec.name}.`);
        } catch (err) {
          sp.fail();
          throw err;
        }
      } else {
        log.info(`Secret ${spec.name} already exists; not overwriting.`);
      }
      if (!state.artifacts.createdSecrets.includes(spec.name)) state.artifacts.createdSecrets.push(spec.name);

      if (spec.grantApphosting && willGrantApphosting) {
        try {
          firebase(["apphosting:secrets:grantaccess", spec.name, `--backend=${backendId}`, `--project=${projectId}`]);
          log.info(`Granted App Hosting backend ${backendId} access to ${spec.name}.`);
        } catch (err) {
          log.warn(
            `grantaccess for ${spec.name} returned non-zero (often safe-to-ignore on resume): ${(err as Error).message.split("\n")[0]}`,
          );
        }
      }
    }
  },
};
