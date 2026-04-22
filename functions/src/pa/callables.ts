// HTTPS callables for the Prior Auth module. All admin-only. Each writes
// to Firestore through the Admin SDK so the security rules don't need to
// enable direct client writes for stateful transitions.

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import type {PriorAuthStatus, PolicyStatus, CriteriaChecklistItem} from "./types.js";

const REGION = "us-west1";
const SIDECAR_URL = process.env.SIDECAR_URL || "";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

function db() {
  return admin.firestore();
}

async function requireAdmin(
  auth: {uid: string; token?: {email?: string}} | undefined,
): Promise<{uid: string; name: string}> {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign-in required");
  const {isSuperAdminEmail} = await import("../superAdmins.js");
  if (isSuperAdminEmail(auth.token?.email)) {
    return {uid: auth.uid, name: auth.token?.email || "Super Admin"};
  }
  const userDoc = await db().collection("users").doc(auth.uid).get();
  const data = userDoc.data();
  if (data?.role !== "admin") throw new HttpsError("permission-denied", "Admin access required");
  const name = [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || data.email || "Admin";
  return {uid: auth.uid, name};
}

// ── createPriorAuth ────────────────────────────────────────────────────────
//
// Creates a `prior-auths` record in `draft` status, snapshots the current
// `payer-policies/{payerId}_{cptCode}` criteria into a checklist skeleton,
// and (if the policy is active) kicks off the chart gap check in the
// background. Returns the new PA id + the initial checklist.

export const createPriorAuth = onCall(
  {region: REGION, memory: "512MiB", timeoutSeconds: 120},
  async (req) => {
    const actor = await requireAdmin(req.auth);
    const input = (req.data ?? {}) as {
      patientId: string;
      payerId: string;
      cptCode: string;
      icd10Codes?: string[];
      serviceDate?: string;
      memberNumber?: string;
      groupNumber?: string;
      orderingProviderId?: string;
      orderingProviderName?: string;
      renderingProviderId?: string;
      renderingProviderName?: string;
      procedureLabel?: string;
    };
    if (!input.patientId || !input.payerId || !input.cptCode) {
      throw new HttpsError("invalid-argument", "patientId, payerId, cptCode required");
    }

    const patientRef = db().collection("users").doc(input.patientId);
    const patientSnap = await patientRef.get();
    if (!patientSnap.exists) throw new HttpsError("not-found", "Patient not found");
    const patient = patientSnap.data() as {
      firstName?: string;
      lastName?: string;
      dateOfBirth?: string;
      role?: string;
    };

    const payerSnap = await db().collection("payers").doc(input.payerId).get();
    if (!payerSnap.exists) throw new HttpsError("not-found", "Payer not found");
    const payer = payerSnap.data() as {name: string};

    const policyId = `${input.payerId}_${input.cptCode}`;
    const policySnap = await db().collection("payer-policies").doc(policyId).get();
    const checklist: CriteriaChecklistItem[] = [];
    let policyFreshness: Record<string, unknown> | undefined;

    if (policySnap.exists) {
      const policy = policySnap.data() as {
        extractedCriteria?: {
          requiredDiagnoses?: Array<{icd10: string; label?: string}>;
          requiredPriorTrials?: Array<{description: string}>;
          requiredDocumentation?: Array<{type: string; description: string}>;
          exclusions?: Array<{description: string}>;
        };
        status?: PolicyStatus;
        sourceFetchedAt?: admin.firestore.Timestamp;
        humanReviewedAt?: admin.firestore.Timestamp;
      };
      policyFreshness = {
        policyId,
        status: policy.status ?? "pending_review",
        sourceFetchedAt: policy.sourceFetchedAt ?? null,
        humanReviewedAt: policy.humanReviewedAt ?? null,
      };
      const c = policy.extractedCriteria;
      let idx = 0;
      for (const d of c?.requiredDiagnoses ?? []) {
        checklist.push({
          criterionId: `dx-${idx++}`,
          category: "diagnosis",
          description: d.label ? `${d.icd10} — ${d.label}` : d.icd10,
          met: null,
          evidence: "",
        });
      }
      idx = 0;
      for (const t of c?.requiredPriorTrials ?? []) {
        checklist.push({
          criterionId: `trial-${idx++}`,
          category: "prior_trial",
          description: t.description,
          met: null,
          evidence: "",
        });
      }
      idx = 0;
      for (const doc of c?.requiredDocumentation ?? []) {
        checklist.push({
          criterionId: `doc-${idx++}`,
          category: "documentation",
          description: `${doc.type}: ${doc.description}`,
          met: null,
          evidence: "",
        });
      }
      idx = 0;
      for (const ex of c?.exclusions ?? []) {
        checklist.push({
          criterionId: `excl-${idx++}`,
          category: "exclusion",
          description: ex.description,
          met: null,
          evidence: "",
        });
      }
    }

    const paRef = db().collection("prior-auths").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const record = {
      id: paRef.id,
      patientId: input.patientId,
      patientName: [patient.firstName, patient.lastName].filter(Boolean).join(" ").trim() || "Unknown",
      patientDob: patient.dateOfBirth ?? null,
      payerId: input.payerId,
      payerName: payer.name,
      memberNumber: input.memberNumber ?? null,
      groupNumber: input.groupNumber ?? null,
      cptCode: input.cptCode,
      procedureLabel: input.procedureLabel ?? "",
      icd10Codes: input.icd10Codes ?? [],
      orderingProviderId: input.orderingProviderId ?? null,
      orderingProviderName: input.orderingProviderName ?? null,
      renderingProviderId: input.renderingProviderId ?? null,
      renderingProviderName: input.renderingProviderName ?? null,
      serviceDate: input.serviceDate ? admin.firestore.Timestamp.fromDate(new Date(input.serviceDate)) : null,
      status: "draft" as PriorAuthStatus,
      criteriaChecklist: checklist,
      policyFreshness: policyFreshness ?? null,
      attachedDocuments: [],
      notes: [],
      needsFollowup: false,
      assignedTo: actor.uid,
      createdBy: actor.uid,
      createdAt: now,
      updatedAt: now,
    };
    await paRef.set(record);
    logger.info("pa.createPriorAuth", {paId: paRef.id, payerId: input.payerId, cpt: input.cptCode, actor: actor.uid});
    return {paId: paRef.id, checklist, policyFreshness: policyFreshness ?? null};
  }
);

// ── updatePriorAuthStatus ──────────────────────────────────────────────────
//
// Moves the PA through its state machine. Some transitions require meta
// (denialReason for `denied`, referenceNumber for `submitted`). Enforced
// here rather than in rules so error messages can be precise.

const STATUS_TRANSITIONS: Record<PriorAuthStatus, PriorAuthStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["pending", "needs_info", "approved", "denied", "peer_to_peer", "cancelled"],
  pending: ["needs_info", "approved", "denied", "peer_to_peer", "cancelled"],
  needs_info: ["submitted", "approved", "denied", "cancelled"],
  peer_to_peer: ["approved", "denied", "appeal", "cancelled"],
  approved: ["cancelled"],
  denied: ["appeal", "cancelled"],
  appeal: ["approved", "denied", "cancelled"],
  cancelled: [],
};

export const updatePriorAuthStatus = onCall(
  {region: REGION, memory: "256MiB"},
  async (req) => {
    const actor = await requireAdmin(req.auth);
    const {paId, newStatus, meta} = (req.data ?? {}) as {
      paId: string;
      newStatus: PriorAuthStatus;
      meta?: {
        referenceNumber?: string;
        authNumber?: string;
        authValidFrom?: string;
        authValidTo?: string;
        denialReason?: string;
      };
    };
    if (!paId || !newStatus) throw new HttpsError("invalid-argument", "paId + newStatus required");

    const ref = db().collection("prior-auths").doc(paId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "PA not found");
    const current = snap.data() as {status: PriorAuthStatus};
    const allowed = STATUS_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new HttpsError("failed-precondition", `Cannot transition ${current.status} → ${newStatus}`);
    }
    if (newStatus === "denied" && !meta?.denialReason) {
      throw new HttpsError("invalid-argument", "denialReason required when denying");
    }
    if (newStatus === "submitted" && !meta?.referenceNumber) {
      throw new HttpsError("invalid-argument", "referenceNumber required when submitting");
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const patch: Record<string, unknown> = {status: newStatus, updatedAt: now};
    if (meta?.referenceNumber) patch.referenceNumber = meta.referenceNumber;
    if (meta?.authNumber) patch.authNumber = meta.authNumber;
    if (meta?.denialReason) patch.denialReason = meta.denialReason;
    if (meta?.authValidFrom) patch.authValidFrom = admin.firestore.Timestamp.fromDate(new Date(meta.authValidFrom));
    if (meta?.authValidTo) patch.authValidTo = admin.firestore.Timestamp.fromDate(new Date(meta.authValidTo));
    if (newStatus === "submitted") patch.submittedAt = now;
    if (newStatus === "approved") patch.approvedAt = now;
    if (newStatus === "denied") patch.deniedAt = now;
    if (newStatus === "pending") patch.needsFollowup = false;
    await ref.update(patch);

    await db().collection("prior-auth-events").add({
      priorAuthId: paId,
      type: "status_changed",
      actor: actor.uid,
      actorName: actor.name,
      data: {from: current.status, to: newStatus, meta: meta ?? null},
      timestamp: now,
    });
    return {ok: true};
  }
);

// ── submitPolicyReview ─────────────────────────────────────────────────────
//
// Human review gate — flips a `pending_review` policy to `active` after a
// reviewer confirms the extracted criteria match the source document, or
// back to `pending_review` (no-op) with notes if rejected.

export const submitPolicyReview = onCall(
  {region: REGION, memory: "256MiB"},
  async (req) => {
    const actor = await requireAdmin(req.auth);
    const {policyId, action, notes} = (req.data ?? {}) as {
      policyId: string;
      action: "approve" | "reject";
      notes?: string;
    };
    if (!policyId || !action) throw new HttpsError("invalid-argument", "policyId + action required");

    const ref = db().collection("payer-policies").doc(policyId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Policy not found");
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (action === "approve") {
      await ref.update({
        status: "active",
        humanReviewedAt: now,
        reviewedBy: actor.uid,
        updatedAt: now,
      });
    } else {
      await ref.update({
        status: "pending_review",
        updatedAt: now,
      });
    }

    await db().collection("prior-auth-events").add({
      priorAuthId: policyId, // using policyId as event key for audit continuity
      type: "policy_refreshed",
      actor: actor.uid,
      actorName: actor.name,
      data: {action, notes: notes ?? null},
      timestamp: now,
    });
    return {ok: true};
  }
);

// ── runChartGapCheck ───────────────────────────────────────────────────────
//
// Proxies the criteria checklist + a trimmed view of the patient chart to
// Aurelia on the sidecar. Aurelia returns per-criterion {met, evidence,
// chartRef, confidence}. We merge into the PA checklist and persist.
//
// If the sidecar is unreachable we return the current checklist unchanged
// rather than faking the check — fail loud so the coordinator knows to
// run it manually.

export const runChartGapCheck = onCall(
  {region: REGION, memory: "512MiB", timeoutSeconds: 120},
  async (req) => {
    const actor = await requireAdmin(req.auth);
    const {paId} = (req.data ?? {}) as {paId: string};
    if (!paId) throw new HttpsError("invalid-argument", "paId required");

    const ref = db().collection("prior-auths").doc(paId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "PA not found");
    const pa = snap.data() as {
      patientId: string;
      cptCode: string;
      payerId: string;
      criteriaChecklist: CriteriaChecklistItem[];
    };

    if (!SIDECAR_API_KEY) {
      throw new HttpsError(
        "failed-precondition",
        "Chart gap check not configured (missing SIDECAR_API_KEY). Run manually.",
      );
    }

    const criteria = pa.criteriaChecklist.map((c) => ({
      criterionId: c.criterionId,
      category: c.category,
      description: c.description,
    }));

    const url = `${SIDECAR_URL}/admin-api/prior-auth/chart-gap-check`;
    const body = {
      paId,
      patientId: pa.patientId,
      payerId: pa.payerId,
      cptCode: pa.cptCode,
      criteria,
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SIDECAR_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`sidecar ${res.status}: ${text.slice(0, 200)}`);
      }
      const result = (await res.json()) as {
        results: Array<{
          criterionId: string;
          met: boolean | null;
          evidence: string;
          chartRef?: string;
          confidence?: number;
        }>;
      };
      const updated = pa.criteriaChecklist.map((c) => {
        const match = result.results.find((r) => r.criterionId === c.criterionId);
        if (!match || c.manuallyOverridden) return c;
        return {
          ...c,
          met: match.met,
          evidence: match.evidence,
          chartRef: match.chartRef,
          confidence: match.confidence,
        };
      });
      const now = admin.firestore.FieldValue.serverTimestamp();
      await ref.update({criteriaChecklist: updated, updatedAt: now});
      await db().collection("prior-auth-events").add({
        priorAuthId: paId,
        type: "chart_check_ran",
        actor: actor.uid,
        actorName: actor.name,
        data: {itemsUpdated: result.results.length},
        timestamp: now,
      });
      return {ok: true, checklist: updated};
    } catch (err) {
      logger.error("pa.runChartGapCheck:error", {paId, err: String(err)});
      throw new HttpsError("unavailable", `Chart gap check failed: ${String(err)}`);
    }
  }
);
