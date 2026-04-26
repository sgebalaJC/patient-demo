import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {firebase, firebaseText, gcloud, gcloudJson} from "../lib/gcloud.ts";
import {run} from "../lib/exec.ts";
import type {Step} from "../lib/types.ts";

interface WebAppInfo {
  appId: string;
  displayName?: string;
  platform: "WEB";
}

interface WebAppConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export const firebaseInitStep: Step = {
  id: "06-firebase-init",
  title: "Initialize Firebase (Firestore, Storage, Web app)",
  idempotent: true,
  async run({state, log}) {
    const {projectId, region, targetDir, projectName} = state.inputs;
    if (!projectId || !region || !targetDir) throw new Error("inputs missing");

    // Add Firebase to the GCP project (no-op if already added).
    const isFirebase = run("firebase", ["projects:list", "--json"], {capture: true, allowFail: true});
    let alreadyFirebase = false;
    if (isFirebase.exitCode === 0) {
      try {
        const list = JSON.parse(isFirebase.stdout) as {result?: Array<{projectId: string}>};
        alreadyFirebase = !!list.result?.some((p) => p.projectId === projectId);
      } catch {
        /* ignore */
      }
    }
    if (!alreadyFirebase) {
      const sp = log.spinner(`Adding Firebase to ${projectId}`);
      try {
        firebase(["projects:addfirebase", projectId]);
        sp.stop(`Firebase enabled on ${projectId}.`);
      } catch (err) {
        sp.fail();
        throw err;
      }
    } else {
      log.info(`Firebase already on ${projectId}.`);
    }

    // Firestore database (default).
    const dbExists = (() => {
      const r = gcloud(
        ["firestore", "databases", "describe", "--database=(default)", `--project=${projectId}`],
        {allowFail: true, capture: true},
      );
      return r.exitCode === 0;
    })();
    if (!dbExists) {
      const sp = log.spinner(`Creating Firestore database in ${region}`);
      try {
        gcloud([
          "firestore",
          "databases",
          "create",
          `--location=${region}`,
          "--type=firestore-native",
          `--project=${projectId}`,
        ]);
        sp.stop(`Firestore created in ${region}.`);
      } catch (err) {
        sp.fail();
        throw err;
      }
    } else {
      log.info("Firestore database already exists.");
    }

    // Default Cloud Storage bucket — Firebase auto-provisions a `<project>.firebasestorage.app`
    // bucket on first project visit, but we explicitly ensure it exists.
    const bucketName = `${projectId}.firebasestorage.app`;
    const bucketExists = (() => {
      const r = gcloud(["storage", "buckets", "describe", `gs://${bucketName}`, `--project=${projectId}`], {
        allowFail: true,
        capture: true,
      });
      return r.exitCode === 0;
    })();
    if (!bucketExists) {
      log.info(`Default storage bucket gs://${bucketName} not yet created — Firebase will provision on first deploy.`);
    } else {
      log.info(`Storage bucket gs://${bucketName} ready.`);
    }

    // Web app — find or create.
    const apps = (() => {
      const r = run("firebase", ["apps:list", "WEB", "--json", `--project=${projectId}`], {
        capture: true,
        allowFail: true,
      });
      if (r.exitCode !== 0) return [] as WebAppInfo[];
      try {
        const j = JSON.parse(r.stdout) as {result?: WebAppInfo[]};
        return j.result ?? [];
      } catch {
        return [];
      }
    })();
    let appId = apps[0]?.appId;
    if (!appId) {
      const sp = log.spinner("Creating Firebase Web app");
      try {
        const out = firebaseText(["apps:create", "WEB", projectName ?? projectId, `--project=${projectId}`]);
        // CLI prints "App ID: 1:1234:web:abcd"
        const m = out.match(/App ID:\s*(\S+)/);
        if (!m) throw new Error(`Could not parse appId from firebase output:\n${out}`);
        appId = m[1];
        sp.stop(`Web app created (${appId}).`);
      } catch (err) {
        sp.fail();
        throw err;
      }
    } else {
      log.info(`Web app already exists: ${appId}`);
    }
    state.artifacts.firebaseAppId = appId;

    // Pull SDK config. Use --json so we get clean JSON instead of the
    // legacy JS-ish blob (which we used to regex-parse — fragile against
    // colons inside string values).
    const cfgRaw = firebaseText(["apps:sdkconfig", "WEB", appId!, `--project=${projectId}`, "--json"]);
    const cfg = parseSdkConfig(cfgRaw);
    // The apiKey IS retained in state.json: step 07 reads
    // `state.artifacts.firebaseConfig.apiKey` to seed the
    // VITE_FIREBASE_API_KEY secret in Secret Manager. Firebase web API keys
    // are public routing identifiers (Firebase Rules + App Check are the
    // real defense), so persisting to .installer-state.json is acceptable —
    // the file already lives in the operator's working dir which is
    // .gitignored by the installer's own template. Anyone with file access
    // to .installer-state.json can recover the key from the project anyway.
    state.artifacts.firebaseConfig = cfg;
    log.info(`Captured Firebase SDK config (apiKey ${cfg.apiKey.slice(0, 8)}…).`);

    // .firebaserc
    const rcPath = resolve(targetDir, ".firebaserc");
    writeFileSync(
      rcPath,
      JSON.stringify({projects: {default: projectId}}, null, 2) + "\n",
    );
    log.success(`Wrote .firebaserc → default = ${projectId}`);

    // web/apphosting.yaml — backend id derived from short, lowercase project id.
    // Trim trailing hyphens left over by the .slice(0, 32) cap; App Hosting
    // backend ids must match `^[a-z][a-z0-9-]*[a-z0-9]$`, so a final `-`
    // is rejected by the API.
    const backendId = `web-${projectId}`.slice(0, 32).replace(/-+$/, '');
    state.artifacts.apphostingBackendId = backendId;
    const yamlPath = resolve(targetDir, "web", "apphosting.yaml");
    writeFileSync(yamlPath, renderApphostingYaml(cfg, backendId));
    log.success(`Wrote web/apphosting.yaml (backend ${backendId})`);

    // Update root firebase.json's apphosting.backendId so `firebase deploy` knows the new id.
    const fbJsonPath = resolve(targetDir, "firebase.json");
    if (existsSync(fbJsonPath)) {
      const j = JSON.parse(readFileSync(fbJsonPath, "utf8")) as {apphosting?: Array<{backendId: string}>};
      if (j.apphosting?.[0]) {
        j.apphosting[0].backendId = backendId;
        writeFileSync(fbJsonPath, JSON.stringify(j, null, 2) + "\n");
        log.info(`Updated firebase.json apphosting.backendId → ${backendId}.`);
      }
    }
  },
};

function parseSdkConfig(raw: string): WebAppConfig {
  // With `--json`, firebase-tools wraps the SDK config in a `result` envelope:
  //   { "status": "success", "result": { "sdkConfig": { ... } } }
  // Tolerate variations: top-level result, result.sdkConfig, or a bare config
  // object (older CLI versions). The error message lists the shapes we tried
  // so the operator can paste the raw output if a future shape lands.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`firebase apps:sdkconfig --json did not return JSON:\n${raw.slice(0, 400)}\n${(err as Error).message}`);
  }
  const candidates: unknown[] = [];
  const env = parsed as {result?: {sdkConfig?: unknown} | unknown} & Record<string, unknown>;
  if (env?.result && typeof env.result === "object") {
    const r = env.result as {sdkConfig?: unknown};
    if (r.sdkConfig) candidates.push(r.sdkConfig);
    candidates.push(env.result);
  }
  candidates.push(parsed);
  for (const c of candidates) {
    if (c && typeof c === "object") {
      const o = c as Partial<WebAppConfig>;
      if (typeof o.apiKey === "string" && typeof o.appId === "string" && typeof o.projectId === "string") {
        return o as WebAppConfig;
      }
    }
  }
  throw new Error(`Could not find SDK config in --json output (tried result.sdkConfig, result, root):\n${raw.slice(0, 400)}`);
}

function renderApphostingYaml(cfg: WebAppConfig, backendId: string): string {
  return `# Firebase App Hosting configuration — generated by patient-installer.
#
# VITE_FIREBASE_API_KEY routed through Secret Manager (not because the key is
# secret — Firebase web API keys are public routing identifiers — but to keep
# secret scanners quiet and make rotation trivial).
#
# To rotate: \`echo -n "AIzaSy..." | gcloud secrets versions add \\
#   VITE_FIREBASE_API_KEY --project=${cfg.projectId} --data-file=-\`
#
# Backend id: ${backendId}

env:
  - variable: VITE_FIREBASE_API_KEY
    secret: VITE_FIREBASE_API_KEY
  - variable: VITE_FIREBASE_AUTH_DOMAIN
    value: ${cfg.authDomain}
  - variable: VITE_FIREBASE_PROJECT_ID
    value: ${cfg.projectId}
  - variable: VITE_FIREBASE_STORAGE_BUCKET
    value: ${cfg.storageBucket}
  - variable: VITE_FIREBASE_MESSAGING_SENDER_ID
    value: "${cfg.messagingSenderId}"
  - variable: VITE_FIREBASE_APP_ID
    value: "${cfg.appId}"

  - variable: VITE_APP_ENV
    value: production

  # Replace with the practice's Stripe publishable key after Stripe is wired
  # in /admin/integrations.
  - variable: VITE_STRIPE_PUBLIC_KEY
    value: pk_test_replace_me

  # The sidecar proxy URL is filled in after the first \`firebase deploy --only
  # functions\` — see installer step 13's printed instructions.
  - variable: VITE_SIDECAR_PROXY_URL
    value: https://placeholder.invalid
`;
}

void gcloudJson;
