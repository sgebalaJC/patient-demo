/**
 * Greenway Health sidecar client — thin spec over `makeEhrProvider`.
 */

import { bodyCredsTokenRefresh, makeEhrProvider, type BaseEhrConfig } from "./ehr-provider.js";

const GREENWAY_API_PROD = "https://apis.greenwayhealth.com/v1";
const GREENWAY_API_SANDBOX = "https://apis-sandbox.greenwayhealth.com/v1";
const GREENWAY_TOKEN_URL_PROD = "https://apis.greenwayhealth.com/oauth2/token";
const GREENWAY_TOKEN_URL_SANDBOX = "https://apis-sandbox.greenwayhealth.com/oauth2/token";

interface GreenwayConfig extends BaseEhrConfig {
  sandbox?: boolean;
}

const provider = makeEhrProvider<GreenwayConfig>({
  providerName: "Greenway",
  configDoc: "integrations/greenway",
  resolveApiBase: (cfg) => (cfg.sandbox ? GREENWAY_API_SANDBOX : GREENWAY_API_PROD),
  resolveTokenUrl: (cfg) => (cfg.sandbox ? GREENWAY_TOKEN_URL_SANDBOX : GREENWAY_TOKEN_URL_PROD),
  tokenRefreshAuth: bodyCredsTokenRefresh<GreenwayConfig>(),
});

export const proxyGreenway = provider.proxy;
export const assertGreenwayReady = provider.assertReady;
export const getGreenwayAccessToken = provider.getAccessToken;
