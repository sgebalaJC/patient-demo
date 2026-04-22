/**
 * DrChrono integration — admin-facing OAuth flow + credential storage.
 *
 * Thin spec over `makeEhrOAuth`. Super-admin gated (integration credentials
 * are platform-level, not per-practice).
 */

import { makeEhrOAuth } from "./lib/ehr-oauth.js";

const DRCHRONO_AUTH_URL = "https://drchrono.com/o/authorize/";
const DRCHRONO_TOKEN_URL = "https://drchrono.com/o/token/";

const ehr = makeEhrOAuth({
  provider: "drchrono",
  configDoc: "integrations/drchrono",
  callbackName: "drchronoCallback",
  defaultScope: "user:read patients:read patients:write calendar:read clinical:read clinical:write",
  resolveAuthUrl: () => DRCHRONO_AUTH_URL,
  resolveTokenUrl: () => DRCHRONO_TOKEN_URL,
});

export const drchronoSaveCredentials = ehr.saveCredentials;
export const drchronoAuthorize = ehr.authorize;
export const drchronoCallback = ehr.callback;
export const drchronoSetEnabled = ehr.setEnabled;
export const getDrChronoAccessToken = ehr.getAccessToken;
