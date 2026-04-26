import {z} from "zod";

export const InstallerInputsSchema = z.object({
  /** Absolute path to the new fork's working directory. */
  targetDir: z.string().min(1),
  /** GCP/Firebase project id (lowercase, 6-30 chars, hyphen-allowed). */
  projectId: z
    .string()
    .min(6)
    .max(30)
    .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, "must match GCP project id rules"),
  /** Human-readable project display name. */
  projectName: z.string().min(1).max(30),
  /** GCP region for Firestore + Functions + App Hosting. */
  region: z.string().min(1),
  /** GCE zone for the OpenClaw VM. */
  zone: z.string().min(1),
  /** Billing account id, e.g. 0X0X0X-0X0X0X-0X0X0X. */
  billingAccountId: z.string().regex(/^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/i),
  /** Email of the first super-admin (matches BootstrapAdminForm). */
  superAdminEmail: z.string().email(),
  /** Practice short name, used in SMS bodies and email subjects. */
  practiceShortName: z.string().min(1).max(40),
  /** Full legal/display practice name. */
  practiceName: z.string().min(1).max(80),
  /** Optional custom domain for the patient portal. */
  portalDomain: z.string().min(1).optional(),
  /** Patient-facing AI agent display name (e.g. "Sunny"). */
  patientAgentName: z.string().min(1).default("Sunny"),
  /** Admin-facing AI agent display name (e.g. "Aurelia"). */
  adminAgentName: z.string().min(1).default("Aurelia"),
  /** Optional GitHub repo slug to create + push to (`owner/name`). Empty = skip. */
  githubRepo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
  /**
   * Provision the OpenClaw GCE VM (step 09) + render+upload its config (step 11).
   * Default true. Set false for forks that don't need agents at install time —
   * the operator can re-run `--rerun 09-openclaw-vm` later to add it.
   */
  provisionOpenclaw: z.boolean().default(true),
  /**
   * Provision the App Hosting backend (Cloud Build connection + repo + backend
   * → public URL). Default true. Requires the Google Cloud Build GitHub App
   * to be installed at https://github.com/apps/google-cloud-build with "All
   * repositories" access. The first project to use App Hosting prints an
   * authorize URL to confirm the Cloud Build → GitHub binding (one-click
   * after the GitHub App is installed); subsequent projects reuse the install.
   */
  provisionApphosting: z.boolean().default(true),
  /**
   * Integration groups to include in the install-time Cloud Functions deploy.
   * `core` is always deployed. Add any of: `google-workspace`, `signalwire`,
   * `stripe`, `pa`, `backup`, `simulation`, `ehr-drchrono`, `ehr-athena`,
   * `ehr-elation`, `ehr-ecw`, `ehr-nextgen`, `ehr-tebra`, `ehr-greenway`,
   * `ehr-pfusion`, `ehr-cerner`, `ehr-epic`.
   *
   * Default `[]` — install ships only `core` (~25 functions). Subsequent
   * `firebase deploy --only functions:<group>` runs (or admin UI deploy
   * triggers) bring the rest online when needed.
   */
  enabledIntegrations: z.array(z.string()).default([]),
});

export type InstallerInputs = z.infer<typeof InstallerInputsSchema>;

export const InstallerArtifactsSchema = z.object({
  /** Firebase web app id, captured from `firebase apps:create WEB`. */
  firebaseAppId: z.string().optional(),
  firebaseConfig: z
    .object({
      apiKey: z.string(),
      authDomain: z.string(),
      projectId: z.string(),
      storageBucket: z.string(),
      messagingSenderId: z.string(),
      appId: z.string(),
    })
    .optional(),
  /** App Hosting backend id (e.g. `web-patient`). */
  apphostingBackendId: z.string().optional(),
  /** Public URL of the deployed App Hosting backend. */
  apphostingUrl: z.string().url().optional(),
  /** Cloud Build → GitHub connection name (e.g. `gh-conn`) used for App Hosting. */
  cloudBuildConnection: z.string().optional(),
  /** Cloud Build repository resource id created for this fork's GitHub repo. */
  cloudBuildRepository: z.string().optional(),
  /** GCS URI of the latest source bundle pointer (`gs://.../functions-source.tar.gz`). */
  installerSourceUri: z.string().optional(),
  /** GCS bucket name where the source bundle lives. */
  installerSourceBucket: z.string().optional(),
  /**
   * Version tag of the most recently uploaded bundle, e.g.
   * `2026-04-26T22-30-00Z-4f5208e`. Used by the maintainer's future
   * cross-fork update tool to identify which forks have which bundle.
   */
  installerSourceVersion: z.string().optional(),
  /** Cloud Function URL of sidecarProxy (post-functions-deploy). */
  sidecarProxyUrl: z.string().url().optional(),
  /** Numeric GCP project number, used for IAM bindings. */
  projectNumber: z.string().optional(),
  /** OpenClaw VM details (showmd pattern). */
  openclawVm: z
    .object({
      name: z.string(),
      zone: z.string(),
      externalIp: z.string().optional(),
      internalIp: z.string().optional(),
    })
    .optional(),
  /** GCS bucket name where rendered openclaw.json is staged. */
  openclawConfigBucket: z.string().optional(),
  /** Names of Secret Manager secrets created (values not stored here). */
  createdSecrets: z.array(z.string()).default([]),
  /** Repo slug if a GitHub repo was created. */
  githubRepoCreated: z.string().optional(),
});

export type InstallerArtifacts = z.infer<typeof InstallerArtifactsSchema>;

export const InstallerStateSchema = z.object({
  schemaVersion: z.literal(1),
  inputs: InstallerInputsSchema.partial(),
  artifacts: InstallerArtifactsSchema.partial(),
  completedSteps: z.array(z.string()).default([]),
  startedAt: z.string(),
  updatedAt: z.string(),
});

export type InstallerState = z.infer<typeof InstallerStateSchema>;

export interface Logger {
  info(msg: string): void;
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  step(msg: string): void;
  spinner(label: string): {update(label: string): void; stop(label?: string): void; fail(label?: string): void};
}

export interface StepCtx {
  state: InstallerState;
  log: Logger;
  /** Persist current state.json. Steps don't need to call this manually — the runner saves after `run` returns. */
  save(): Promise<void>;
}

export interface Step {
  id: string;
  title: string;
  /**
   * If true, the runner skips when `id` is already in `completedSteps`.
   * Set false for steps that should always run (e.g. print-next-steps).
   */
  idempotent: boolean;
  run(ctx: StepCtx): Promise<void>;
}

/** Minimum required inputs for a given step. Runner re-prompts if missing. */
export type StepInputRequirements = readonly (keyof InstallerInputs)[];
