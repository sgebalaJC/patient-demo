/**
 * Cerner / Oracle Health sidecar client — thin spec over `makeEhrProvider`.
 *
 * Same shape as eCW: admin-entered FHIR base + token URL per practice,
 * confidential or public SMART auth, FHIR content types.
 */

import { makeEhrProvider, smartDualModeTokenRefresh, type BaseEhrConfig } from "./ehr-provider.js";

interface CernerConfig extends BaseEhrConfig {
  fhirBase?: string;
  authUrl?: string;
  tokenUrl?: string;
  grantedScope?: string;
}

const provider = makeEhrProvider<CernerConfig>({
  providerName: "Cerner",
  configDoc: "integrations/cerner",
  resolveApiBase: (cfg) => (cfg.fhirBase || "").replace(/\/+$/, ""),
  resolveTokenUrl: (cfg) => cfg.tokenUrl || "",
  tokenRefreshAuth: smartDualModeTokenRefresh<CernerConfig>(),
  extraReadyChecks: (cfg) => {
    if (!cfg.fhirBase) throw new Error("Cerner fhirBase missing — re-save credentials in the admin UI");
    if (!cfg.tokenUrl) throw new Error("Cerner tokenUrl missing — re-save credentials in the admin UI");
  },
  acceptHeader: "application/fhir+json",
});

export const proxyCerner = provider.proxy;
export const assertCernerReady = provider.assertReady;
export const getCernerAccessToken = provider.getAccessToken;
