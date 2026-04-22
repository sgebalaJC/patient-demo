/**
 * NextGen Healthcare integration — thin spec over `makeEhrOAuth`.
 *
 * NextGen ships sandbox + prod environments on distinct OAuth endpoints.
 * Admin picks one at credential-save time; the factory resolves URLs
 * from the stored config.
 */

import { makeEhrOAuth } from "./lib/ehr-oauth.js";

const NEXTGEN_AUTH_URL_PROD = "https://nativeapi.nextgen.com/nge/prod/nge-oauth/oauth2/auth";
const NEXTGEN_TOKEN_URL_PROD = "https://nativeapi.nextgen.com/nge/prod/nge-oauth/oauth2/token";
const NEXTGEN_AUTH_URL_SANDBOX = "https://nativeapi.nextgen.com/nge/sandbox/nge-oauth/oauth2/auth";
const NEXTGEN_TOKEN_URL_SANDBOX = "https://nativeapi.nextgen.com/nge/sandbox/nge-oauth/oauth2/token";

const ehr = makeEhrOAuth({
  provider: "nextgen",
  configDoc: "integrations/nextgen",
  callbackName: "nextgenCallback",
  defaultScope: "openid api",
  resolveAuthUrl: (cfg) => (cfg.sandbox ? NEXTGEN_AUTH_URL_SANDBOX : NEXTGEN_AUTH_URL_PROD),
  resolveTokenUrl: (cfg) => (cfg.sandbox ? NEXTGEN_TOKEN_URL_SANDBOX : NEXTGEN_TOKEN_URL_PROD),
  validateExtraFields: (data) => ({ sandbox: Boolean(data?.sandbox) }),
  credsChangeKeys: ["sandbox"],
});

export const nextgenSaveCredentials = ehr.saveCredentials;
export const nextgenAuthorize = ehr.authorize;
export const nextgenCallback = ehr.callback;
export const nextgenSetEnabled = ehr.setEnabled;
export const getNextGenAccessToken = ehr.getAccessToken;
