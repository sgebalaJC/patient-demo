// Firestore triggers for the Prior Auth module.
// - onPriorAuthWrite: appends audit events for created / criteria_updated /
//   note_added / document_attached. Status transitions are logged from
//   updatePriorAuthStatus directly so we don't duplicate.
// - paFollowupCron: marks submitted PAs older than PA_FOLLOWUP_DAYS as
//   needing a followup so they surface in the coordinator's queue.

import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";

const PA_FOLLOWUP_DAYS = 5;

function db() {
  return admin.firestore();
}

export const onPriorAuthWrite = onDocumentWritten(
  {document: "prior-auths/{paId}", region: "us-west1"},
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const paId = event.params.paId;
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (!before && after) {
      await db().collection("prior-auth-events").add({
        priorAuthId: paId,
        type: "created",
        actor: after.createdBy ?? "system",
        data: {payerId: after.payerId, cptCode: after.cptCode},
        timestamp: now,
      });
      return;
    }

    if (!after) return; // deletion — no event

    // Criteria checklist changes (ignore when just policyFreshness or
    // updatedAt changed, to avoid noise).
    const beforeChecklist = JSON.stringify(before?.criteriaChecklist ?? []);
    const afterChecklist = JSON.stringify(after.criteriaChecklist ?? []);
    if (beforeChecklist !== afterChecklist) {
      await db().collection("prior-auth-events").add({
        priorAuthId: paId,
        type: "criteria_updated",
        actor: after.updatedBy ?? "system",
        data: {itemCount: after.criteriaChecklist?.length ?? 0},
        timestamp: now,
      });
    }

    const beforeNotes = before?.notes?.length ?? 0;
    const afterNotes = after.notes?.length ?? 0;
    if (afterNotes > beforeNotes) {
      const newest = after.notes[after.notes.length - 1];
      await db().collection("prior-auth-events").add({
        priorAuthId: paId,
        type: "note_added",
        actor: newest.authorId ?? "system",
        actorName: newest.authorName ?? null,
        data: {textPreview: (newest.text ?? "").slice(0, 140)},
        timestamp: now,
      });
    }

    const beforeDocs = before?.attachedDocuments?.length ?? 0;
    const afterDocs = after.attachedDocuments?.length ?? 0;
    if (afterDocs > beforeDocs) {
      const newest = after.attachedDocuments[after.attachedDocuments.length - 1];
      await db().collection("prior-auth-events").add({
        priorAuthId: paId,
        type: "document_attached",
        actor: newest.uploadedBy ?? "system",
        data: {name: newest.name, size: newest.size},
        timestamp: now,
      });
    }
  }
);

// Daily followup flagger. Runs at 09:00 Los Angeles so the queue is fresh
// at the start of the coordinator's workday.
export const paFollowupCron = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "America/Los_Angeles",
    region: "us-west1",
    memory: "256MiB",
  },
  async () => {
    const cutoff = admin.firestore.Timestamp.fromMillis(
      Date.now() - PA_FOLLOWUP_DAYS * 24 * 60 * 60 * 1000
    );
    const q = await db()
      .collection("prior-auths")
      .where("status", "in", ["submitted", "pending", "needs_info"])
      .where("updatedAt", "<", cutoff)
      .get();
    let flagged = 0;
    const batch = db().batch();
    for (const d of q.docs) {
      const data = d.data();
      if (!data.needsFollowup) {
        batch.update(d.ref, {
          needsFollowup: true,
          lastFollowupAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        flagged++;
      }
    }
    if (flagged) await batch.commit();
    logger.info("pa.followupCron:done", {flagged, scanned: q.size});
  }
);
