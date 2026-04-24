/**
 * Tebra (Kareo) sidecar client — thin spec over `makeEhrProvider`.
 */

import { basicAuthTokenRefresh, makeEhrProvider, type BaseEhrConfig } from "./ehr-provider.js";

const TEBRA_API = "https://api.tebra.com/v1";
const TEBRA_TOKEN_URL = "https://api.tebra.com/oauth2/token";

const provider = makeEhrProvider<BaseEhrConfig>({
  providerName: "Tebra",
  configDoc: "integrations/tebra",
  resolveApiBase: () => TEBRA_API,
  resolveTokenUrl: () => TEBRA_TOKEN_URL,
  tokenRefreshAuth: basicAuthTokenRefresh<BaseEhrConfig>(),
});

export const proxyTebra = provider.proxy;
export const assertTebraReady = provider.assertReady;
export const getTebraAccessToken = provider.getAccessToken;
