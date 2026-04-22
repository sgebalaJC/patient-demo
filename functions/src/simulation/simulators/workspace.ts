/**
 * Workspace simulator — captures outbound Gmail sends + stub calendar
 * events against `simulation/workspace/*`. Used to short-circuit real
 * Gmail/Calendar writes in sim mode.
 */
import * as admin from "firebase-admin";

const EMAILS = "simulation/workspace/emails";
const EVENTS = "simulation/workspace/events";

/** Fire-and-forget capture of an outbound email. */
export async function recordSimEmail(args: {
  to: string;
  from?: string;
  subject: string;
  body: string;
  kind?: string;
}): Promise<{messageId: string; threadId: string}> {
  const messageId = `SIM-MAIL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const threadId = messageId;
  try {
    await admin.firestore().doc(`${EMAILS}/${messageId}`).set({
      messageId,
      threadId,
      to: args.to,
      from: args.from || "admin@sim.aurelia.md",
      subject: args.subject,
      body: args.body,
      kind: args.kind || "admin",
      sentAt: admin.firestore.Timestamp.now(),
    });
  } catch {
    /* tolerate */
  }
  return {messageId, threadId};
}

/** Idempotent seed — a few sample emails + calendar events so the
 *  sandbox is visibly populated. */
export async function seedWorkspace(
  db: admin.firestore.Firestore,
): Promise<{emails: number; events: number}> {
  const wipe = async (path: string) => {
    const snap = await db.collection(path).limit(500).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  };
  await wipe(EMAILS);
  await wipe(EVENTS);

  const ts = (hAgo: number) =>
    admin.firestore.Timestamp.fromMillis(Date.now() - hAgo * 3600_000);

  const emailBatch = db.batch();
  [
    {
      messageId: "SIM-MAIL-SEED-1",
      to: "patient.a@example.com",
      subject: "Your fax results are ready",
      body: "Hi — your imaging report has been reviewed. Please log in to the portal to view it.",
      kind: "fax-review",
      sentAt: ts(4),
    },
    {
      messageId: "SIM-MAIL-SEED-2",
      to: "patient.b@example.com",
      subject: "Appointment confirmed — Tuesday 10:00 AM",
      body: "This is a confirmation of your upcoming appointment.",
      kind: "appointment",
      sentAt: ts(26),
    },
  ].forEach((m) =>
    emailBatch.set(db.doc(`${EMAILS}/${m.messageId}`), {
      ...m,
      threadId: m.messageId,
      from: "admin@sim.aurelia.md",
    }),
  );
  await emailBatch.commit();

  const eventBatch = db.batch();
  [
    {
      id: "SIM-EVT-SEED-1",
      summary: "Follow-up — Patient A",
      start: ts(-24),
      end: ts(-23.5),
      attendees: ["patient.a@example.com"],
    },
    {
      id: "SIM-EVT-SEED-2",
      summary: "Annual physical — Patient C",
      start: ts(-72),
      end: ts(-71.5),
      attendees: ["patient.c@example.com"],
    },
  ].forEach((e) => eventBatch.set(db.doc(`${EVENTS}/${e.id}`), e));
  await eventBatch.commit();

  return {emails: 2, events: 2};
}
