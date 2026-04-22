/**
 * Sidecar-side SMS simulator. Reads/writes `simulation/sms/*`.
 *
 * Real counterpart: Twilio REST API (client.messages.create). In real
 * mode the admin-api messaging case is 501 for now — Twilio calls
 * still go directly from the Cloud Functions.
 */
import { getDb } from "../lib/firebase.js";
import { Timestamp } from "firebase-admin/firestore";

const OUTBOUND = "simulation/sms/outbound";
const INBOUND = "simulation/sms/inbound";

/** Reserved US "555" range fake. */
export const SIM_SMS_NUMBER = "+15559990001";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function simSmsListOutbound(): Promise<Response> {
  const snap = await getDb().collection(OUTBOUND).orderBy("sentAt", "desc").limit(200).get();
  return json({ results: snap.docs.map((d) => d.data()) });
}

export async function simSmsListInbound(): Promise<Response> {
  const snap = await getDb().collection(INBOUND).orderBy("receivedAt", "desc").limit(200).get();
  return json({ results: snap.docs.map((d) => d.data()) });
}

export async function simSmsSend(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    to?: string;
    body?: string;
    kind?: string;
  };
  if (!body.to) return json({ error: "to required" }, 400);
  if (!body.body) return json({ error: "body required" }, 400);
  const sid = `SIM-SMS-${Date.now()}`;
  const doc = {
    sid,
    from: SIM_SMS_NUMBER,
    to: body.to,
    body: body.body,
    kind: body.kind || "admin",
    status: "delivered" as const,
    sentAt: Timestamp.now(),
  };
  await getDb().doc(`${OUTBOUND}/${sid}`).set(doc);
  return json({ sid, status: "delivered", ok: true });
}

const SAMPLE_INBOUND_FROM = [
  "+14155552010",
  "+12125550142",
  "+13105551177",
];

export async function simSmsInjectInbound(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    from?: string;
    body?: string;
  };
  const sid = `SIM-SMS-IN-${Date.now()}`;
  const doc = {
    sid,
    from: body.from || SAMPLE_INBOUND_FROM[Math.floor(Math.random() * SAMPLE_INBOUND_FROM.length)],
    to: SIM_SMS_NUMBER,
    body: body.body || "Hi, just confirming my appointment tomorrow. Thanks!",
    status: "received" as const,
    receivedAt: Timestamp.now(),
  };
  await getDb().doc(`${INBOUND}/${sid}`).set(doc);
  return json({ sid, status: "received" });
}
