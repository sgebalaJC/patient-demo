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

export const sidecarUrlEnv = (): string =>
  process.env.SIDECAR_URL || "http://YOUR_VPS_IP:8081";
export const sidecarApiKeyEnv = (): string =>
  process.env.SIDECAR_API_KEY || "";

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
  const url = sidecarUrlEnv();
  const key = sidecarApiKeyEnv();
  if (!key || url.includes("YOUR_VPS_IP")) {
    logger.info(`[skills] sidecar not configured, skipping sync for ${integrationId}`);
    return;
  }
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
