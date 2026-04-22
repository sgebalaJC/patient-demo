/**
 * Read-only Secret Manager helper for the sidecar.
 *
 * The sidecar only needs to *read* EHR clientSecrets during token
 * refresh. Writes happen exclusively in Cloud Functions at save or
 * disconnect time. Keeping this read-only means the sidecar SA needs
 * only `roles/secretmanager.secretAccessor` — less privilege than the
 * Functions SA.
 *
 * Pre-req per fork: grant the sidecar SA secretAccessor on the project.
 * See functions/src/lib/secret-manager.ts for full IAM setup.
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

export function ehrClientSecretName(provider: string): string {
  return `ehr_${provider}_client_secret`;
}

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
