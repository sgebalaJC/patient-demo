/**
 * Shared sidecar binding secrets + env accessors used by every callable /
 * HTTPS function that forwards to the customer-owned VPS.
 *
 * Values are read at call time (via the `*Env` helpers) so the runtime-bound
 * secret is reflected — snapshotting at module init would leave us serving
 * the empty string until the next cold start.
 */

import {defineSecret} from "firebase-functions/params";

export const SIDECAR_URL_SECRET = defineSecret("SIDECAR_URL");
export const SIDECAR_API_KEY_SECRET = defineSecret("SIDECAR_API_KEY");

export const sidecarUrlEnv = (): string =>
  process.env.SIDECAR_URL || "http://YOUR_VPS_IP:8081";
export const sidecarApiKeyEnv = (): string =>
  process.env.SIDECAR_API_KEY || "";
