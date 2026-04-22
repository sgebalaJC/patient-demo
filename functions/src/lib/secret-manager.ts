/**
 * Thin Secret Manager helpers for EHR integration `clientSecret`s.
 *
 * Why only clientSecret (and not tokens): access/refresh tokens rotate
 * every 5–60 min. Secret Manager is designed for rarely-rotated values —
 * it charges per version, has a 10k version-per-secret limit, and lacks
 * TTL. Frequent token rotation would blow through both. Tokens stay in
 * the private Firestore subdoc; clientSecret (vendor-portal rotations
 * only, maybe twice a year) lives here.
 *
 * Pre-reqs per fork (one-time):
 *   gcloud services enable secretmanager.googleapis.com --project=<id>
 *   # Functions SA needs admin (create/addVersion/delete):
 *   gcloud projects add-iam-policy-binding <id> \
 *     --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
 *     --role=roles/secretmanager.admin
 *   # Sidecar SA needs accessor (read only). If it's the same compute SA,
 *   # admin already covers it; otherwise bind:
 *   gcloud projects add-iam-policy-binding <id> \
 *     --member=serviceAccount:<sidecar-sa>@<id>.iam.gserviceaccount.com \
 *     --role=roles/secretmanager.secretAccessor
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();

function projectId(): string {
  const id = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!id) throw new Error("GCLOUD_PROJECT not set");
  return id;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { value: string; expiresAt: number }>();

/** Naming convention keeps EHR credentials grouped in the GCP console. */
export function ehrClientSecretName(provider: string): string {
  return `ehr_${provider}_client_secret`;
}

/** Read the latest version. Returns `undefined` if the secret doesn't exist
 *  — not an error, just means no credential has been saved yet. Any other
 *  GCP error (permission denied, network) bubbles up. */
export async function getEhrClientSecret(provider: string): Promise<string | undefined> {
  const name = ehrClientSecretName(provider);
  const now = Date.now();
  const cached = cache.get(name);
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const [ver] = await client.accessSecretVersion({
      name: `projects/${projectId()}/secrets/${name}/versions/latest`,
    });
    const value = ver.payload?.data?.toString("utf8") ?? "";
    cache.set(name, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  } catch (err: any) {
    const code = (err && (err.code || err.status)) as number | string | undefined;
    if (code === 5 || code === "NOT_FOUND") return undefined;
    throw err;
  }
}

/** Write a new version. Creates the secret if it doesn't exist. Cache is
 *  invalidated so the next read sees the new value immediately. */
export async function setEhrClientSecret(provider: string, value: string): Promise<void> {
  const name = ehrClientSecretName(provider);
  const parent = `projects/${projectId()}`;
  try {
    await client.createSecret({
      parent,
      secretId: name,
      secret: { replication: { automatic: {} } },
    });
  } catch (err: any) {
    const code = (err && (err.code || err.status)) as number | string | undefined;
    if (code !== 6 && code !== "ALREADY_EXISTS") throw err;
  }
  await client.addSecretVersion({
    parent: `${parent}/secrets/${name}`,
    payload: { data: Buffer.from(value, "utf8") },
  });
  cache.delete(name);
}

/** Permanently delete the secret (all versions). Called on integration
 *  disconnect so a re-connect starts clean. */
export async function deleteEhrClientSecret(provider: string): Promise<void> {
  const name = ehrClientSecretName(provider);
  try {
    await client.deleteSecret({
      name: `projects/${projectId()}/secrets/${name}`,
    });
  } catch (err: any) {
    const code = (err && (err.code || err.status)) as number | string | undefined;
    if (code !== 5 && code !== "NOT_FOUND") throw err;
  }
  cache.delete(name);
}
