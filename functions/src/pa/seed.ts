// One-shot seeding of payers, target CPTs, and feature flag. Admin-only.
// Safe to re-run (merge-writes). Per-fork: tweak PAYER_SEEDS + CPT_LABELS to
// match the practice's actual carrier mix and procedure set.

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import {ALL_ADAPTERS} from "./adapters/index.js";
import {TARGET_CPT_CODES} from "./types.js";

const REGION = "us-west1";

function db() {
  return admin.firestore();
}

interface PayerSeed {
  id: string;
  name: string;
  type: "commercial" | "medicare" | "medicaid" | "medicare_advantage";
  state?: string;
  policyIndexUrl?: string;
}

// Default seeds: CMS is always useful; regional commercials below are stubs
// except Aetna / UHC / Blue Shield CA / Health Net (real adapters ship). Add
// state-specific Medicaid per fork.
const PAYER_SEEDS: PayerSeed[] = [
  {id: "cms-medicare", name: "Medicare (CMS)", type: "medicare", policyIndexUrl: "https://www.cms.gov/medicare-coverage-database/"},
  {id: "aetna-commercial", name: "Aetna Commercial", type: "commercial", policyIndexUrl: "https://www.aetna.com/cpb/medical/data/cpb_num.html"},
  {id: "uhc-commercial", name: "UnitedHealthcare Commercial", type: "commercial", policyIndexUrl: "https://www.uhcprovider.com/en/policies-protocols/commercial-policies/commercial-medical-drug-policies.html"},
  {id: "blue-shield-ca", name: "Blue Shield of California", type: "commercial", state: "CA", policyIndexUrl: "https://www.blueshieldca.com/en/provider/authorizations/policy-medical/list"},
  {id: "health-net-ca", name: "Health Net (CA)", type: "commercial", state: "CA", policyIndexUrl: "https://www.healthnet.com/content/healthnet/en_us/providers/policies-menu.html"},
  {id: "cigna-commercial", name: "Cigna Commercial", type: "commercial", policyIndexUrl: "https://static.cigna.com/assets/chcp/resourceLibrary/coveragePolicies/medical_a-z.html"},
  {id: "anthem-bcbs", name: "Anthem Blue Cross Blue Shield", type: "commercial"},
  {id: "humana-commercial", name: "Humana Commercial", type: "commercial", policyIndexUrl: "https://mcp.humana.com/tad/tad_new/home.aspx?type=provider"},
  {id: "kaiser-permanente", name: "Kaiser Permanente", type: "commercial"},
];

const CPT_LABELS: Record<string, string> = {
  "72148": "MRI lumbar spine without contrast",
  "72146": "MRI thoracic spine without contrast",
  "72141": "MRI cervical spine without contrast",
  "70553": "MRI brain with and without contrast",
  "74181": "MRI abdomen without contrast",
  "77067": "Screening mammography",
  "95810": "Polysomnography (sleep study)",
  "93880": "Duplex scan extracranial arteries",
  "97110": "Therapeutic exercises, 15 minutes",
  "20610": "Arthrocentesis, major joint",
};

export const seedPaData = onCall(
  {region: REGION, memory: "512MiB"},
  async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Sign-in required");
    const {isSuperAdminEmail} = await import("../superAdmins.js");
    if (!isSuperAdminEmail(req.auth.token?.email)) {
      const userDoc = await db().collection("users").doc(req.auth.uid).get();
      if (userDoc.data()?.role !== "admin") throw new HttpsError("permission-denied", "Admin access required");
    }

    const adapterStatusById = Object.fromEntries(
      ALL_ADAPTERS.map((a) => [
        a.meta.payerId,
        {status: a.meta.status, notes: a.meta.reason ?? null, delegatedTo: a.meta.delegatedTo ?? null},
      ])
    );

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db().batch();

    for (const p of PAYER_SEEDS) {
      const st = adapterStatusById[p.id] ?? {status: "not_implemented", notes: "no adapter", delegatedTo: null};
      batch.set(
        db().collection("payers").doc(p.id),
        {
          id: p.id,
          name: p.name,
          type: p.type,
          state: p.state ?? null,
          policyIndexUrl: p.policyIndexUrl ?? null,
          active: true,
          adapterStatus: st.status,
          adapterNotes: st.notes ?? null,
          adapterDelegatedTo: st.delegatedTo ?? null,
          updatedAt: now,
          createdAt: now,
        },
        {merge: true}
      );
    }

    for (const cpt of TARGET_CPT_CODES) {
      batch.set(
        db().collection("target-cpts").doc(cpt),
        {
          id: cpt,
          cptCode: cpt,
          label: CPT_LABELS[cpt] ?? cpt,
          active: true,
          updatedAt: now,
          createdAt: now,
        },
        {merge: true}
      );
    }

    batch.set(
      db().collection("system").doc("settings"),
      {features: {priorAuth: true}, updatedAt: now},
      {merge: true}
    );

    await batch.commit();

    logger.info("pa.seed:done", {payers: PAYER_SEEDS.length, cpts: TARGET_CPT_CODES.length});
    return {payers: PAYER_SEEDS.length, cpts: TARGET_CPT_CODES.length};
  }
);
