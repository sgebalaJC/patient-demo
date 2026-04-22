/**
 * NextGen sidecar client — thin spec over `makeEhrProvider`.
 */

import { makeEhrProvider, type BaseEhrConfig } from "./ehr-provider.js";

const NEXTGEN_API_PROD = "https://nativeapi.nextgen.com/nge/prod/nge-api/api";
const NEXTGEN_API_SANDBOX = "https://nativeapi.nextgen.com/nge/sandbox/nge-api/api";
const NEXTGEN_TOKEN_URL_PROD = "https://nativeapi.nextgen.com/nge/prod/nge-oauth/oauth2/token";
const NEXTGEN_TOKEN_URL_SANDBOX = "https://nativeapi.nextgen.com/nge/sandbox/nge-oauth/oauth2/token";

interface NextGenConfig extends BaseEhrConfig {
  sandbox?: boolean;
}

const provider = makeEhrProvider<NextGenConfig>({
  providerName: "NextGen",
  configDoc: "integrations/nextgen",
  resolveApiBase: (cfg) => (cfg.sandbox ? NEXTGEN_API_SANDBOX : NEXTGEN_API_PROD),
  resolveTokenUrl: (cfg) => (cfg.sandbox ? NEXTGEN_TOKEN_URL_SANDBOX : NEXTGEN_TOKEN_URL_PROD),
  tokenRefreshAuth: (cfg) => ({
    headers: {},
    bodyExtras: {
      client_id: cfg.clientId || "",
      client_secret: cfg.clientSecret || "",
    },
  }),
});

export const proxyNextGen = provider.proxy;
export const assertNextGenReady = provider.assertReady;
export const getNextGenAccessToken = provider.getAccessToken;
