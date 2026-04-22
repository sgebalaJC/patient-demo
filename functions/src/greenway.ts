/**
 * Greenway Health (Intergy / Prime Suite) integration — thin spec over
 * `makeEhrOAuth`. OAuth2 authorization code, sandbox/prod toggle.
 */

import { makeEhrOAuth } from "./lib/ehr-oauth.js";

const GREENWAY_AUTH_URL_PROD = "https://apis.greenwayhealth.com/oauth2/authorize";
const GREENWAY_TOKEN_URL_PROD = "https://apis.greenwayhealth.com/oauth2/token";
const GREENWAY_AUTH_URL_SANDBOX = "https://apis-sandbox.greenwayhealth.com/oauth2/authorize";
const GREENWAY_TOKEN_URL_SANDBOX = "https://apis-sandbox.greenwayhealth.com/oauth2/token";

const ehr = makeEhrOAuth({
  provider: "greenway",
  configDoc: "integrations/greenway",
  callbackName: "greenwayCallback",
  defaultScope: "openid offline_access api",
  resolveAuthUrl: (cfg) => (cfg.sandbox ? GREENWAY_AUTH_URL_SANDBOX : GREENWAY_AUTH_URL_PROD),
  resolveTokenUrl: (cfg) => (cfg.sandbox ? GREENWAY_TOKEN_URL_SANDBOX : GREENWAY_TOKEN_URL_PROD),
  validateExtraFields: (data) => ({ sandbox: Boolean(data?.sandbox) }),
  credsChangeKeys: ["sandbox"],
});

export const greenwaySaveCredentials = ehr.saveCredentials;
export const greenwayAuthorize = ehr.authorize;
export const greenwayCallback = ehr.callback;
export const greenwaySetEnabled = ehr.setEnabled;
export const greenwayDisconnect = ehr.disconnect;
export const getGreenwayAccessToken = ehr.getAccessToken;
