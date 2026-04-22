/**
 * Epic (SMART-on-FHIR R4) integration — thin spec over `makeEhrOAuth`.
 *
 * Per-organization FHIR base + admin-pasted authorize / token URLs (each
 * Epic customer has its own endpoints). Confidential or public SMART client.
 * Requires App Orchard enrollment before Epic will issue production client
 * credentials — sandbox available at fhir.epic.com without enrollment.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { makeEhrOAuth, type OAuthTokenResponse, type TokenExchangeAuth } from "./lib/ehr-oauth.js";

const DEFAULT_SCOPE = "launch/patient openid fhirUser system/Patient.read system/Appointment.read system/Encounter.read system/Observation.read";

function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}

function epicTokenAuth(cfg: any): TokenExchangeAuth {
  // Epic accepts either confidential (Basic) or public (client_id in body).
  // Production App Orchard apps are usually confidential.
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
  provider: "epic",
  configDoc: "integrations/epic",
  callbackName: "epicCallback",
  defaultScope: DEFAULT_SCOPE,
  resolveAuthUrl: (cfg) => cfg.authUrl as string,
  resolveTokenUrl: (cfg) => cfg.tokenUrl as string,
  tokenExchangeAuth: epicTokenAuth,
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

export const epicSaveCredentials = ehr.saveCredentials;
export const epicAuthorize = ehr.authorize;
export const epicCallback = ehr.callback;
export const epicSetEnabled = ehr.setEnabled;
export const getEpicAccessToken = ehr.getAccessToken;
