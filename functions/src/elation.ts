/**
 * Elation Health integration — thin spec over `makeEhrOAuth`.
 *
 * Sandbox vs prod hosts. Body-auth token exchange (default). Super-admin gated.
 */

import { makeEhrOAuth } from "./lib/ehr-oauth.js";

const ELATION_AUTH_URL_PROD = "https://app.elationemr.com/oauth2/authorize/";
const ELATION_TOKEN_URL_PROD = "https://app.elationemr.com/api/2.0/oauth2/token/";
const ELATION_AUTH_URL_SANDBOX = "https://sandbox.elationemr.com/oauth2/authorize/";
const ELATION_TOKEN_URL_SANDBOX = "https://sandbox.elationemr.com/api/2.0/oauth2/token/";

const ehr = makeEhrOAuth({
  provider: "elation",
  configDoc: "integrations/elation",
  callbackName: "elationCallback",
  defaultScope: "all",
  resolveAuthUrl: (cfg) => (cfg.sandbox ? ELATION_AUTH_URL_SANDBOX : ELATION_AUTH_URL_PROD),
  resolveTokenUrl: (cfg) => (cfg.sandbox ? ELATION_TOKEN_URL_SANDBOX : ELATION_TOKEN_URL_PROD),
  validateExtraFields: (data) => ({ sandbox: Boolean(data?.sandbox) }),
  credsChangeKeys: ["sandbox"],
});

export const elationSaveCredentials = ehr.saveCredentials;
export const elationAuthorize = ehr.authorize;
export const elationCallback = ehr.callback;
export const elationSetEnabled = ehr.setEnabled;
export const getElationAccessToken = ehr.getAccessToken;
