/**
 * eClinicalWorks (SMART-on-FHIR) — thin spec over `makeEhrOAuth`.
 *
 * Per-practice FHIR base + admin-pasted authorize/token URLs. Supports
 * both confidential (Basic auth with client secret) and public (client_id
 * in body) OAuth clients. Authorize includes `aud=<fhirBase>` as required
 * by SMART v2. Granted scope is stored separately from the configured scope.
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

function ecwTokenAuth(cfg: any): TokenExchangeAuth {
  // Confidential clients (secret present) use Basic; public clients put
  // client_id in the body per SMART v2.
  if (cfg.clientSecret) {
    return {
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      },
      bodyExtras: {},
    };
  }
  return {
    headers: {},
    bodyExtras: { client_id: cfg.clientId },
  };
}

const ehr = makeEhrOAuth({
  provider: "ecw",
  configDoc: "integrations/ecw",
  callbackName: "ecwCallback",
  defaultScope: DEFAULT_SCOPE,
  resolveAuthUrl: (cfg) => cfg.authUrl as string,
  resolveTokenUrl: (cfg) => cfg.tokenUrl as string,
  tokenExchangeAuth: ecwTokenAuth,
  validateExtraFields: (data) => {
    const fhirBase = (data?.fhirBase as string || "").trim().replace(/\/+$/, "");
    const authUrl = (data?.authUrl as string || "").trim();
    const tokenUrl = (data?.tokenUrl as string || "").trim();
    const scope = (data?.scope as string || "").trim() || DEFAULT_SCOPE;
    if (!fhirBase || !isHttpsUrl(fhirBase)) {
      throw new HttpsError("invalid-argument", "fhirBase must be an https URL");
    }
    if (!authUrl || !isHttpsUrl(authUrl)) {
      throw new HttpsError("invalid-argument", "authUrl must be an https URL");
    }
    if (!tokenUrl || !isHttpsUrl(tokenUrl)) {
      throw new HttpsError("invalid-argument", "tokenUrl must be an https URL");
    }
    return { fhirBase, authUrl, tokenUrl, scope };
  },
  credsChangeKeys: ["fhirBase", "authUrl", "tokenUrl"],
  extraAuthorizeParams: (cfg) => ({ aud: cfg.fhirBase as string }),
  // SMART v2: preserve the admin-configured scope; record granted scope separately.
  resolvePostAuthFields: (tok: OAuthTokenResponse) => ({
    ...(tok.scope ? { grantedScope: tok.scope } : {}),
  }),
});

export const ecwSaveCredentials = ehr.saveCredentials;
export const ecwAuthorize = ehr.authorize;
export const ecwCallback = ehr.callback;
export const ecwSetEnabled = ehr.setEnabled;
export const ecwDisconnect = ehr.disconnect;
export const getEcwAccessToken = ehr.getAccessToken;
