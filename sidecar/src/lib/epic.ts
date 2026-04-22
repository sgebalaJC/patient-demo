/**
 * Epic sidecar client — thin spec over `makeEhrProvider`.
 *
 * Per-org FHIR base + admin-pasted token URL. Confidential (App Orchard)
 * or public (sandbox) SMART clients.
 */

import { makeEhrProvider, type BaseEhrConfig } from "./ehr-provider.js";

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
  tokenRefreshAuth: (cfg) => {
    if (cfg.clientSecret) {
      return {
        headers: {
          Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
        },
        bodyExtras: {},
      };
    }
    return { headers: {}, bodyExtras: { client_id: cfg.clientId || "" } };
  },
  extraReadyChecks: (cfg) => {
    if (!cfg.fhirBase) throw new Error("Epic fhirBase missing — re-save credentials in the admin UI");
    if (!cfg.tokenUrl) throw new Error("Epic tokenUrl missing — re-save credentials in the admin UI");
  },
  acceptHeader: "application/fhir+json",
});

export const proxyEpic = provider.proxy;
export const assertEpicReady = provider.assertReady;
export const getEpicAccessToken = provider.getAccessToken;
