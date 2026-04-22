/**
 * DrChrono sidecar client — thin spec over `makeEhrProvider`.
 *
 * Called via /admin-api/drchrono/*. Credentials read from
 * `integrations/drchrono` (written by Cloud Functions via Admin SDK).
 */

import { makeEhrProvider, type BaseEhrConfig } from "./ehr-provider.js";

const DRCHRONO_API = "https://app.drchrono.com/api";
const DRCHRONO_TOKEN_URL = "https://drchrono.com/o/token/";

interface DrChronoConfig extends BaseEhrConfig {
  practiceSubdomain?: string;
}

const provider = makeEhrProvider<DrChronoConfig>({
  providerName: "DrChrono",
  configDoc: "integrations/drchrono",
  resolveApiBase: () => DRCHRONO_API,
  resolveTokenUrl: () => DRCHRONO_TOKEN_URL,
  tokenRefreshAuth: (cfg) => ({
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    bodyExtras: {},
  }),
  extraReadyChecks: (cfg) => {
    if (!cfg.refreshToken) {
      throw new Error("DrChrono not authorized — complete the OAuth flow in the admin UI");
    }
  },
});

export const proxyDrChrono = provider.proxy;
export const assertDrChronoReady = provider.assertReady;
export const getDrChronoAccessToken = provider.getAccessToken;
