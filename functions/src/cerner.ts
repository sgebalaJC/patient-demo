/**
 * Cerner / Oracle Health (SMART-on-FHIR R4) integration — thin spec over
 * `makeEhrOAuth`. Same shape as eCW: per-practice FHIR base + admin-pasted
 * authorize / token URLs. Confidential or public SMART client.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { makeEhrOAuth, type OAuthTokenResponse, type TokenExchangeAuth } from "./lib/ehr-oauth.js";

const DEFAULT_SCOPE = "launch/patient openid fhirUser system/Patient.read system/Appointment.read system/Encounter.read";

function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}

function cernerTokenAuth(cfg: any): TokenExchangeAuth {
  if (cfg.clientSecret) {
    return {
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      },
      bodyExtras: {},
    };
  }
  return { headers: {}, bodyExtras: { client_id: cfg.clientId } };
}

const ehr = makeEhrOAuth({
  provider: "cerner",
  configDoc: "integrations/cerner",
  callbackName: "cernerCallback",
  defaultScope: DEFAULT_SCOPE,
  resolveAuthUrl: (cfg) => cfg.authUrl as string,
  resolveTokenUrl: (cfg) => cfg.tokenUrl as string,
  tokenExchangeAuth: cernerTokenAuth,
  validateExtraFields: (data) => {
    const fhirBase = (data?.fhirBase as string || "").trim().replace(/\/+$/, "");
    const authUrl = (data?.authUrl as string || "").trim();
    const tokenUrl = (data?.tokenUrl as string || "").trim();
    const scope = (data?.scope as string || "").trim() || DEFAULT_SCOPE;
    if (!fhirBase || !isHttpsUrl(fhirBase)) throw new HttpsError("invalid-argument", "fhirBase must be an https URL");
    if (!authUrl || !isHttpsUrl(authUrl)) throw new HttpsError("invalid-argument", "authUrl must be an https URL");
    if (!tokenUrl || !isHttpsUrl(tokenUrl)) throw new HttpsError("invalid-argument", "tokenUrl must be an https URL");
    return { fhirBase, authUrl, tokenUrl, scope };
  },
  credsChangeKeys: ["fhirBase", "authUrl", "tokenUrl"],
  extraAuthorizeParams: (cfg) => ({ aud: cfg.fhirBase as string }),
  resolvePostAuthFields: (tok: OAuthTokenResponse) => ({
    ...(tok.scope ? { grantedScope: tok.scope } : {}),
  }),
});

export const cernerSaveCredentials = ehr.saveCredentials;
export const cernerAuthorize = ehr.authorize;
export const cernerCallback = ehr.callback;
export const cernerSetEnabled = ehr.setEnabled;
export const cernerDisconnect = ehr.disconnect;
export const getCernerAccessToken = ehr.getAccessToken;
