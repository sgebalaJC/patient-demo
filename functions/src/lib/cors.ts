/**
 * CORS allow-list used by `onRequest` / `onCall` Cloud Functions.
 *
 * Source of truth is `FUNCTIONS_BRANDING.portalUrl` + `additionalOrigins`,
 * optionally extended by `ALLOWED_ORIGINS` (comma-separated). Local dev
 * keeps localhost automatically.
 */

import {FUNCTIONS_BRANDING} from "../branding.js";

const DEV_ORIGINS = [
  "http://localhost:3001",
  "https://localhost:3001",
  "http://localhost:5173",
];

/** True when running as a deployed function (not under the emulator). */
export function isProduction(): boolean {
  const isEmulator = !!(
    process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR
  );
  return !isEmulator;
}

function buildCorsOptions(): string[] {
  const envOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const brandingOrigins = [
    FUNCTIONS_BRANDING.portalUrl,
    ...(FUNCTIONS_BRANDING.additionalOrigins ?? []),
  ].filter(Boolean);
  return isProduction()
    ? Array.from(new Set([...brandingOrigins, ...envOrigins]))
    : Array.from(new Set([...DEV_ORIGINS, ...brandingOrigins, ...envOrigins]));
}

/** Computed once at module load, same lifetime as the functions process. */
export const corsOptions = buildCorsOptions();
