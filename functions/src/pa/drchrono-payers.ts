// One-shot job: pull the practice's patient_insurances from DrChrono, group
// by carrier name, rank by count. Writes to `payer-candidates` for the
// seeding step to optionally use as the top-10 list. Never mutates the
// canonical `payers` collection directly — operator reviews candidates and
// maps them to our adapter IDs.

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import {getDrChronoAccessToken} from "../drchrono.js";

const DRCHRONO_API = "https://app.drchrono.com/api";
const REGION = "us-west1";

function db() {
  return admin.firestore();
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

interface DrChronoPatientInsurance {
  insurance_company?: string;
  insurance_plan_name?: string;
  rank?: string;
  patient?: number | string;
}

export const extractTopPayers = onCall(
  {region: REGION, memory: "1GiB", timeoutSeconds: 540},
  async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Sign-in required");
    const {isSuperAdminEmail} = await import("../superAdmins.js");
    if (!isSuperAdminEmail(req.auth.token?.email)) {
      const userDoc = await db().collection("users").doc(req.auth.uid).get();
      if (userDoc.data()?.role !== "admin") throw new HttpsError("permission-denied", "Admin access required");
    }

    const token = await getDrChronoAccessToken();
    const counts = new Map<string, {carrierName: string; plans: Set<string>; patients: Set<string>}>();

    // Primary insurance only (rank=primary). Paginate through the full list.
    let url: string | null = `${DRCHRONO_API}/patient_insurances?page_size=250&rank=primary`;
    let pages = 0;
    while (url) {
      const res = await fetch(url, {headers: {Authorization: `Bearer ${token}`}});
      if (!res.ok) {
        throw new Error(`DrChrono /patient_insurances failed: ${res.status}`);
      }
      const env = (await res.json()) as {results: DrChronoPatientInsurance[]; next: string | null};
      for (const ins of env.results) {
        const carrier = (ins.insurance_company || "").trim();
        if (!carrier) continue;
        const key = normalize(carrier);
        let entry = counts.get(key);
        if (!entry) {
          entry = {carrierName: carrier, plans: new Set(), patients: new Set()};
          counts.set(key, entry);
        }
        if (ins.insurance_plan_name) entry.plans.add(ins.insurance_plan_name);
        if (ins.patient) entry.patients.add(String(ins.patient));
      }
      url = env.next;
      pages++;
      if (pages > 50) break; // hard safety — realistic practices never need this many pages
    }

    const ranked = Array.from(counts.entries())
      .map(([norm, v]) => ({
        id: norm,
        normalizedName: norm,
        carrierName: v.carrierName,
        patientCount: v.patients.size,
        samplePlans: Array.from(v.plans).slice(0, 10),
        sampleDrChronoIds: Array.from(v.patients).slice(0, 5),
      }))
      .sort((a, b) => b.patientCount - a.patientCount);

    const batch = db().batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    for (const entry of ranked) {
      const ref = db().collection("payer-candidates").doc(entry.id);
      batch.set(ref, {...entry, createdAt: now}, {merge: true});
    }
    await batch.commit();

    logger.info("pa.extractTopPayers:done", {distinctCarriers: ranked.length, pages});
    return {distinctCarriers: ranked.length, topTen: ranked.slice(0, 10)};
  }
);
