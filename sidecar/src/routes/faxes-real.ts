/**
 * Real-mode fax routes on the sidecar. Mirror the sim-mode shape 1:1 so
 * Aurelia and the UI can hit `/admin-api/faxes/*` without caring about
 * routing. Reads + PATCH are fully implemented here; sends still live
 * in the `sendOutboundFax` Cloud Function today.
 */
import { getDb } from "../lib/firebase.js";

const INBOUND = "inbound-faxes";
const OUTBOUND = "outbound-faxes";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function realFaxGetOurNumber(): Promise<Response> {
  const snap = await getDb().doc("integrations/signalwire").get();
  const data = snap.data() as { faxNumber?: string } | undefined;
  return json({ number: data?.faxNumber || null });
}

export async function realFaxListInbound(): Promise<Response> {
  const snap = await getDb()
    .collection(INBOUND)
    .orderBy("receivedAt", "desc")
    .limit(200)
    .get();
  return json({
    results: snap.docs.map((d) => ({ faxSid: d.id, ...d.data() })),
  });
}

export async function realFaxListOutbound(): Promise<Response> {
  const snap = await getDb()
    .collection(OUTBOUND)
    .orderBy("submittedAt", "desc")
    .limit(200)
    .get();
  return json({
    results: snap.docs.map((d) => ({ faxSid: d.id, ...d.data() })),
  });
}

export async function realFaxGet(faxSid: string): Promise<Response> {
  const snap = await getDb().doc(`${INBOUND}/${faxSid}`).get();
  if (!snap.exists) return json({ error: "Fax not found" }, 404);
  return json({ faxSid, ...snap.data() });
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

export async function realFaxPatch(faxSid: string, request: Request): Promise<Response> {
  const ref = getDb().doc(`${INBOUND}/${faxSid}`);
  const snap = await ref.get();
  if (!snap.exists) return json({ error: "Fax not found" }, 404);
  const body = (await request.clone().json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid body" }, 400);
  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED_INBOUND_PATCH_FIELDS) {
    if (key in body) updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return json({ error: "No allowed fields in body" }, 400);
  }
  await ref.update(updates);
  return json({ faxSid, ...snap.data(), ...updates });
}
