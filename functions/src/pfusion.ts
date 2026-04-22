/**
 * Practice Fusion integration — thin spec over `makeEhrOAuth`.
 *
 * Practice Fusion exposes OAuth2 + REST. No separate sandbox environment;
 * test tenants are provisioned on the same host.
 */

import { makeEhrOAuth } from "./lib/ehr-oauth.js";

const PFUSION_AUTH_URL = "https://www.practicefusion.com/ehr/oauth2/authorize";
const PFUSION_TOKEN_URL = "https://www.practicefusion.com/ehr/oauth2/token";

const ehr = makeEhrOAuth({
  provider: "pfusion",
  configDoc: "integrations/pfusion",
  callbackName: "pfusionCallback",
  defaultScope: "api",
  resolveAuthUrl: () => PFUSION_AUTH_URL,
  resolveTokenUrl: () => PFUSION_TOKEN_URL,
  tokenExchangeAuth: (cfg) => ({
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    bodyExtras: {},
  }),
});

export const pfusionSaveCredentials = ehr.saveCredentials;
export const pfusionAuthorize = ehr.authorize;
export const pfusionCallback = ehr.callback;
export const pfusionSetEnabled = ehr.setEnabled;
export const getPfusionAccessToken = ehr.getAccessToken;
