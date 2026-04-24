/**
 * Resolve SignalWire runtime configuration on the sidecar.
 *
 * Mirror of `functions/src/lib/signalwire-config.ts` so the sidecar
 * (admin SMS + inbound webhook + outbound fax) reads from the same
 * `integrations/signalwire` Firestore doc + `signalwire_auth_token`
 * Secret Manager entry the admin UI writes. Env vars stay as a fallback
 * so un-migrated forks and local dev keep working without a rewrite.
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { getDb } from "./firebase.js";

export interface SignalwireConfig {
  projectId: string;
  authToken: string;
  spaceUrl: string;
  smsFrom: string;
  faxNumber?: string;
  faxLabel?: string;
  faxFromEmail?: string;
  faxCcEmail?: string;
}

const AUTH_TOKEN_SECRET = "signalwire_auth_token";
const SECRET_TTL_MS = 10 * 60 * 1000;
const CONFIG_TTL_MS = 10 * 1000;

const secretCache = new Map<string, { value: string; expiresAt: number }>();
let configCache: { value: SignalwireConfig | null; expiresAt: number } | null = null;

const secretClient = new SecretManagerServiceClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    || "/root/.openclaw/credentials/google-sa-key.json",
});

function gcpProjectId(): string {
  const id = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!id) throw new Error("GCLOUD_PROJECT not set");
  return id;
}

async function readSecret(name: string): Promise<string | undefined> {
  const now = Date.now();
  const cached = secretCache.get(name);
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const [ver] = await secretClient.accessSecretVersion({
      name: `projects/${gcpProjectId()}/secrets/${name}/versions/latest`,
    });
    const value = ver.payload?.data?.toString("utf8") ?? "";
    if (!value) return undefined;
    secretCache.set(name, { value, expiresAt: now + SECRET_TTL_MS });
    return value;
  } catch (err: any) {
    const code = err?.code ?? err?.status;
    if (code === 5 || code === "NOT_FOUND") return undefined;
    throw err;
  }
}

async function fromFirestore(): Promise<Partial<SignalwireConfig>> {
  try {
    const snap = await getDb().collection("integrations").doc("signalwire").get();
    if (!snap.exists) return {};
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const take = (k: string): string | undefined => {
      const v = data[k];
      return typeof v === "string" ? v : undefined;
    };
    const spaceUrl = take("spaceUrl")?.replace(/\/+$/, "");
    return {
      projectId: take("projectId"),
      spaceUrl,
      smsFrom: take("smsFrom"),
      faxNumber: take("faxNumber"),
      faxLabel: take("faxLabel"),
      faxFromEmail: take("faxFromEmail"),
      faxCcEmail: take("faxCcEmail"),
    };
  } catch (err) {
    console.warn("[signalwire-config] firestore read failed:", err);
    return {};
  }
}

function fromEnv(): Partial<SignalwireConfig> {
  return {
    projectId: process.env.SIGNALWIRE_PROJECT_ID || undefined,
    authToken: process.env.SIGNALWIRE_AUTH_TOKEN || undefined,
    spaceUrl: (process.env.SIGNALWIRE_SPACE_URL || "").replace(/\/+$/, "") || undefined,
    smsFrom: process.env.SIGNALWIRE_SMS_FROM || undefined,
    faxNumber: process.env.SIGNALWIRE_FAX_FROM || undefined,
    faxFromEmail: process.env.FAX_FROM_EMAIL || undefined,
    faxCcEmail: process.env.FAX_CC_EMAIL || undefined,
  };
}

/**
 * Returns merged config, preferring Firestore + Secret Manager and
 * falling back to env vars. `null` when essential fields (projectId +
 * authToken + spaceUrl) can't be resolved from any source.
 */
export async function loadSignalwireConfig(): Promise<SignalwireConfig | null> {
  const now = Date.now();
  if (configCache && configCache.expiresAt > now) return configCache.value;

  const fs = await fromFirestore();
  const env = fromEnv();
  const secretToken = await readSecret(AUTH_TOKEN_SECRET).catch(() => undefined);

  const merged: SignalwireConfig = {
    projectId: fs.projectId || env.projectId || "",
    authToken: secretToken || env.authToken || "",
    spaceUrl: fs.spaceUrl || env.spaceUrl || "",
    smsFrom: fs.smsFrom || env.smsFrom || "",
    faxNumber: fs.faxNumber ?? env.faxNumber,
    faxLabel: fs.faxLabel,
    faxFromEmail: fs.faxFromEmail ?? env.faxFromEmail,
    faxCcEmail: fs.faxCcEmail ?? env.faxCcEmail,
  };

  const ok = merged.projectId && merged.authToken && merged.spaceUrl;
  const value = ok ? merged : null;
  configCache = { value, expiresAt: now + CONFIG_TTL_MS };
  return value;
}

export function invalidateSignalwireConfig(): void {
  configCache = null;
}
