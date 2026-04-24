/**
 * Resolve SignalWire runtime configuration from the admin-managed
 * Integrations panel (`integrations/signalwire` Firestore doc +
 * `signalwire_auth_token` Secret Manager entry), falling back to the
 * legacy `defineSecret()`/env vars for dev and backward compatibility.
 *
 * Callers that send SMS or fax should go through here instead of reading
 * env vars directly so swapping creds from the admin UI takes effect
 * without a redeploy.
 */

import * as admin from "firebase-admin";
import { getSignalwireAuthToken } from "./secret-manager.js";

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

interface CacheEntry {
  value: SignalwireConfig | null;
  expiresAt: number;
}

const TTL_MS = 10 * 1000;
let cache: CacheEntry | null = null;

function fromEnv(): Partial<SignalwireConfig> {
  return {
    projectId: process.env.SIGNALWIRE_PROJECT_ID || "",
    authToken: process.env.SIGNALWIRE_AUTH_TOKEN || "",
    spaceUrl: (process.env.SIGNALWIRE_SPACE_URL || "").replace(/\/+$/, ""),
    smsFrom: process.env.SIGNALWIRE_SMS_FROM || "",
    faxNumber: process.env.SIGNALWIRE_FAX_FROM || undefined,
    faxFromEmail: process.env.FAX_FROM_EMAIL || undefined,
    faxCcEmail: process.env.FAX_CC_EMAIL || undefined,
  };
}

async function fromFirestore(): Promise<Partial<SignalwireConfig>> {
  const snap = await admin.firestore().doc("integrations/signalwire").get();
  if (!snap.exists) return {};
  const data = snap.data() ?? {};
  return {
    projectId: typeof data.projectId === "string" ? data.projectId : undefined,
    spaceUrl:
      typeof data.spaceUrl === "string" ? data.spaceUrl.replace(/\/+$/, "") : undefined,
    smsFrom: typeof data.smsFrom === "string" ? data.smsFrom : undefined,
    faxNumber: typeof data.faxNumber === "string" ? data.faxNumber : undefined,
    faxLabel: typeof data.faxLabel === "string" ? data.faxLabel : undefined,
    faxFromEmail: typeof data.faxFromEmail === "string" ? data.faxFromEmail : undefined,
    faxCcEmail: typeof data.faxCcEmail === "string" ? data.faxCcEmail : undefined,
  };
}

/**
 * Return the merged config, preferring Firestore values and the
 * Secret Manager auth token; missing fields fall back to env vars so
 * existing deployments keep working without a migration step.
 *
 * Returns `null` when essential fields (projectId, authToken, spaceUrl)
 * can't be resolved from either source. Callers decide whether that's
 * fatal.
 */
export async function loadSignalwireConfig(): Promise<SignalwireConfig | null> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  const fs = await fromFirestore().catch(() => ({} as Partial<SignalwireConfig>));
  const env = fromEnv();
  const secretToken = await getSignalwireAuthToken().catch(() => undefined);

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
  cache = { value, expiresAt: now + TTL_MS };
  return value;
}

/** Clear the in-memory cache. Call from callables that just rewrote the
 *  integration so subsequent reads in the same instance see fresh data. */
export function invalidateSignalwireConfig(): void {
  cache = null;
}
