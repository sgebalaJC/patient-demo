/**
 * Sidecar-side fax simulator. Reads/writes `simulation/faxes/*` in the
 * shared sandbox so Aurelia and the admin UI see identical inbox/outbox
 * state.
 */
import { getDb } from "../lib/firebase.js";
import { Timestamp } from "firebase-admin/firestore";

/** Reserved US "555" range, never routable. */
export const SIM_FAX_NUMBER = "+15559990000";

const INBOUND = "simulation/faxes/inbound";
const OUTBOUND = "simulation/faxes/outbound";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function simFaxGetOurNumber(): Promise<Response> {
  return json({ number: SIM_FAX_NUMBER });
}

export async function simFaxListInbound(): Promise<Response> {
  const snap = await getDb().collection(INBOUND).orderBy("receivedAt", "desc").limit(200).get();
  return json({ results: snap.docs.map((d) => d.data()) });
}

export async function simFaxListOutbound(): Promise<Response> {
  const snap = await getDb().collection(OUTBOUND).orderBy("submittedAt", "desc").limit(200).get();
  return json({ results: snap.docs.map((d) => d.data()) });
}

/** GET a single inbound fax row by sid. */
export async function simFaxGet(faxSid: string): Promise<Response> {
  const snap = await getDb().doc(`${INBOUND}/${faxSid}`).get();
  if (!snap.exists) return json({ error: "Fax not found" }, 404);
  return json(snap.data());
}

const ALLOWED_INBOUND_PATCH_FIELDS = [
  "status",
  "extracted",
  "matchedPatient",
  "drchronoDocumentId",
  "aurelia",
  "emailDraft",
  "notes",
];

/** PATCH an inbound fax row. Mirrors the real fax-actions endpoints. */
export async function simFaxPatch(faxSid: string, request: Request): Promise<Response> {
  const ref = getDb().doc(`${INBOUND}/${faxSid}`);
  const snap = await ref.get();
  if (!snap.exists) return json({ error: "Fax not found" }, 404);
  const body = (await request.clone().json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid body" }, 400);
  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED_INBOUND_PATCH_FIELDS) {
    if (key in body) updates[key] = body[key];
  }
  await ref.update(updates);
  return json({ ...snap.data(), ...updates });
}

/** Attach an inbound fax to a DrChrono chart (sim: just mark it). */
export async function simFaxToDrChrono(request: Request): Promise<Response> {
  const body = (await request.clone().json().catch(() => null)) as {
    faxSid?: string;
    patient?: number;
    description?: string;
    metatags?: string[];
  } | null;
  if (!body?.faxSid || !body?.patient) {
    return json({ error: "faxSid + patient required" }, 400);
  }
  const ref = getDb().doc(`${INBOUND}/${body.faxSid}`);
  const snap = await ref.get();
  if (!snap.exists) return json({ error: "Fax not found" }, 404);
  // Deterministic fake DrChrono document id derived from the faxSid.
  const drchronoDocumentId = 800000 + Math.abs(hash(body.faxSid)) % 100000;
  await ref.update({
    drchronoDocumentId,
    matchedPatient: {
      drchronoId: body.patient,
      confidence: "exact",
    },
  });
  return json({ ok: true, drchronoDocumentId, patient: body.patient });
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

const SAMPLE_SENDERS = [
  "+14155552010",
  "+12125550142",
  "+13105551177",
  "+16175550199",
];

export async function simFaxInjectInbound(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { from?: string; pages?: number };
  const faxSid = `SIM-${Date.now()}`;
  const doc = {
    faxSid,
    from: body.from || SAMPLE_SENDERS[Math.floor(Math.random() * SAMPLE_SENDERS.length)],
    to: SIM_FAX_NUMBER,
    pageCount: body.pages || 1 + Math.floor(Math.random() * 5),
    status: "needs_review",
    receivedAt: Timestamp.now(),
    pdfPath: null,
    attempts: 0,
  };
  await getDb().doc(`${INBOUND}/${faxSid}`).set(doc);
  return json({ faxSid, status: "needs_review" });
}

export async function simFaxSend(request: Request, callerUid: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    to?: string;
    subject?: string;
    fileCount?: number;
  };
  if (!body.to) return json({ error: "to required" }, 400);
  const faxSid = `SIM-OUT-${Date.now()}`;
  const doc = {
    faxSid,
    from: SIM_FAX_NUMBER,
    to: body.to,
    subject: body.subject || null,
    pageCount: null as number | null,
    fileCount: body.fileCount || 1,
    status: "queued" as const,
    submittedBy: callerUid,
    submittedAt: Timestamp.now(),
    completedAt: null as Timestamp | null,
  };
  await getDb().doc(`${OUTBOUND}/${faxSid}`).set(doc);
  // Simulate async delivery.
  setTimeout(() => {
    getDb()
      .doc(`${OUTBOUND}/${faxSid}`)
      .update({
        status: "delivered",
        pageCount: 2,
        completedAt: Timestamp.now(),
      })
      .catch(() => { /* tolerate */ });
  }, 2000);
  return json({ faxSid, status: "queued", ok: true });
}
