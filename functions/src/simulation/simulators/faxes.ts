/**
 * Fax simulator — reads/writes Firestore `simulation/faxes/*`. Shape matches
 * the real inbound/outbound fax pipelines so admin UI + Aurelia can operate
 * against the sandbox identically.
 *
 * Real counterpart: signalwireFaxWebhook (inbound) + sendFax (outbound) +
 * `integrations/signalwire.faxNumber` (our number).
 */
import * as admin from "firebase-admin";
import {SimContext} from "../index.js";

/** Reserved North-American "555-01xx" range, never routable. */
export const SIM_FAX_NUMBER = "+15559990000";

const INBOUND = "simulation/faxes/inbound";
const OUTBOUND = "simulation/faxes/outbound";

interface InboundFax {
  id: string;
  from: string;
  to: string;
  pages: number;
  status: "received" | "needs-review" | "processing" | "completed" | "failed";
  receivedAt: string;
  pdfUrl: string | null;
}

interface OutboundFax {
  id: string;
  from: string;
  to: string;
  pages: number;
  status: "queued" | "sending" | "delivered" | "failed";
  sentAt: string | null;
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
 *  review flow end-to-end without SignalWire. Randomizes sender + page
 *  count unless the caller supplies them. */
export async function inject_inbound(
  ctx: SimContext,
  params: {from?: string; pages?: number} = {},
): Promise<{id: string}> {
  const id = `SIM-${Date.now()}`;
  const doc: InboundFax = {
    id,
    from: params.from || SAMPLE_SENDERS[Math.floor(Math.random() * SAMPLE_SENDERS.length)],
    to: SIM_FAX_NUMBER,
    pages: params.pages || 1 + Math.floor(Math.random() * 5),
    status: "needs-review",
    receivedAt: new Date().toISOString(),
    pdfUrl: null,
  };
  await ctx.db.doc(`${INBOUND}/${id}`).set(doc);
  return {id};
}

export async function send_fax(
  ctx: SimContext,
  params: {to?: string; pdfBase64?: string; filename?: string; coverNote?: string},
): Promise<{id: string; status: OutboundFax["status"]}> {
  if (!params.to) throw new Error("to required");
  const id = `SIM-OUT-${Date.now()}`;
  const doc: OutboundFax = {
    id,
    from: SIM_FAX_NUMBER,
    to: params.to,
    pages: 1,
    status: "queued",
    sentAt: new Date().toISOString(),
  };
  await ctx.db.doc(`${OUTBOUND}/${id}`).set(doc);
  // Simulate async delivery: flip to delivered after a short delay (fire-and-forget).
  setTimeout(() => {
    ctx.db
      .doc(`${OUTBOUND}/${id}`)
      .update({status: "delivered", sentAt: new Date().toISOString()})
      .catch(() => {/* tolerate transient errors */});
  }, 2000);
  return {id, status: "queued"};
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
  const inboundBatch = db.batch();
  const inboundSamples: InboundFax[] = [
    {
      id: "SIM-1001",
      from: "+14155552010",
      to: SIM_FAX_NUMBER,
      pages: 3,
      status: "needs-review",
      receivedAt: new Date(now - 2 * 3600_000).toISOString(),
      pdfUrl: null,
    },
    {
      id: "SIM-1002",
      from: "+12125550142",
      to: SIM_FAX_NUMBER,
      pages: 2,
      status: "completed",
      receivedAt: new Date(now - 24 * 3600_000).toISOString(),
      pdfUrl: null,
    },
    {
      id: "SIM-1003",
      from: "+13105551177",
      to: SIM_FAX_NUMBER,
      pages: 5,
      status: "processing",
      receivedAt: new Date(now - 6 * 3600_000).toISOString(),
      pdfUrl: null,
    },
  ];
  inboundSamples.forEach((f) => inboundBatch.set(db.doc(`${INBOUND}/${f.id}`), f));
  await inboundBatch.commit();

  const outboundBatch = db.batch();
  const outboundSamples: OutboundFax[] = [
    {
      id: "SIM-OUT-1",
      from: SIM_FAX_NUMBER,
      to: "+14155552020",
      pages: 2,
      status: "delivered",
      sentAt: new Date(now - 3 * 3600_000).toISOString(),
    },
    {
      id: "SIM-OUT-2",
      from: SIM_FAX_NUMBER,
      to: "+12125550250",
      pages: 1,
      status: "delivered",
      sentAt: new Date(now - 48 * 3600_000).toISOString(),
    },
  ];
  outboundSamples.forEach((f) => outboundBatch.set(db.doc(`${OUTBOUND}/${f.id}`), f));
  await outboundBatch.commit();

  return {inbound: inboundSamples.length, outbound: outboundSamples.length};
}
