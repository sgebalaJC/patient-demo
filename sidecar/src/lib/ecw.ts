/**
 * eClinicalWorks sidecar client — thin spec over `makeEhrProvider`.
 *
 * SMART-on-FHIR: per-practice FHIR base + auth/token URLs, FHIR content type,
 * confidential-or-public token auth.
 */

import { makeEhrProvider, smartDualModeTokenRefresh, type BaseEhrConfig } from "./ehr-provider.js";

interface EcwConfig extends BaseEhrConfig {
  fhirBase?: string;
  authUrl?: string;
  tokenUrl?: string;
  grantedScope?: string;
}

const provider = makeEhrProvider<EcwConfig>({
  providerName: "eCW",
  configDoc: "integrations/ecw",
  resolveApiBase: (cfg) => (cfg.fhirBase || "").replace(/\/+$/, ""),
  resolveTokenUrl: (cfg) => cfg.tokenUrl || "",
  tokenRefreshAuth: smartDualModeTokenRefresh<EcwConfig>(),
  extraReadyChecks: (cfg) => {
    if (!cfg.fhirBase) {
      throw new Error("eCW fhirBase missing — re-save credentials in the admin UI");
    }
    if (!cfg.tokenUrl) {
      throw new Error("eCW tokenUrl missing — re-save credentials in the admin UI");
    }
  },
  acceptHeader: "application/fhir+json",
});

export const proxyEcw = provider.proxy;
export const assertEcwReady = provider.assertReady;
export const getEcwAccessToken = provider.getAccessToken;
