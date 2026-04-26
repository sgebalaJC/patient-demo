/**
 * Installer support callables — invoked by /admin/install in the deployed
 * portal to drive post-deploy setup that needs server-side privilege
 * (sidecar key, signed Firestore writes).
 *
 * Heavy CLI work (project create, IAM, VM provision) lives in
 * installer/cli/* and runs on the operator's machine — this module is the
 * narrow Cloud Function surface the wizard actually calls.
 */

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import {GoogleAuth} from "google-auth-library";
import {requireSuperAdmin} from "./lib/auth.js";
import {SIDECAR_URL_SECRET, SIDECAR_API_KEY_SECRET, sidecarUrlEnv, sidecarApiKeyEnv, syncIntegrationSkill} from "./lib/sidecar.js";

interface SyncResult {
  ok: boolean;
  /** Single-paragraph human-readable status, surfaced verbatim by the wizard. */
  output: string;
  /** Per-action results so the wizard can show finer detail later. */
  details?: {
    healthOk: boolean;
    skillsSynced: number;
    skillsErrors: string[];
  };
}

/**
 * Wizard's "Sync agent workspace + ping gateway" button.
 *
 * Steps:
 *   1. GET sidecar /healthz — proves the gateway is reachable
 *      (CLI installer step 11 already pushed the rendered openclaw.json).
 *   2. POST /skills/sync once with `enabled: true` to ensure the active
 *      skill set on the VM matches the manifest.
 *
 * Pushing a fresh openclaw.json from a Cloud Function would require SSH/SCP
 * credentials we don't want sitting in Function env. The installer CLI owns
 * the upload-to-GCS path; the VM startup script pulls on next reset.
 */
export const installerSyncAgentWorkspace = onCall(
  {
    secrets: [SIDECAR_URL_SECRET, SIDECAR_API_KEY_SECRET],
  },
  async (request): Promise<SyncResult> => {
    requireSuperAdmin(request);

    const url = sidecarUrlEnv();
    const key = sidecarApiKeyEnv();
    if (!key || url.includes("YOUR_VPS_IP")) {
      throw new HttpsError(
        "failed-precondition",
        "SIDECAR_URL / SIDECAR_API_KEY not yet configured. Re-run the installer CLI through step 12 (deploy-first), which sets them.",
      );
    }

    const details = {healthOk: false, skillsSynced: 0, skillsErrors: [] as string[]};

    // 1. Healthz
    try {
      const r = await fetch(`${url}/healthz`, {signal: AbortSignal.timeout(5000)});
      details.healthOk = r.ok;
      if (!r.ok) details.skillsErrors.push(`healthz HTTP ${r.status}`);
    } catch (err) {
      details.skillsErrors.push(`healthz unreachable: ${(err as Error).message}`);
    }

    if (!details.healthOk) {
      return {
        ok: false,
        output: `Gateway unreachable at ${url}. Check that the OpenClaw VM is running and the firewall opens 8081 to the proxy. ${details.skillsErrors.join("; ")}`,
        details,
      };
    }

    // 2. Skills sync — sidecar's /skills/sync is per-integration ({integrationId, enabled}),
    //    so enumerate the integrations doc set and call once per id. Mirrors the
    //    existing pattern at functions/src/index.ts:2476 etc.
    try {
      const snap = await admin.firestore().collection("integrations").get();
      for (const doc of snap.docs) {
        const data = doc.data() as {enabled?: boolean};
        const enabled = !!data.enabled;
        try {
          await syncIntegrationSkill(doc.id, enabled);
          details.skillsSynced += 1;
        } catch (err) {
          details.skillsErrors.push(`${doc.id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      details.skillsErrors.push(`enumerating integrations failed: ${(err as Error).message}`);
    }

    const ok = details.healthOk && details.skillsErrors.length === 0;
    logger.info(`[installer] sync ok=${ok}`, details);
    return {
      ok,
      output: ok
        ? `Gateway healthy. Synced ${details.skillsSynced} skill(s).`
        : `Partial sync — ${details.skillsErrors.join("; ")}`,
      details,
    };
  },
);

/**
 * For each integration group, return which functions ARE deployed and which
 * are MISSING. Powers the per-integration deploy controls in /admin/agent →
 * Integrations: shows "5/5 deployed" or "0/5 — run this command".
 *
 * The function-name lists are mirrored from `installer/cli/lib/function-groups.ts`
 * — keep in sync if you add new functions to a group.
 */
const FUNCTION_GROUPS: Record<string, readonly string[]> = {
  "google-workspace": [
    "googleWorkspaceAuthorize",
    "googleWorkspaceCallback",
    "saveGoogleWorkspaceServiceAccount",
    "disconnectGoogleWorkspace",
    "googleWorkspaceProxy",
  ],
  signalwire: [
    "saveSignalwireCredentials",
    "disconnectSignalwire",
    "signalwireFaxWebhook",
    "sendOutboundFax",
    "signalwireFaxStatusWebhook",
    "deleteOutboundFax",
    "retryFailedFaxes",
    "sendFaxEmail",
    "reprocessFax",
    "updateFaxDraft",
    "markFaxJunk",
    "attachFaxToDrChrono",
    "detachFaxFromDrChrono",
    "deleteFax",
    "getFaxPdfUrl",
  ],
  stripe: [
    "createCheckoutSession",
    "cancelSubscription",
    "stripeWebhook",
    "createPlatformCheckoutSession",
    "createPlatformTopupSession",
    "createPlatformBillingPortalSession",
    "cancelPlatformSubscription",
    "resumePlatformSubscription",
    "platformStripeWebhook",
  ],
  pa: [
    "createPriorAuth",
    "updatePriorAuthStatus",
    "submitPolicyReview",
    "runChartGapCheck",
    "policyFetcherCron",
    "triggerPolicyRefresh",
    "onPriorAuthWrite",
    "paFollowupCron",
    "extractTopPayers",
    "seedPaData",
  ],
  "ehr-drchrono": ehrCallables("drchrono"),
  "ehr-athena": ehrCallables("athena"),
  "ehr-elation": ehrCallables("elation"),
  "ehr-ecw": ehrCallables("ecw"),
  "ehr-nextgen": ehrCallables("nextgen"),
  "ehr-tebra": ehrCallables("tebra"),
  "ehr-greenway": ehrCallables("greenway"),
  "ehr-pfusion": ehrCallables("pfusion"),
  "ehr-cerner": ehrCallables("cerner"),
  "ehr-epic": ehrCallables("epic"),
};

function ehrCallables(id: string): string[] {
  return [`${id}Authorize`, `${id}Callback`, `${id}SaveCredentials`, `${id}Disconnect`, `${id}SetEnabled`];
}

interface IntegrationDeployStatus {
  integrationId: string;
  expected: string[];
  deployed: string[];
  missing: string[];
  /** Copy-paste-ready CLI command to deploy missing functions. */
  deployCommand: string;
}

interface BuildSubmitResponse {
  /** Long-running operation name, e.g. operations/build/<projectNumber>/<buildId>. */
  operationName: string;
  /** Cloud Build id, used for status polling. */
  buildId: string;
}

/**
 * Trigger a Cloud Build that runs `firebase deploy --only functions:<list>`
 * for the requested integration group. The build pulls source from
 * gs://<project>-installer-source/functions-source.tar.gz (uploaded by
 * installer step 12b). Returns a buildId that the UI can poll via
 * getDeployBuildStatus.
 */
export const enableIntegration = onCall(async (request): Promise<BuildSubmitResponse> => {
  requireSuperAdmin(request);
  const integrationId = (request.data as {integrationId?: string})?.integrationId;
  if (!integrationId || !(integrationId in FUNCTION_GROUPS)) {
    throw new HttpsError("invalid-argument", `unknown integrationId: ${integrationId}`);
  }
  const fns = FUNCTION_GROUPS[integrationId];
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  const sourceBucket = `${projectId}-installer-source`;
  const sourceObject = "functions-source.tar.gz";
  const filter = fns.map((f) => `functions:${f}`).join(",");
  const deployedFunctionsJson = JSON.stringify(fns);

  // Firestore REST endpoint for the installed-integrations doc the Cloud
  // Build inline step PATCHes when the deploy finishes. See the build steps
  // below for the actual Firestore writes.
  const firestoreDocPath = `projects/${projectId}/databases/(default)/documents/installed-integrations/${integrationId}`;
  const firestoreUrl = `https://firestore.googleapis.com/v1/${firestoreDocPath}`;

  const buildSpec = {
    source: {
      storageSource: {bucket: sourceBucket, object: sourceObject},
    },
    // Two steps: (1) deploy with bash trap that captures pass/fail status,
    // (2) write terminal status to Firestore. We use a trap rather than two
    // separate Cloud Build steps because Cloud Build doesn't have a clean
    // "always-run, on-failure" semantic for an inline build's last step.
    steps: [
      {
        name: "node:22",
        entrypoint: "bash",
        args: [
          "-c",
          [
            "set -e",
            // Read the bundle's version.json so we can record which version
            // we deployed FROM.
            `BUNDLE_VERSION=$(cat version.json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin).get("version",""))' 2>/dev/null || echo unknown)`,
            `echo "[deploy] bundle version: $BUNDLE_VERSION"`,
            "npm install -g firebase-tools@latest --silent",
            "cd functions && npm ci --silent && cd ..",
            // Deploy. If it fails, the trap below writes status='failed';
            // otherwise we fall through to status='deployed'.
            `set +e`,
            `firebase deploy --only ${filter} --project=${projectId} --non-interactive --force`,
            `DEPLOY_RC=$?`,
            `set -e`,
            // Write the result to Firestore via REST (Cloud Build SA has firebase.admin).
            `TOKEN=$(curl -s -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')`,
            `if [ "$DEPLOY_RC" = "0" ]; then`,
            `  STATUS=deployed`,
            `else`,
            `  STATUS=failed`,
            `fi`,
            // Patch installed-integrations doc with the result. updateMask
            // ensures we don't blow away the deployedAt set by enableIntegration.
            `curl -fsS -X PATCH \\
              -H "Authorization: Bearer $TOKEN" \\
              -H "Content-Type: application/json" \\
              -d "{\\"fields\\":{\\"status\\":{\\"stringValue\\":\\"$STATUS\\"},\\"lastBuildStatus\\":{\\"stringValue\\":\\"$STATUS\\"},\\"lastBuildFinishedAt\\":{\\"timestampValue\\":\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\"},\\"deployedFromBundle\\":{\\"stringValue\\":\\"$BUNDLE_VERSION\\"}}}" \\
              "${firestoreUrl}?updateMask.fieldPaths=status&updateMask.fieldPaths=lastBuildStatus&updateMask.fieldPaths=lastBuildFinishedAt&updateMask.fieldPaths=deployedFromBundle" || echo "[deploy] firestore PATCH failed (non-fatal)"`,
            // Re-exit with the deploy's RC so Cloud Build marks the build
            // SUCCESS / FAILURE accordingly.
            `exit $DEPLOY_RC`,
          ].join("\n"),
        ],
      },
    ],
    timeout: "1200s",
    options: {logging: "CLOUD_LOGGING_ONLY"},
    substitutions: {_INTEGRATION_ID: integrationId, _DEPLOYED_FUNCTIONS: deployedFunctionsJson},
  };

  try {
    const auth = new GoogleAuth({scopes: ["https://www.googleapis.com/auth/cloud-platform"]});
    const client = await auth.getClient();
    const tokenResp = await client.getAccessToken();
    const accessToken = tokenResp.token;
    if (!accessToken) throw new Error("could not obtain access token");
    const r = await fetch(
      `https://cloudbuild.googleapis.com/v1/projects/${projectId}/builds`,
      {
        method: "POST",
        headers: {Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json"},
        body: JSON.stringify(buildSpec),
      },
    );
    if (!r.ok) {
      const body = await r.text();
      throw new HttpsError("internal", `Cloud Build submit failed: HTTP ${r.status} ${body.slice(0, 500)}`);
    }
    const op = (await r.json()) as {name?: string; metadata?: {build?: {id?: string}}};
    const operationName = op.name ?? "";
    const buildId = op.metadata?.build?.id ?? "";
    if (!buildId) throw new HttpsError("internal", "Cloud Build response missing build.id");
    logger.info(`[installer] enableIntegration ${integrationId} → build ${buildId}`);

    // Record "deploying" state immediately so the admin UI sees in-flight
    // status even before the Cloud Build emits its first log line. The
    // build's final step PATCHes status='deployed'/'failed' on completion.
    try {
      await admin.firestore().doc(`installed-integrations/${integrationId}`).set(
        {
          integrationId,
          status: "deploying",
          deployedFunctions: fns,
          deployedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastBuildId: buildId,
          lastBuildStartedAt: admin.firestore.FieldValue.serverTimestamp(),
          // deployedFromBundle gets PATCHed by the build's last step once it
          // reads version.json; keep the field absent for now.
        },
        {merge: true},
      );
    } catch (mirrorErr) {
      logger.warn(
        `[installer] could not write installed-integrations/${integrationId} (non-fatal): ${(mirrorErr as Error).message}`,
      );
    }

    return {operationName, buildId};
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", (err as Error).message);
  }
});

interface BuildStatus {
  buildId: string;
  status: string; // QUEUED | WORKING | SUCCESS | FAILURE | INTERNAL_ERROR | TIMEOUT | CANCELLED | EXPIRED
  startTime?: string;
  finishTime?: string;
  logUrl?: string;
}

export const getDeployBuildStatus = onCall(async (request): Promise<BuildStatus> => {
  requireSuperAdmin(request);
  const buildId = (request.data as {buildId?: string})?.buildId;
  if (!buildId) throw new HttpsError("invalid-argument", "buildId required");
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  try {
    const auth = new GoogleAuth({scopes: ["https://www.googleapis.com/auth/cloud-platform"]});
    const client = await auth.getClient();
    const tokenResp = await client.getAccessToken();
    const accessToken = tokenResp.token;
    if (!accessToken) throw new Error("could not obtain access token");
    const r = await fetch(
      `https://cloudbuild.googleapis.com/v1/projects/${projectId}/builds/${buildId}`,
      {headers: {Authorization: `Bearer ${accessToken}`}},
    );
    if (!r.ok) {
      throw new HttpsError("internal", `Cloud Build status failed: HTTP ${r.status}`);
    }
    const j = (await r.json()) as Record<string, unknown>;
    return {
      buildId,
      status: (j.status as string) ?? "UNKNOWN",
      startTime: j.startTime as string | undefined,
      finishTime: j.finishTime as string | undefined,
      logUrl: j.logUrl as string | undefined,
    };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", (err as Error).message);
  }
});

export const getIntegrationFunctionStatus = onCall(async (request): Promise<IntegrationDeployStatus> => {
  requireSuperAdmin(request);
  const integrationId = (request.data as {integrationId?: string})?.integrationId;
  if (!integrationId || !(integrationId in FUNCTION_GROUPS)) {
    throw new HttpsError("invalid-argument", `unknown integrationId: ${integrationId}`);
  }
  const expected = [...FUNCTION_GROUPS[integrationId]];
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  const region = "us-west1";

  let deployed: string[] = [];
  try {
    const auth = new GoogleAuth({scopes: ["https://www.googleapis.com/auth/cloud-platform"]});
    const client = await auth.getClient();
    const tokenResp = await client.getAccessToken();
    const accessToken = tokenResp.token;
    if (!accessToken) throw new Error("could not obtain access token");
    const url = `https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/${region}/functions`;
    const r = await fetch(url, {headers: {Authorization: `Bearer ${accessToken}`}});
    if (r.ok) {
      const j = (await r.json()) as {functions?: Array<{name: string}>};
      const present = new Set(
        (j.functions ?? []).map((f) => f.name.replace(/.*\/functions\//, "")),
      );
      deployed = expected.filter((fn) => present.has(fn));
    }
  } catch (err) {
    logger.warn(`[installer] could not list functions for ${integrationId}: ${(err as Error).message}`);
  }

  const missing = expected.filter((fn) => !deployed.includes(fn));
  const filter = expected.map((fn) => `functions:${fn}`).join(",");
  const deployCommand = `firebase deploy --only ${filter} --project=${projectId} --force`;

  return {integrationId, expected, deployed, missing, deployCommand};
});
