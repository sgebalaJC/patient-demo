/**
 * Athenahealth integration — thin spec over `makeEhrOAuth`.
 *
 * Athena specifics: preview vs prod hosts, practiceId tenant, Basic-auth
 * token exchange. Super-admin gated.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { makeEhrOAuth } from "./lib/ehr-oauth.js";

const ATHENA_AUTH_URL_PROD = "https://api.athenahealth.com/oauth2/v1/authorize";
const ATHENA_TOKEN_URL_PROD = "https://api.athenahealth.com/oauth2/v1/token";
const ATHENA_AUTH_URL_PREVIEW = "https://api.preview.platform.athenahealth.com/oauth2/v1/authorize";
const ATHENA_TOKEN_URL_PREVIEW = "https://api.preview.platform.athenahealth.com/oauth2/v1/token";

const ehr = makeEhrOAuth({
  provider: "athena",
  configDoc: "integrations/athena",
  callbackName: "athenaCallback",
  defaultScope: "athena/service/Athenanet.MDP.* system/Patient.read system/Appointment.read",
  resolveAuthUrl: (cfg) => (cfg.preview ? ATHENA_AUTH_URL_PREVIEW : ATHENA_AUTH_URL_PROD),
  resolveTokenUrl: (cfg) => (cfg.preview ? ATHENA_TOKEN_URL_PREVIEW : ATHENA_TOKEN_URL_PROD),
  // Athena requires HTTP Basic at the token endpoint.
  tokenExchangeAuth: (cfg) => ({
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    bodyExtras: {},
  }),
  validateExtraFields: (data) => {
    const practiceId = (data?.practiceId as string || "").trim();
    const preview = Boolean(data?.preview);
    if (!practiceId || !/^[0-9]+$/.test(practiceId)) {
      throw new HttpsError("invalid-argument", "practiceId must be a numeric tenant id");
    }
    return { practiceId, preview };
  },
  credsChangeKeys: ["preview"],
});

export const athenaSaveCredentials = ehr.saveCredentials;
export const athenaAuthorize = ehr.authorize;
export const athenaCallback = ehr.callback;
export const athenaSetEnabled = ehr.setEnabled;
export const athenaDisconnect = ehr.disconnect;
export const getAthenaAccessToken = ehr.getAccessToken;
