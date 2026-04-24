/**
 * Athenahealth sidecar client — thin spec over `makeEhrProvider`.
 *
 * Called via /admin-api/athena/*. Athena API calls are scoped to a practice
 * (tenant) id pulled from the integration doc; the factory's `buildUrl` hook
 * injects it so callers don't need to supply it.
 */

import { basicAuthTokenRefresh, makeEhrProvider, type BaseEhrConfig } from "./ehr-provider.js";

const ATHENA_API_PROD = "https://api.athenahealth.com/v1";
const ATHENA_API_PREVIEW = "https://api.preview.platform.athenahealth.com/v1";
const ATHENA_TOKEN_URL_PROD = "https://api.athenahealth.com/oauth2/v1/token";
const ATHENA_TOKEN_URL_PREVIEW = "https://api.preview.platform.athenahealth.com/oauth2/v1/token";

interface AthenaConfig extends BaseEhrConfig {
  practiceId?: string;
  preview?: boolean;
}

const provider = makeEhrProvider<AthenaConfig>({
  providerName: "Athena",
  configDoc: "integrations/athena",
  resolveApiBase: (cfg) => (cfg.preview ? ATHENA_API_PREVIEW : ATHENA_API_PROD),
  resolveTokenUrl: (cfg) => (cfg.preview ? ATHENA_TOKEN_URL_PREVIEW : ATHENA_TOKEN_URL_PROD),
  tokenRefreshAuth: basicAuthTokenRefresh<AthenaConfig>(),
  extraReadyChecks: (cfg) => {
    if (!cfg.practiceId) {
      throw new Error("Athena practiceId missing — re-save credentials in the admin UI");
    }
  },
  buildUrl: (cfg, path, qs) => {
    const base = cfg.preview ? ATHENA_API_PREVIEW : ATHENA_API_PROD;
    return `${base}/${cfg.practiceId}/${path}${qs ? "?" + qs : ""}`;
  },
});

export const proxyAthena = provider.proxy;
export const assertAthenaReady = provider.assertReady;
export const getAthenaAccessToken = provider.getAccessToken;
