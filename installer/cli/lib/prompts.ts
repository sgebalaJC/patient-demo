import * as p from "@clack/prompts";
import {existsSync} from "node:fs";
import {homedir} from "node:os";
import {resolve} from "node:path";
import pc from "picocolors";
import {gcloud, gcloudJson} from "./gcloud.ts";
import {InstallerInputsSchema, type InstallerInputs} from "./types.ts";

interface BillingAccount {
  name: string;
  displayName: string;
  open: boolean;
}

async function pickBillingAccount(initial?: string): Promise<string> {
  let accounts: BillingAccount[] = [];
  try {
    accounts = gcloudJson<BillingAccount[]>(["beta", "billing", "accounts", "list"]);
  } catch {
    p.log.warn("Could not list billing accounts (gcloud beta billing not enabled?). Enter the id manually.");
  }
  const open = accounts.filter((a) => a.open);
  if (open.length === 0) {
    const v = await p.text({
      message: "Billing account id (XXXXXX-XXXXXX-XXXXXX)",
      initialValue: initial,
      validate: (s) => (/^[0-9A-Fa-f]{6}-[0-9A-Fa-f]{6}-[0-9A-Fa-f]{6}$/.test(s) ? undefined : "format: XXXXXX-XXXXXX-XXXXXX"),
    });
    if (p.isCancel(v)) throw new Error("cancelled");
    return v as string;
  }
  const choice = await p.select({
    message: "Billing account",
    options: open.map((a) => ({
      value: a.name.replace(/^billingAccounts\//, ""),
      label: `${a.displayName} (${a.name.replace(/^billingAccounts\//, "")})`,
    })),
    initialValue: initial,
  });
  if (p.isCancel(choice)) throw new Error("cancelled");
  return choice as string;
}

function defaultTargetDir(projectId: string): string {
  return resolve(homedir(), "Projects", "BLASKO", projectId);
}

/** Convert a project id like "acme-clinic-prod" → "Acme Clinic Prod". */
function humanizeProjectId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Derive a default project id from a target dir like "/Users/x/Projects/foo" → "foo". */
function projectIdFromTargetDir(target: string | undefined): string | undefined {
  if (!target) return undefined;
  const base = target.split("/").filter(Boolean).pop();
  return base && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(base) ? base : undefined;
}

/**
 * Returns clack `p.text` options that show a gray placeholder + accept it
 * on empty Enter, instead of pre-filling the input buffer (which mashes
 * default text together with anything the user types).
 *
 * - prefill set (resume) → pre-fill the buffer so the user edits in place
 * - computed default only → placeholder + defaultValue (Enter-on-empty accepts)
 * - neither → no default
 */
function defaultable(prefill: string | undefined, computed: string | undefined) {
  if (prefill) return {initialValue: prefill};
  if (computed) return {placeholder: computed, defaultValue: computed};
  return {};
}

/**
 * Run the interactive setup wizard. If `prefill` is provided (resume case),
 * the user can accept the existing answers or override. Returns a fully
 * validated InstallerInputs.
 */
export async function collectInputs(prefill: Partial<InstallerInputs>): Promise<InstallerInputs> {
  p.intro(pc.bgCyan(pc.black(" patient-installer ")));

  const projectId = await p.text({
    message: "GCP project id — lowercase, hyphens, 6–30 chars, globally unique",
    ...defaultable(prefill.projectId, projectIdFromTargetDir(prefill.targetDir)),
    validate: (s) => {
      const r = InstallerInputsSchema.shape.projectId.safeParse(s);
      return r.success ? undefined : r.error.issues[0]?.message;
    },
  });
  if (p.isCancel(projectId)) throw new Error("cancelled");

  const projectName = await p.text({
    message: "Project display name",
    ...defaultable(prefill.projectName, humanizeProjectId(projectId as string)),
    validate: (s) => (s && s.trim() ? undefined : "required"),
  });
  if (p.isCancel(projectName)) throw new Error("cancelled");

  const targetDir = await p.text({
    message: "Target directory for the new fork",
    ...defaultable(prefill.targetDir, defaultTargetDir(projectId as string)),
    validate: (s) => {
      if (!s) return "required";
      const abs = resolve(s);
      if (existsSync(abs) && existsSync(`${abs}/.git`) && abs !== prefill.targetDir) {
        return `${abs} already contains a git repo — pick a different path or resume the prior install`;
      }
      return undefined;
    },
  });
  if (p.isCancel(targetDir)) throw new Error("cancelled");

  const region = await p.select({
    message: "Region (Firestore + Functions)",
    options: [
      {value: "us-west1", label: "us-west1 (Oregon — repo default)"},
      {value: "us-central1", label: "us-central1 (Iowa)"},
      {value: "us-east1", label: "us-east1 (S. Carolina)"},
      {value: "europe-west1", label: "europe-west1 (Belgium)"},
    ],
    initialValue: prefill.region ?? "us-west1",
  });
  if (p.isCancel(region)) throw new Error("cancelled");

  const zone = await p.select({
    message: "Zone for the OpenClaw GCE VM",
    options: [
      {value: "us-central1-a", label: "us-central1-a (Iowa — showmd default)"},
      {value: "us-central1-b", label: "us-central1-b (Iowa)"},
      {value: "us-central1-c", label: "us-central1-c (Iowa)"},
      {value: "us-west1-a", label: "us-west1-a (Oregon)"},
      {value: "us-west1-b", label: "us-west1-b (Oregon)"},
      {value: "us-east1-b", label: "us-east1-b (S. Carolina)"},
      {value: "europe-west1-b", label: "europe-west1-b (Belgium)"},
    ],
    initialValue: prefill.zone ?? "us-central1-a",
  });
  if (p.isCancel(zone)) throw new Error("cancelled");

  const billingAccountId = await pickBillingAccount(prefill.billingAccountId);

  const superAdminEmail = await p.text({
    message: "Super-admin email (will own the bootstrap)",
    ...defaultable(prefill.superAdminEmail, undefined),
    validate: (s) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? undefined : "invalid email"),
  });
  if (p.isCancel(superAdminEmail)) throw new Error("cancelled");

  const practiceName = await p.text({
    message: "Practice name — full legal/display name",
    ...defaultable(prefill.practiceName, projectName as string),
    validate: (s) => (s && s.trim() ? undefined : "required"),
  });
  if (p.isCancel(practiceName)) throw new Error("cancelled");

  const practiceShortName = await p.text({
    message: "Practice short name — for SMS bodies + email subjects",
    ...defaultable(prefill.practiceShortName, (practiceName as string).split(/[ ,]/)[0]),
    validate: (s) => (s && s.trim() ? undefined : "required"),
  });
  if (p.isCancel(practiceShortName)) throw new Error("cancelled");

  const portalDomain = await p.text({
    message: "Portal custom domain (blank = use App Hosting default URL)",
    ...defaultable(prefill.portalDomain, undefined),
  });
  if (p.isCancel(portalDomain)) throw new Error("cancelled");

  const adminAgentName = await p.text({
    message: "Admin AI agent name",
    ...defaultable(prefill.adminAgentName, "Aurelia"),
  });
  if (p.isCancel(adminAgentName)) throw new Error("cancelled");

  const patientAgentName = await p.text({
    message: "Patient-facing AI agent name",
    ...defaultable(prefill.patientAgentName, "Sunny"),
  });
  if (p.isCancel(patientAgentName)) throw new Error("cancelled");

  const githubRepo = await p.text({
    message: "GitHub repo to create (owner/name; blank to skip)",
    ...defaultable(prefill.githubRepo, undefined),
    validate: (s) => (!s || /^[\w.-]+\/[\w.-]+$/.test(s) ? undefined : "format: owner/repo"),
  });
  if (p.isCancel(githubRepo)) throw new Error("cancelled");

  const provisionOpenclaw = await p.confirm({
    message: "Provision the OpenClaw GCE VM now? (skip if you'll add agents later or are running a smoke test)",
    initialValue: prefill.provisionOpenclaw ?? true,
  });
  if (p.isCancel(provisionOpenclaw)) throw new Error("cancelled");

  const provisionApphosting = await p.confirm({
    message:
      "Provision the App Hosting backend (public web URL)? Requires the Cloud Build GitHub App installed once at github.com/apps/google-cloud-build.",
    initialValue: prefill.provisionApphosting ?? true,
  });
  if (p.isCancel(provisionApphosting)) throw new Error("cancelled");

  const ok = await p.confirm({
    message: `Project ${pc.cyan(projectId as string)} in ${pc.cyan(region as string)}, billing ${pc.cyan(
      billingAccountId,
    )} — proceed?`,
    initialValue: true,
  });
  if (p.isCancel(ok) || !ok) throw new Error("cancelled");

  const parsed = InstallerInputsSchema.parse({
    targetDir: resolve(targetDir as string),
    projectId,
    projectName,
    region,
    zone,
    billingAccountId,
    superAdminEmail,
    practiceName,
    practiceShortName,
    portalDomain: portalDomain ? (portalDomain as string) : undefined,
    adminAgentName,
    patientAgentName,
    githubRepo: githubRepo ? (githubRepo as string) : undefined,
    provisionOpenclaw: provisionOpenclaw as boolean,
    provisionApphosting: provisionApphosting as boolean,
  });
  return parsed;
}

/** Helper — used by individual steps that re-prompt for missing values. */
export {p as prompts};

/** Avoid unused-import warning for gcloud on platforms without billing API enabled. */
void gcloud;
