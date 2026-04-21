// Stub adapter factory for payers whose policy sources are gated, delegated
// to a vendor that prohibits automation, or published only as multi-hundred-
// page consolidated PDFs whose per-CPT extraction needs dedicated work.
//
// Each stub returns no policy resolution so the fetcher skips it without
// marking records broken; the payer doc carries adapterStatus + adapterNotes
// so the UI can explain manual lookup is required and deep-link to the
// payer's policy site.
//
// When a stub is upgraded to a real adapter, swap it in the adapter registry
// (./index.ts) and backfill the CPT URL map.

import type {PayerAdapter, PolicyResolution, FetchResult} from "../types.js";
import {DEFAULT_USER_AGENT} from "./shared.js";

export function buildStubAdapter(args: {
  payerId: string;
  name: string;
  status: PayerAdapter["meta"]["status"];
  reason: string;
  delegatedTo?: string;
}): PayerAdapter {
  const {payerId, name, status, reason, delegatedTo} = args;
  return {
    meta: {payerId, name, status, reason, delegatedTo, userAgent: DEFAULT_USER_AGENT, requestDelayMs: 2000},
    async resolveUrl(_cpt: string): Promise<PolicyResolution | null> {
      return null;
    },
    async fetch(_url: string): Promise<FetchResult> {
      throw new Error(`Adapter ${payerId} is a stub: ${reason}`);
    },
    parseEffectiveDate() {
      return null;
    },
    parseLastRevisedDate() {
      return null;
    },
    extractPolicyBody(raw: string): string {
      return raw;
    },
  };
}

// Example stubs shipped with the template. Per-fork: add/remove here and in
// `seed.ts` + the adapter registry based on the practice's actual carrier mix.
export const cignaAdapter = buildStubAdapter({
  payerId: "cigna-commercial",
  name: "Cigna Commercial",
  status: "not_implemented",
  reason: "Cigna site ToU prohibits automated retrieval; imaging delegated to eviCore. Use Cigna coverage policy lookup manually.",
  delegatedTo: "eviCore",
});

export const humanaAdapter = buildStubAdapter({
  payerId: "humana-commercial",
  name: "Humana Commercial",
  status: "not_implemented",
  reason: "Imaging vendor migrating (HealthHelp → Cohere); policy URL slugs non-standard. Per-CPT map TBD.",
  delegatedTo: "HealthHelp/Cohere",
});

export const anthemAdapter = buildStubAdapter({
  payerId: "anthem-bcbs",
  name: "Anthem Blue Cross Blue Shield",
  status: "not_implemented",
  reason: "Anthem robots.txt disallows /medicalpolicies and ToU prohibits automated retrieval; imaging delegated to Carelon MBM.",
  delegatedTo: "Carelon",
});

export const kaiserAdapter = buildStubAdapter({
  payerId: "kaiser-permanente",
  name: "Kaiser Permanente",
  status: "no_public_policy",
  reason: "Kaiser is an integrated HMO and does not publish CPT-level commercial coverage policies. Medicare Advantage defers to CMS NCDs.",
});
