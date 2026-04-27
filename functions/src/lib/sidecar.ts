/**
 * Shared sidecar binding secrets + env accessors used by every callable /
 * HTTPS function that forwards to the customer-owned VPS.
 *
 * Values are read at call time (via the `*Env` helpers) so the runtime-bound
 * secret is reflected — snapshotting at module init would leave us serving
 * the empty string until the next cold start.
 */

import {defineSecret} from "firebase-functions/params";
import {logger} from "firebase-functions";

export const SIDECAR_URL_SECRET = defineSecret("SIDECAR_URL");
export const SIDECAR_API_KEY_SECRET = defineSecret("SIDECAR_API_KEY");

/**
 * Strict accessors. No fallback defaults — a missing or placeholder value
 * means the function is misconfigured and we want loud failure (the caller's
 * bearer token would otherwise be forwarded to whatever the default points
 * at, which has historically been a demo VPS IP). Soft "skip if absent"
 * paths must use {@link isSidecarConfigured} first.
 */
export function sidecarUrlEnv(): string {
  const url = process.env.SIDECAR_URL;
  if (!url) {
    throw new Error("SIDECAR_URL is not set");
  }
  if (!isValidSidecarUrl(url)) {
    throw new Error("SIDECAR_URL is invalid or a placeholder");
  }
  return url;
}

export function sidecarApiKeyEnv(): string {
  const key = process.env.SIDECAR_API_KEY;
  if (!key) {
    throw new Error("SIDECAR_API_KEY is not set");
  }
  return key;
}

/**
 * Non-throwing probe for fire-and-forget paths (skill sync, opportunistic
 * Aurelia triggers from schedulers) where a missing sidecar must NOT fail
 * the primary operation. Returns false when env is unset or invalid.
 */
export function isSidecarConfigured(): boolean {
  const url = process.env.SIDECAR_URL;
  const key = process.env.SIDECAR_API_KEY;
  if (!url || !key) return false;
  return isValidSidecarUrl(url);
}

/**
 * Validate that `SIDECAR_URL` looks like a sidecar before forwarding the
 * API key. The bearer token is sent on every proxied request, so an
 * attacker who flipped SIDECAR_URL to their own host would harvest it
 * silently. Constrain to the showmd-pattern shape:
 *   - http or https
 *   - host is IPv4 OR DNS hostname (no userinfo, no path other than `/`)
 *   - port empty (default 80/443) or in {80, 443, 8081}
 *   - never the placeholder strings step 07/12 of the installer seed
 *
 * Used by `installerSyncAgentWorkspace` AND `sidecarProxy` — keep the rule
 * single-source so we don't drift between code paths.
 */
const SIDECAR_PLACEHOLDERS = ["YOUR_VPS_IP", "placeholder.invalid"];

export function isValidSidecarUrl(url: string): boolean {
  if (SIDECAR_PLACEHOLDERS.some((p) => url.includes(p))) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.port !== "" && !["80", "443", "8081"].includes(parsed.port)) return false;
  const host = parsed.hostname;
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
  const dns = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(host);
  if (!ipv4 && !dns) return false;
  if (parsed.pathname && parsed.pathname !== "/" && parsed.pathname !== "") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;
  return true;
}

/**
 * Install or uninstall the skill file(s) bundled with an integration on
 * the sidecar host. Called fire-and-forget from every callable that
 * connects / disables / disconnects an integration — failures are logged
 * but don't fail the primary save operation, since the integration doc
 * is the source of truth and the next sync will re-converge.
 */
export async function syncIntegrationSkill(
  integrationId: string,
  enabled: boolean,
): Promise<void> {
  if (!isSidecarConfigured()) {
    logger.info(`[skills] sidecar not configured / invalid URL, skipping sync for ${integrationId}`);
    return;
  }
  const url = sidecarUrlEnv();
  const key = sidecarApiKeyEnv();
  try {
    const res = await fetch(`${url}/skills/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({integrationId, enabled}),
    });
    if (!res.ok) {
      logger.warn(`[skills] sync ${integrationId} enabled=${enabled} → HTTP ${res.status}`);
      return;
    }
    const result = (await res.json()) as {skills?: Array<{id: string; installed?: boolean; removed?: boolean}>};
    logger.info(`[skills] synced ${integrationId} enabled=${enabled}`, {
      affected: (result.skills ?? []).map((s) => s.id),
    });
  } catch (err: any) {
    logger.warn(`[skills] sync ${integrationId} failed: ${err?.message || err}`);
  }
}
