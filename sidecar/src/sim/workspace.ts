/**
 * Google Workspace simulator — sandbox email + calendar event lists /
 * creates. Reads/writes `simulation/workspace/*`.
 */
import { getDb } from "../lib/firebase.js";
import { Timestamp } from "firebase-admin/firestore";

const EMAILS = "simulation/workspace/emails";
const EVENTS = "simulation/workspace/events";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function simWorkspace(
  method: string,
  path: string,
  _searchParams: URLSearchParams,
  request?: Request,
): Promise<Response> {
  const db = getDb();

  // GET gmail/messages — list sent emails (newest first).
  if (method === "GET" && path === "gmail/messages") {
    const snap = await db.collection(EMAILS).orderBy("sentAt", "desc").limit(50).get();
    return json({ messages: snap.docs.map((d) => d.data()) });
  }

  // POST gmail/send — {to, subject, body}
  if (method === "POST" && path === "gmail/send") {
    const body = await request?.clone().json().catch(() => null);
    if (!body?.to || !body?.subject) return json({ error: "to + subject required" }, 400);
    const messageId = `SIM-MAIL-${Date.now()}`;
    const doc = {
      messageId,
      threadId: messageId,
      to: body.to,
      from: body.from || "admin@sim.aurelia.md",
      subject: body.subject,
      body: body.body || "",
      kind: "agent",
      sentAt: Timestamp.now(),
    };
    await db.doc(`${EMAILS}/${messageId}`).set(doc);
    return json({ messageId, threadId: messageId, ok: true });
  }

  // GET calendar/events
  if (method === "GET" && path === "calendar/events") {
    const snap = await db.collection(EVENTS).orderBy("start", "desc").limit(50).get();
    return json({ events: snap.docs.map((d) => d.data()) });
  }

  // POST calendar/events — {summary, start, end, attendees?}
  if (method === "POST" && path === "calendar/events") {
    const body = await request?.clone().json().catch(() => null);
    if (!body?.summary || !body?.start || !body?.end) {
      return json({ error: "summary + start + end required" }, 400);
    }
    const id = `SIM-EVT-${Date.now()}`;
    const doc = {
      id,
      summary: body.summary,
      start: Timestamp.fromDate(new Date(body.start)),
      end: Timestamp.fromDate(new Date(body.end)),
      attendees: body.attendees || [],
    };
    await db.doc(`${EVENTS}/${id}`).set(doc);
    return json({ id, ok: true });
  }

  return json(
    { error: `Simulated Workspace does not implement: ${method} ${path}` },
    501,
  );
}
