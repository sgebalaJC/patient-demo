/**
 * Fax simulator — reads/writes Firestore `simulation/faxes/*`. Seed data
 * mirrors the real inbound-faxes/outbound-faxes shape exactly, so the UI
 * can simply subscribe to the sim collection path in sim mode.
 *
 * Real counterpart: signalwireFaxWebhook (inbound) + sendFax (outbound) +
 * `integrations/signalwire.faxNumber` (our number).
 */
import * as admin from "firebase-admin";
import {SimContext} from "../index.js";

/** Reserved North-American "555" range, never routable. */
export const SIM_FAX_NUMBER = "+15559990000";

const INBOUND = "simulation/faxes/inbound";
const OUTBOUND = "simulation/faxes/outbound";

type FaxStatus = "pending" | "processing" | "needs_review" | "completed" | "failed";

interface InboundFax {
  faxSid: string;
  receivedAt: admin.firestore.Timestamp;
  from: string;
  to: string;
  pageCount: number;
  pdfPath: string | null;
  status: FaxStatus;
  attempts: number;
}

interface OutboundFax {
  faxSid: string;
  from: string;
  to: string;
  pageCount: number;
  status: "queued" | "sending" | "delivered" | "failed";
  sentAt: admin.firestore.Timestamp;
}

export async function get_our_number(): Promise<{number: string}> {
  return {number: SIM_FAX_NUMBER};
}

export async function list_inbound(ctx: SimContext): Promise<{results: InboundFax[]}> {
  const snap = await ctx.db.collection(INBOUND).orderBy("receivedAt", "desc").limit(200).get();
  return {results: snap.docs.map((d) => d.data() as InboundFax)};
}

export async function list_outbound(ctx: SimContext): Promise<{results: OutboundFax[]}> {
  const snap = await ctx.db.collection(OUTBOUND).orderBy("sentAt", "desc").limit(200).get();
  return {results: snap.docs.map((d) => d.data() as OutboundFax)};
}

const SAMPLE_SENDERS = [
  "+14155552010",
  "+12125550142",
  "+13105551177",
  "+16175550199",
];

/** Drops a new inbound fax into the sandbox so admins can exercise the
 *  review flow end-to-end without SignalWire. */
export async function inject_inbound(
  ctx: SimContext,
  params: {from?: string; pages?: number} = {},
): Promise<{id: string}> {
  const faxSid = `SIM-${Date.now()}`;
  const doc: InboundFax = {
    faxSid,
    from: params.from || SAMPLE_SENDERS[Math.floor(Math.random() * SAMPLE_SENDERS.length)],
    to: SIM_FAX_NUMBER,
    pageCount: params.pages || 1 + Math.floor(Math.random() * 5),
    status: "needs_review",
    receivedAt: admin.firestore.Timestamp.now(),
    pdfPath: null,
    attempts: 0,
  };
  await ctx.db.doc(`${INBOUND}/${faxSid}`).set(doc);
  return {id: faxSid};
}

export async function send_fax(
  ctx: SimContext,
  params: {to?: string; pdfBase64?: string; filename?: string; coverNote?: string},
): Promise<{id: string; status: OutboundFax["status"]}> {
  if (!params.to) throw new Error("to required");
  const faxSid = `SIM-OUT-${Date.now()}`;
  const doc: OutboundFax = {
    faxSid,
    from: SIM_FAX_NUMBER,
    to: params.to,
    pageCount: 1,
    status: "queued",
    sentAt: admin.firestore.Timestamp.now(),
  };
  await ctx.db.doc(`${OUTBOUND}/${faxSid}`).set(doc);
  setTimeout(() => {
    ctx.db
      .doc(`${OUTBOUND}/${faxSid}`)
      .update({status: "delivered"})
      .catch(() => {/* tolerate transient errors */});
  }, 2000);
  return {id: faxSid, status: "queued"};
}

/** Idempotent seeder — called from `seedSimulationData`. */
export async function seedFaxes(db: admin.firestore.Firestore): Promise<{inbound: number; outbound: number}> {
  const wipe = async (path: string) => {
    const snap = await db.collection(path).limit(500).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  };
  await wipe(INBOUND);
  await wipe(OUTBOUND);

  const now = Date.now();
  const ts = (ms: number) => admin.firestore.Timestamp.fromMillis(ms);

  const inboundBatch = db.batch();
  const inboundSamples: InboundFax[] = [
    {
      faxSid: "SIM-1001",
      from: "+14155552010",
      to: SIM_FAX_NUMBER,
      pageCount: 3,
      status: "needs_review",
      receivedAt: ts(now - 2 * 3600_000),
      pdfPath: null,
      attempts: 1,
    },
    {
      faxSid: "SIM-1002",
      from: "+12125550142",
      to: SIM_FAX_NUMBER,
      pageCount: 2,
      status: "completed",
      receivedAt: ts(now - 24 * 3600_000),
      pdfPath: null,
      attempts: 1,
    },
    {
      faxSid: "SIM-1003",
      from: "+13105551177",
      to: SIM_FAX_NUMBER,
      pageCount: 5,
      status: "processing",
      receivedAt: ts(now - 6 * 3600_000),
      pdfPath: null,
      attempts: 1,
    },
  ];
  inboundSamples.forEach((f) => inboundBatch.set(db.doc(`${INBOUND}/${f.faxSid}`), f));
  await inboundBatch.commit();

  const outboundBatch = db.batch();
  const outboundSamples: OutboundFax[] = [
    {
      faxSid: "SIM-OUT-1",
      from: SIM_FAX_NUMBER,
      to: "+14155552020",
      pageCount: 2,
      status: "delivered",
      sentAt: ts(now - 3 * 3600_000),
    },
    {
      faxSid: "SIM-OUT-2",
      from: SIM_FAX_NUMBER,
      to: "+12125550250",
      pageCount: 1,
      status: "delivered",
      sentAt: ts(now - 48 * 3600_000),
    },
  ];
  outboundSamples.forEach((f) => outboundBatch.set(db.doc(`${OUTBOUND}/${f.faxSid}`), f));
  await outboundBatch.commit();

  return {inbound: inboundSamples.length, outbound: outboundSamples.length};
}
