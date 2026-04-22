/**
 * SMS simulator + seed helpers. Twilio calls from Cloud Functions
 * short-circuit here when `system/settings.simulationMode` is on —
 * nothing goes over the wire, the fake message lands in
 * `simulation/sms/outbound/*` and surfaces in the admin SMS history.
 */
import * as admin from "firebase-admin";

export const SIM_SMS_NUMBER = "+15559990001";

const OUTBOUND = "simulation/sms/outbound";
const INBOUND = "simulation/sms/inbound";

/**
 * Fire-and-forget write of an outbound SMS into the sandbox. Safe to
 * call from any Cloud Function; swallows errors so real flows aren't
 * disrupted if the write fails.
 */
export async function recordSimSms(args: {
  to: string;
  body: string;
  kind: "welcome" | "reminder" | "admin" | "verification";
}): Promise<void> {
  try {
    const sid = `SIM-SMS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await admin.firestore().doc(`${OUTBOUND}/${sid}`).set({
      sid,
      from: SIM_SMS_NUMBER,
      to: args.to,
      body: args.body,
      kind: args.kind,
      status: "delivered",
      sentAt: admin.firestore.Timestamp.now(),
    });
  } catch {
    /* tolerate — simulator must never break the real flow */
  }
}

/** Idempotent SMS seed — samples cover reminders + admin replies. */
export async function seedSms(
  db: admin.firestore.Firestore,
): Promise<{ outbound: number; inbound: number }> {
  const wipe = async (path: string) => {
    const snap = await db.collection(path).limit(500).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  };
  await wipe(OUTBOUND);
  await wipe(INBOUND);

  const ts = (hAgo: number) =>
    admin.firestore.Timestamp.fromMillis(Date.now() - hAgo * 3600_000);

  const outboundSamples = [
    {
      sid: "SIM-SMS-SEED-1",
      kind: "reminder" as const,
      to: "+14155552010",
      body: "This is an automated reminder from Aurelia MD of your appointment on: Follow-up visit.\nScheduled for tomorrow at 10:00 AM. Don't forget!",
      sentAt: ts(23),
    },
    {
      sid: "SIM-SMS-SEED-2",
      kind: "welcome" as const,
      to: "+12125550142",
      body: "Welcome to Aurelia MD, Patient! Check your email for a sign-in link to access your account.",
      sentAt: ts(48),
    },
    {
      sid: "SIM-SMS-SEED-3",
      kind: "admin" as const,
      to: "+13105551177",
      body: "Your lab results are ready. Please log in to the portal to review them.",
      sentAt: ts(6),
    },
  ];

  const batch = db.batch();
  outboundSamples.forEach((s) =>
    batch.set(db.doc(`${OUTBOUND}/${s.sid}`), {
      sid: s.sid,
      from: SIM_SMS_NUMBER,
      to: s.to,
      body: s.body,
      kind: s.kind,
      status: "delivered",
      sentAt: s.sentAt,
    }),
  );
  await batch.commit();

  const inboundSamples = [
    {
      sid: "SIM-SMS-SEED-IN-1",
      from: "+14155552010",
      body: "Hi, can I move my appointment to Thursday?",
      receivedAt: ts(4),
    },
    {
      sid: "SIM-SMS-SEED-IN-2",
      from: "+13105551177",
      body: "Got the results, thank you!",
      receivedAt: ts(2),
    },
  ];
  const batch2 = db.batch();
  inboundSamples.forEach((s) =>
    batch2.set(db.doc(`${INBOUND}/${s.sid}`), {
      sid: s.sid,
      from: s.from,
      to: SIM_SMS_NUMBER,
      body: s.body,
      status: "received",
      receivedAt: s.receivedAt,
    }),
  );
  await batch2.commit();

  return { outbound: outboundSamples.length, inbound: inboundSamples.length };
}
