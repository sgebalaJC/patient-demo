/**
 * Epic sidecar client — thin spec over `makeEhrProvider`.
 *
 * Per-org FHIR base + admin-pasted token URL. Confidential (App Orchard)
 * or public (sandbox) SMART clients.
 */

import { makeEhrProvider, smartDualModeTokenRefresh, type BaseEhrConfig } from "./ehr-provider.js";

interface EpicConfig extends BaseEhrConfig {
  fhirBase?: string;
  authUrl?: string;
  tokenUrl?: string;
  grantedScope?: string;
}

const provider = makeEhrProvider<EpicConfig>({
  providerName: "Epic",
  configDoc: "integrations/epic",
  resolveApiBase: (cfg) => (cfg.fhirBase || "").replace(/\/+$/, ""),
  resolveTokenUrl: (cfg) => cfg.tokenUrl || "",
  tokenRefreshAuth: smartDualModeTokenRefresh<EpicConfig>(),
  extraReadyChecks: (cfg) => {
    if (!cfg.fhirBase) throw new Error("Epic fhirBase missing — re-save credentials in the admin UI");
    if (!cfg.tokenUrl) throw new Error("Epic tokenUrl missing — re-save credentials in the admin UI");
  },
  acceptHeader: "application/fhir+json",
});

export const proxyEpic = provider.proxy;
export const assertEpicReady = provider.assertReady;
export const getEpicAccessToken = provider.getAccessToken;
