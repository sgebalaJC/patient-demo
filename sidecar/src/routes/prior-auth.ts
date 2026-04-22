/**
 * Prior-auth admin-api routes. Lightweight Firestore reads + note
 * append, so Aurelia's prior-auth skill works end-to-end. Status
 * transitions (submit/approve/deny) stay in the admin UI — they run
 * the server-side state machine in Cloud Functions.
 *
 * Chart gap-check is 501 here — that endpoint does LLM-driven criteria
 * matching which still lives in the runChartGapCheck Cloud Function.
 */
import { getDb } from "../lib/firebase.js";
import { FieldValue } from "firebase-admin/firestore";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function tsToISO(ts: any): string | null {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  return String(ts);
}

function mapPa(id: string, d: any) {
  return {
    id,
    ...d,
    createdAt: tsToISO(d.createdAt),
    updatedAt: tsToISO(d.updatedAt),
    submittedAt: tsToISO(d.submittedAt),
    decisionAt: tsToISO(d.decisionAt),
  };
}

export async function listPriorAuths(url: URL): Promise<Response> {
  const status = url.searchParams.get("status");
  const payerId = url.searchParams.get("payerId");
  const limit = Math.min(Number(url.searchParams.get("limit") || 25), 100);

  let q: FirebaseFirestore.Query = getDb()
    .collection("prior-auths")
    .orderBy("updatedAt", "desc")
    .limit(limit);
  if (status) q = q.where("status", "==", status);
  if (payerId) q = q.where("payerId", "==", payerId);

  const snap = await q.get();
  return json({
    priorAuths: snap.docs.map((d) => mapPa(d.id, d.data())),
    count: snap.size,
  });
}

export async function getPriorAuth(paId: string): Promise<Response> {
  const snap = await getDb().collection("prior-auths").doc(paId).get();
  if (!snap.exists) return json({ error: "PA not found" }, 404);
  return json(mapPa(snap.id, snap.data()));
}

export async function listPriorAuthEvents(paId: string, url: URL): Promise<Response> {
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
  const snap = await getDb()
    .collection("prior-auth-events")
    .where("priorAuthId", "==", paId)
    .orderBy("timestamp", "desc")
    .limit(limit)
    .get();
  return json({
    events: snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      timestamp: tsToISO(d.data().timestamp),
    })),
    count: snap.size,
  });
}

export async function appendPriorAuthNote(paId: string, request: Request): Promise<Response> {
  const body = (await request.clone().json().catch(() => null)) as {
    text?: string;
    authorName?: string;
  } | null;
  if (!body?.text || typeof body.text !== "string") {
    return json({ error: "text required" }, 400);
  }
  const text = body.text.trim().slice(0, 4000);
  if (!text) return json({ error: "text required" }, 400);

  const ref = getDb().collection("prior-auths").doc(paId);
  const snap = await ref.get();
  if (!snap.exists) return json({ error: "PA not found" }, 404);

  const note = {
    id: `note-${Date.now()}`,
    text,
    authorId: "agent",
    authorName: body.authorName || "Agent",
    createdAt: new Date().toISOString(),
  };
  await ref.update({
    notes: FieldValue.arrayUnion(note),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await getDb().collection("prior-auth-events").add({
    priorAuthId: paId,
    type: "note_added",
    actor: note.authorId,
    actorName: note.authorName,
    data: { noteId: note.id, textPreview: text.slice(0, 80) },
    timestamp: FieldValue.serverTimestamp(),
  });
  return json({ ok: true, note });
}

export async function listPayers(): Promise<Response> {
  const snap = await getDb().collection("payers").limit(200).get();
  return json({
    payers: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    count: snap.size,
  });
}

export async function getPayerPolicy(policyId: string): Promise<Response> {
  const snap = await getDb().collection("payer-policies").doc(policyId).get();
  if (!snap.exists) return json({ error: "Policy not found" }, 404);
  return json({
    id: snap.id,
    ...snap.data(),
    fetchedAt: tsToISO((snap.data() as any)?.fetchedAt),
    reviewedAt: tsToISO((snap.data() as any)?.reviewedAt),
  });
}

export async function listTargetCpts(): Promise<Response> {
  const snap = await getDb().collection("target-cpts").limit(200).get();
  return json({
    targetCpts: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    count: snap.size,
  });
}
