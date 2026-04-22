/**
 * Tebra (formerly Kareo) integration — thin spec over `makeEhrOAuth`.
 *
 * Fixed hosts (no sandbox toggle). OAuth2 authorization code flow with
 * Basic-auth token exchange — matches Kareo/Tebra's partner API pattern.
 */

import { makeEhrOAuth } from "./lib/ehr-oauth.js";

const TEBRA_AUTH_URL = "https://api.tebra.com/oauth2/authorize";
const TEBRA_TOKEN_URL = "https://api.tebra.com/oauth2/token";

const ehr = makeEhrOAuth({
  provider: "tebra",
  configDoc: "integrations/tebra",
  callbackName: "tebraCallback",
  defaultScope: "api",
  resolveAuthUrl: () => TEBRA_AUTH_URL,
  resolveTokenUrl: () => TEBRA_TOKEN_URL,
  tokenExchangeAuth: (cfg) => ({
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    bodyExtras: {},
  }),
});

export const tebraSaveCredentials = ehr.saveCredentials;
export const tebraAuthorize = ehr.authorize;
export const tebraCallback = ehr.callback;
export const tebraSetEnabled = ehr.setEnabled;
export const tebraDisconnect = ehr.disconnect;
export const getTebraAccessToken = ehr.getAccessToken;
