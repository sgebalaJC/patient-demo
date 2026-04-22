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
