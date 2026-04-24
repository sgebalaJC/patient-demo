/**
 * Elation sidecar client — thin spec over `makeEhrProvider`.
 */

import { bodyCredsTokenRefresh, makeEhrProvider, type BaseEhrConfig } from "./ehr-provider.js";

const ELATION_API_PROD = "https://app.elationemr.com/api/2.0";
const ELATION_API_SANDBOX = "https://sandbox.elationemr.com/api/2.0";
const ELATION_TOKEN_URL_PROD = "https://app.elationemr.com/api/2.0/oauth2/token/";
const ELATION_TOKEN_URL_SANDBOX = "https://sandbox.elationemr.com/api/2.0/oauth2/token/";

interface ElationConfig extends BaseEhrConfig {
  sandbox?: boolean;
}

const provider = makeEhrProvider<ElationConfig>({
  providerName: "Elation",
  configDoc: "integrations/elation",
  resolveApiBase: (cfg) => (cfg.sandbox ? ELATION_API_SANDBOX : ELATION_API_PROD),
  resolveTokenUrl: (cfg) => (cfg.sandbox ? ELATION_TOKEN_URL_SANDBOX : ELATION_TOKEN_URL_PROD),
  tokenRefreshAuth: bodyCredsTokenRefresh<ElationConfig>(),
});

export const proxyElation = provider.proxy;
export const assertElationReady = provider.assertReady;
export const getElationAccessToken = provider.getAccessToken;
