/**
 * Practice Fusion sidecar client — thin spec over `makeEhrProvider`.
 */

import { makeEhrProvider, type BaseEhrConfig } from "./ehr-provider.js";

const PFUSION_API = "https://www.practicefusion.com/ehr/api/v1";
const PFUSION_TOKEN_URL = "https://www.practicefusion.com/ehr/oauth2/token";

const provider = makeEhrProvider<BaseEhrConfig>({
  providerName: "Practice Fusion",
  configDoc: "integrations/pfusion",
  resolveApiBase: () => PFUSION_API,
  resolveTokenUrl: () => PFUSION_TOKEN_URL,
  tokenRefreshAuth: (cfg) => ({
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    bodyExtras: {},
  }),
});

export const proxyPfusion = provider.proxy;
export const assertPfusionReady = provider.assertReady;
export const getPfusionAccessToken = provider.getAccessToken;
