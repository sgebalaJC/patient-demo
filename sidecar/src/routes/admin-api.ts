/**
 * Admin Agent API — Firestore CRUD for the AI admin assistant.
 *
 * All endpoints require sidecar auth (Bearer API key) + admin role.
 * Accessed via: GET/POST/PATCH/DELETE /admin-api/<resource>[/<id>][/<action>]
 *
 * SAFETY GUARDRAILS (demo instance):
 * - Patient deletion is FORBIDDEN — no endpoint exists
 * - Deactivating patients requires X-Operator-Authorized: true header
 * - Cancelling appointments requires X-Operator-Authorized: true header
 * - All other write ops are allowed but auditable
 *
 * No PII is logged. UIDs and roles only.
 */

import { getDb } from "../lib/firebase.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { proxyDrChrono, assertDrChronoReady } from "../lib/drchrono.js";
import { proxyAthena, assertAthenaReady } from "../lib/athena.js";
import { proxyElation, assertElationReady } from "../lib/elation.js";
import { proxyEcw, assertEcwReady } from "../lib/ecw.js";
import { proxyNextGen, assertNextGenReady } from "../lib/nextgen.js";
import { proxyTebra, assertTebraReady } from "../lib/tebra.js";
import { proxyGreenway, assertGreenwayReady } from "../lib/greenway.js";
import { proxyPfusion, assertPfusionReady } from "../lib/pfusion.js";
import { proxyCerner, assertCernerReady } from "../lib/cerner.js";
import { proxyEpic, assertEpicReady } from "../lib/epic.js";
import { isSimulationOn } from "../sim/index.js";
import { simDrChrono } from "../sim/drchrono.js";
import { simAthena } from "../sim/athena.js";
import { simElation } from "../sim/elation.js";
import { simEcw } from "../sim/ecw.js";
import { simNextGen } from "../sim/nextgen.js";
import { simTebra } from "../sim/tebra.js";
import { simGreenway } from "../sim/greenway.js";
import { simPfusion } from "../sim/pfusion.js";
import { simCerner } from "../sim/cerner.js";
import { simEpic } from "../sim/epic.js";
import { simWorkspace } from "../sim/workspace.js";
import {
  simFaxGetOurNumber,
  simFaxListInbound,
  simFaxListOutbound,
  simFaxInjectInbound,
  simFaxSend,
  simFaxGet,
  simFaxPatch,
  simFaxToDrChrono,
} from "../sim/faxes.js";
import {
  realFaxGetOurNumber,
  realFaxListInbound,
  realFaxListOutbound,
  realFaxGet,
  realFaxPatch,
  realFaxSend,
} from "./faxes-real.js";
import {
  simSmsListInbound,
  simSmsListOutbound,
  simSmsSend,
  simSmsInjectInbound,
} from "../sim/messaging.js";
import { realSmsSend } from "../real/messaging.js";
import {
  listPriorAuths,
  getPriorAuth,
  listPriorAuthEvents,
  appendPriorAuthNote,
  listPayers,
  getPayerPolicy,
  listTargetCpts,
} from "./prior-auth.js";
import { runChartGapCheck } from "./chart-gap-check.js";

type Db = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function error(msg: string, status = 400): Response {
  return Response.json({ error: msg }, { status });
}

function parseLimit(url: URL, fallback = 20, max = 50): number {
  const raw = parseInt(url.searchParams.get("limit") || String(fallback));
  return isNaN(raw) ? fallback : Math.min(Math.max(raw, 1), max);
}

function tsToISO(ts: any): string | null {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  return String(ts);
}

/** Check if the request carries explicit operator authorization. */
function isOperatorAuthorized(request: Request): boolean {
  return request.headers.get("x-operator-authorized") === "true";
}

// ---------------------------------------------------------------------------
// EHR pass-through registry
// ---------------------------------------------------------------------------

type EhrSim = (method: string, path: string, searchParams: URLSearchParams, request?: Request) => Promise<Response>;
type EhrProxy = (method: string, path: string, searchParams: URLSearchParams, request: Request) => Promise<Response>;

interface EhrHandlers {
  sim: EhrSim;
  assertReady: () => Promise<void>;
  proxy: EhrProxy;
  displayName: string;
  sampleResource: string;
}

const EHR_REGISTRY: Record<string, EhrHandlers> = {
  drchrono: { sim: simDrChrono, assertReady: assertDrChronoReady, proxy: proxyDrChrono, displayName: "DrChrono",        sampleResource: "patients" },
  athena:   { sim: simAthena,   assertReady: assertAthenaReady,   proxy: proxyAthena,   displayName: "Athena",          sampleResource: "patients" },
  elation:  { sim: simElation,  assertReady: assertElationReady,  proxy: proxyElation,  displayName: "Elation",         sampleResource: "patients" },
  ecw:      { sim: simEcw,      assertReady: assertEcwReady,      proxy: proxyEcw,      displayName: "eCW",             sampleResource: "Patient"  },
  nextgen:  { sim: simNextGen,  assertReady: assertNextGenReady,  proxy: proxyNextGen,  displayName: "NextGen",         sampleResource: "patients" },
  tebra:    { sim: simTebra,    assertReady: assertTebraReady,    proxy: proxyTebra,    displayName: "Tebra",           sampleResource: "patients" },
  greenway: { sim: simGreenway, assertReady: assertGreenwayReady, proxy: proxyGreenway, displayName: "Greenway",        sampleResource: "patients" },
  pfusion:  { sim: simPfusion,  assertReady: assertPfusionReady,  proxy: proxyPfusion,  displayName: "Practice Fusion", sampleResource: "patients" },
  cerner:   { sim: simCerner,   assertReady: assertCernerReady,   proxy: proxyCerner,   displayName: "Cerner",          sampleResource: "Patient"  },
  epic:     { sim: simEpic,     assertReady: assertEpicReady,     proxy: proxyEpic,     displayName: "Epic",            sampleResource: "Patient"  },
};

/**
 * Dispatch an EHR pass-through call. Sim mode → seeded sandbox (no EHR token
 * required); real mode → OAuth-backed proxy after enabled/authorized checks.
 * One place to add metrics, request-id propagation, or rate-limit handling.
 */
async function ehrRoute(
  resource: string,
  method: string,
  parts: string[],
  url: URL,
  request: Request,
  handlers: EhrHandlers,
): Promise<Response> {
  const ehrPath = parts.slice(1).join("/");
  if (!ehrPath) {
    return error(`${handlers.displayName} path required (e.g. /admin-api/${resource}/${handlers.sampleResource})`, 400);
  }
  if (await isSimulationOn()) {
    return await handlers.sim(method, ehrPath, url.searchParams, request);
  }
  try {
    await handlers.assertReady();
  } catch (err: any) {
    return error(err.message, 403);
  }
  return await handlers.proxy(method, ehrPath, url.searchParams, request);
}

/**
 * Sim-aware collection ref for native Firestore collections (users,
 * appointments, refills, etc). When `system/settings.simulationMode` is on,
 * routes to `simulation/native/<name>` so Aurelia sees the seeded sandbox
 * without any change to her skills. When off, returns the real collection.
 */
async function nc(db: Db, name: string): Promise<FirebaseFirestore.CollectionReference> {
  const sim = await isSimulationOn();
  return sim ? db.collection(`simulation/native/${name}`) : db.collection(name);
}

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

async function listPatients(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const search = url.searchParams.get("search")?.trim();
  const statusFilter = url.searchParams.get("status");

  // Forgiving search: case-insensitive, accepts "Last", "First Last", or "First".
  // Strategy: scan a wider window and filter in memory. The patient set per
  // practice is small enough (hundreds, not millions) that a 500-row scan is
  // cheaper than maintaining a search index.
  if (search) {
    let q: FirebaseFirestore.Query = (await nc(db, "users"))
      .where("role", "==", "patient")
      .orderBy("lastName")
      .limit(500);
    if (statusFilter === "active") q = q.where("isActive", "==", true);
    else if (statusFilter === "inactive") q = q.where("isActive", "==", false);

    const snap = await q.get();
    const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = snap.docs.filter(doc => {
      const d = doc.data();
      const first = (d.firstName ?? "").toLowerCase();
      const last = (d.lastName ?? "").toLowerCase();
      const full = `${first} ${last}`;
      return tokens.every(t => first.includes(t) || last.includes(t) || full.includes(t));
    }).slice(0, limit);

    const patients = matches.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        phoneNumber: d.phoneNumber ?? null,
        dateOfBirth: d.dateOfBirth ?? null,
        isActive: d.isActive !== false,
        createdAt: tsToISO(d.createdAt),
      };
    });
    return json({ patients, count: patients.length });
  }

  let query: FirebaseFirestore.Query = (await nc(db, "users"))
    .where("role", "==", "patient")
    .orderBy("lastName")
    .limit(limit);

  if (statusFilter === "active") {
    query = query.where("isActive", "==", true);
  } else if (statusFilter === "inactive") {
    query = query.where("isActive", "==", false);
  }

  const after = url.searchParams.get("after");
  if (after) {
    const cursor = await (await nc(db, "users")).doc(after).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }

  const snap = await query.get();
  const patients = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email,
      phoneNumber: d.phoneNumber ?? null,
      dateOfBirth: d.dateOfBirth ?? null,
      isActive: d.isActive !== false,
      createdAt: tsToISO(d.createdAt),
    };
  });

  return json({ patients, count: patients.length });
}

async function getPatient(db: Db, id: string): Promise<Response> {
  const doc = await (await nc(db, "users")).doc(id).get();
  if (!doc.exists) return error("Patient not found", 404);

  const d = doc.data()!;
  if (d.role !== "patient") return error("Not a patient", 404);

  return json({
    id: doc.id,
    firstName: d.firstName,
    lastName: d.lastName,
    email: d.email,
    phoneNumber: d.phoneNumber ?? null,
    phoneVerified: d.phoneVerified ?? false,
    dateOfBirth: d.dateOfBirth ?? null,
    gender: d.gender ?? null,
    bloodType: d.bloodType ?? null,
    allergies: d.allergies ?? [],
    medicalHistory: d.medicalHistory ?? [],
    emergencyContact: d.emergencyContact ?? null,
    insuranceInfo: d.insuranceInfo ?? null,
    isActive: d.isActive !== false,
    createdAt: tsToISO(d.createdAt),
  });
}

async function updatePatient(db: Db, id: string, req: Request): Promise<Response> {
  const doc = await (await nc(db, "users")).doc(id).get();
  if (!doc.exists || doc.data()!.role !== "patient") return error("Patient not found", 404);

  const body = await req.json() as Record<string, any>;

  // SAFETY: deactivating a patient requires operator authorization
  if ("isActive" in body && body.isActive === false) {
    if (!isOperatorAuthorized(req)) {
      return error("Deactivating a patient requires operator authorization. Include X-Operator-Authorized: true header after confirming with the admin.", 403);
    }
  }

  const allowed = ["firstName", "lastName", "phoneNumber", "dateOfBirth", "gender",
    "bloodType", "allergies", "medicalHistory", "emergencyContact", "insuranceInfo", "isActive"];
  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  await (await nc(db, "users")).doc(id).update(updates);
  return json({ success: true, patientId: id });
}

async function patientStats(db: Db): Promise<Response> {
  const allSnap = await (await nc(db, "users")).where("role", "==", "patient").count().get();
  const activeSnap = await (await nc(db, "users")).where("role", "==", "patient").where("isActive", "==", true).count().get();
  const total = allSnap.data().count;
  const active = activeSnap.data().count;
  return json({ total, active, inactive: total - active });
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

async function listAppointments(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const status = url.searchParams.get("status");

  let query = (await nc(db, "appointments"))
    .orderBy("appointmentDate", "desc")
    .limit(limit);

  if (status) {
    query = (await nc(db, "appointments"))
      .where("status", "==", status)
      .orderBy("appointmentDate", "desc")
      .limit(limit);
  }

  const after = url.searchParams.get("after");
  if (after) {
    const cursor = await (await nc(db, "appointments")).doc(after).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }

  const snap = await query.get();
  const appointments = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      patientId: d.patientId,
      appointmentDate: tsToISO(d.appointmentDate),
      duration: d.duration ?? null,
      appointmentType: d.appointmentType ?? null,
      reason: d.reason ?? null,
      notes: d.notes ?? null,
      status: d.status,
      location: d.location ?? null,
      calendarEventId: d.calendarEventId ?? null,
      createdAt: tsToISO(d.createdAt),
    };
  });

  return json({ appointments, count: appointments.length });
}

async function createAppointment(db: Db, req: Request): Promise<Response> {
  // SAFETY: creating an appointment writes to a real shared calendar (via the
  // Cloud Function calendar sync trigger) and can notify the patient. Require
  // explicit operator confirmation, just like cancel.
  if (!isOperatorAuthorized(req)) {
    return error("Creating an appointment requires operator authorization. Include X-Operator-Authorized: true header after confirming with the admin.", 403);
  }

  const body = await req.json() as Record<string, any>;
  if (!body.patientId) return error("patientId is required");
  if (!body.appointmentDate) return error("appointmentDate is required (ISO-8601 UTC timestamp)");

  const patientDoc = await (await nc(db, "users")).doc(body.patientId).get();
  if (!patientDoc.exists || patientDoc.data()!.role !== "patient") {
    return error("Patient not found", 404);
  }

  const apptDate = new Date(body.appointmentDate);
  if (isNaN(apptDate.getTime())) return error("appointmentDate must be a valid ISO-8601 timestamp");

  const duration = typeof body.duration === "number" ? Math.max(5, Math.min(body.duration, 240)) : 30;
  const validStatuses = ["scheduled", "confirmed"];
  const status = validStatuses.includes(body.status) ? body.status : "scheduled";

  const ref = await (await nc(db, "appointments")).add({
    patientId: body.patientId,
    appointmentDate: Timestamp.fromDate(apptDate),
    duration,
    appointmentType: body.appointmentType ? String(body.appointmentType).slice(0, 100) : null,
    reason: body.reason ? String(body.reason).slice(0, 500) : null,
    notes: body.notes ? String(body.notes).slice(0, 2000) : null,
    location: body.location ? String(body.location).slice(0, 200) : null,
    status,
    reminderSent: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return json({ success: true, appointmentId: ref.id, status }, 201);
}

async function appointmentSlots(db: Db, url: URL): Promise<Response> {
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return error("date query param required (YYYY-MM-DD)");
  }

  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59Z`);
  const snap = await (await nc(db, "appointments"))
    .where("appointmentDate", ">=", Timestamp.fromDate(dayStart))
    .where("appointmentDate", "<", Timestamp.fromDate(dayEnd))
    .get();

  const busy = snap.docs
    .filter(d => {
      const s = d.data().status;
      return s !== "cancelled" && s !== "no-show";
    })
    .map(d => {
      const data = d.data();
      const start = data.appointmentDate.toDate() as Date;
      const dur = (data.duration ?? 30) as number;
      return {
        appointmentId: d.id,
        patientId: data.patientId,
        start: start.toISOString(),
        end: new Date(start.getTime() + dur * 60_000).toISOString(),
        duration: dur,
        status: data.status,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  return json({ date, busy, count: busy.length });
}

async function upcomingAppointments(db: Db): Promise<Response> {
  const now = Timestamp.now();
  // Include both "scheduled" and "confirmed" — either status means the appointment is upcoming
  const snap = await (await nc(db, "appointments"))
    .where("appointmentDate", ">=", now)
    .where("status", "in", ["scheduled", "confirmed"])
    .orderBy("appointmentDate", "asc")
    .limit(10)
    .get();

  const appointments = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      patientId: d.patientId,
      appointmentDate: tsToISO(d.appointmentDate),
      duration: d.duration ?? null,
      appointmentType: d.appointmentType ?? null,
      reason: d.reason ?? null,
      status: d.status,
      location: d.location ?? null,
    };
  });

  return json({ appointments, count: appointments.length });
}

async function patientAppointments(db: Db, patientId: string, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const snap = await (await nc(db, "appointments"))
    .where("patientId", "==", patientId)
    .orderBy("appointmentDate", "desc")
    .limit(limit)
    .get();

  const appointments = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      appointmentDate: tsToISO(d.appointmentDate),
      duration: d.duration ?? null,
      appointmentType: d.appointmentType ?? null,
      reason: d.reason ?? null,
      notes: d.notes ?? null,
      status: d.status,
    };
  });

  return json({ appointments, count: appointments.length });
}

async function getAppointment(db: Db, id: string): Promise<Response> {
  const doc = await (await nc(db, "appointments")).doc(id).get();
  if (!doc.exists) return error("Appointment not found", 404);

  const d = doc.data()!;
  return json({
    id: doc.id,
    patientId: d.patientId,
    appointmentDate: tsToISO(d.appointmentDate),
    duration: d.duration ?? null,
    appointmentType: d.appointmentType ?? null,
    reason: d.reason ?? null,
    notes: d.notes ?? null,
    status: d.status,
    location: d.location ?? null,
    calendarEventId: d.calendarEventId ?? null,
    reminderSent: d.reminderSent ?? false,
    createdAt: tsToISO(d.createdAt),
    updatedAt: tsToISO(d.updatedAt),
  });
}

async function updateAppointment(db: Db, id: string, req: Request): Promise<Response> {
  const doc = await (await nc(db, "appointments")).doc(id).get();
  if (!doc.exists) return error("Appointment not found", 404);

  const body = await req.json() as Record<string, any>;

  // SAFETY: cancelling requires operator authorization
  if (body.status === "cancelled") {
    if (!isOperatorAuthorized(req)) {
      return error("Cancelling an appointment requires operator authorization. Include X-Operator-Authorized: true header after confirming with the admin.", 403);
    }
  }

  const allowed = ["status", "notes", "reason", "appointmentType", "duration", "location"];
  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  await (await nc(db, "appointments")).doc(id).update(updates);
  return json({ success: true, appointmentId: id });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

async function listThreads(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const filter = url.searchParams.get("filter");

  let query = (await nc(db, "message-threads"))
    .where("isActive", "==", true)
    .orderBy("updatedAt", "desc")
    .limit(limit);

  if (filter === "unread") {
    query = (await nc(db, "message-threads"))
      .where("isActive", "==", true)
      .where("unreadForAdmin", "==", true)
      .orderBy("updatedAt", "desc")
      .limit(limit);
  } else if (filter === "priority") {
    query = (await nc(db, "message-threads"))
      .where("isActive", "==", true)
      .where("priority", "==", "high")
      .orderBy("updatedAt", "desc")
      .limit(limit);
  }

  const after = url.searchParams.get("after");
  if (after) {
    const cursor = await (await nc(db, "message-threads")).doc(after).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }

  const snap = await query.get();
  const threads = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      patientId: d.patientId,
      subject: d.subject,
      lastMessage: d.lastMessage ?? null,
      lastMessageAt: tsToISO(d.lastMessageAt),
      status: d.status,
      priority: d.priority,
      tags: d.tags ?? [],
      unreadForAdmin: d.unreadForAdmin ?? false,
      unreadForPatient: d.unreadForPatient ?? false,
      createdAt: tsToISO(d.createdAt),
      updatedAt: tsToISO(d.updatedAt),
    };
  });

  return json({ threads, count: threads.length });
}

async function getThread(db: Db, threadId: string, url: URL): Promise<Response> {
  const threadDoc = await (await nc(db, "message-threads")).doc(threadId).get();
  if (!threadDoc.exists) return error("Thread not found", 404);

  const limit = parseLimit(url, 50, 100);
  const snap = await (await nc(db, "thread-messages"))
    .where("threadId", "==", threadId)
    .orderBy("createdAt", "asc")
    .limit(limit)
    .get();

  const messages = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      senderId: d.senderId,
      senderName: d.senderName,
      senderRole: d.senderRole,
      content: d.content,
      attachments: (d.attachments ?? []).map((a: any) => ({
        name: a.name, type: a.type, size: a.size,
      })),
      createdAt: tsToISO(d.createdAt),
    };
  });

  const t = threadDoc.data()!;
  return json({
    thread: {
      id: threadDoc.id,
      patientId: t.patientId,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      tags: t.tags ?? [],
    },
    messages,
    count: messages.length,
  });
}

async function sendMessage(db: Db, threadId: string, req: Request): Promise<Response> {
  const threadDoc = await (await nc(db, "message-threads")).doc(threadId).get();
  if (!threadDoc.exists) return error("Thread not found", 404);

  const body = await req.json() as Record<string, any>;
  if (!body.content?.trim()) return error("content is required");

  const content = String(body.content).trim().slice(0, 5000);
  const senderId = req.headers.get("x-user-uid");
  const senderName = req.headers.get("x-user-name");
  if (!senderId || !senderName) return error("Missing X-User-Uid or X-User-Name headers", 401);

  const msgRef = await (await nc(db, "thread-messages")).add({
    threadId,
    senderId,
    senderName,
    senderRole: "admin",
    content,
    attachments: [],
    createdAt: FieldValue.serverTimestamp(),
  });

  (await nc(db, "message-threads")).doc(threadId).update({
    lastMessage: content.slice(0, 100),
    lastMessageAt: FieldValue.serverTimestamp(),
    unreadForPatient: true,
    unreadForAdmin: false,
    updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => {});

  return json({ success: true, messageId: msgRef.id }, 201);
}

async function createThread(db: Db, req: Request): Promise<Response> {
  const body = await req.json() as Record<string, any>;
  if (!body.patientId) return error("patientId is required");
  if (!body.subject?.trim()) return error("subject is required");

  const patientDoc = await (await nc(db, "users")).doc(body.patientId).get();
  if (!patientDoc.exists || patientDoc.data()!.role !== "patient") {
    return error("Patient not found", 404);
  }

  const threadRef = await (await nc(db, "message-threads")).add({
    patientId: body.patientId,
    subject: String(body.subject).trim().slice(0, 200),
    status: "open",
    priority: body.priority ?? "normal",
    tags: body.tags ?? [],
    isActive: true,
    unreadForAdmin: false,
    unreadForPatient: true,
    lastMessage: body.initialMessage ? String(body.initialMessage).slice(0, 100) : null,
    lastMessageAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (body.initialMessage?.trim()) {
    const msgSenderId = req.headers.get("x-user-uid");
    const msgSenderName = req.headers.get("x-user-name");
    if (!msgSenderId || !msgSenderName) return error("Missing X-User-Uid or X-User-Name headers", 401);

    await (await nc(db, "thread-messages")).add({
      threadId: threadRef.id,
      senderId: msgSenderId,
      senderName: msgSenderName,
      senderRole: "admin",
      content: String(body.initialMessage).trim().slice(0, 5000),
      attachments: [],
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return json({ success: true, threadId: threadRef.id }, 201);
}

async function updateThread(db: Db, threadId: string, req: Request): Promise<Response> {
  const doc = await (await nc(db, "message-threads")).doc(threadId).get();
  if (!doc.exists) return error("Thread not found", 404);

  const body = await req.json() as Record<string, any>;
  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };

  if ("status" in body) {
    const validStatuses = ["open", "in_progress", "resolved", "closed"];
    if (!validStatuses.includes(body.status)) return error(`Invalid status. Must be: ${validStatuses.join(", ")}`);
    updates.status = body.status;
  }
  if ("priority" in body) {
    const validPriorities = ["normal", "high"];
    if (!validPriorities.includes(body.priority)) return error(`Invalid priority. Must be: ${validPriorities.join(", ")}`);
    updates.priority = body.priority;
  }
  if ("tags" in body) {
    if (!Array.isArray(body.tags)) return error("tags must be an array");
    updates.tags = body.tags;
  }

  await (await nc(db, "message-threads")).doc(threadId).update(updates);
  return json({ success: true, threadId });
}

// ---------------------------------------------------------------------------
// Refills
// ---------------------------------------------------------------------------

async function listRefills(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const status = url.searchParams.get("status");

  let query = (await nc(db, "prescription-refills"))
    .orderBy("createdAt", "desc")
    .limit(limit);

  if (status) {
    query = (await nc(db, "prescription-refills"))
      .where("status", "==", status)
      .orderBy("createdAt", "desc")
      .limit(limit);
  }

  const after = url.searchParams.get("after");
  if (after) {
    const cursor = await (await nc(db, "prescription-refills")).doc(after).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }

  const snap = await query.get();
  const refills = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      patientId: d.patientId,
      medicationName: d.medicationName,
      dosage: d.dosage,
      quantity: d.quantity,
      pharmacyName: d.pharmacyName,
      urgency: d.urgency,
      status: d.status,
      notes: d.notes ?? null,
      doctorNotes: d.doctorNotes ?? null,
      createdAt: tsToISO(d.createdAt),
    };
  });

  return json({ refills, count: refills.length });
}

async function getRefill(db: Db, id: string): Promise<Response> {
  const doc = await (await nc(db, "prescription-refills")).doc(id).get();
  if (!doc.exists) return error("Refill not found", 404);

  const d = doc.data()!;
  return json({
    id: doc.id,
    patientId: d.patientId,
    medicationName: d.medicationName,
    dosage: d.dosage,
    quantity: d.quantity,
    pharmacyName: d.pharmacyName,
    pharmacyPhone: d.pharmacyPhone ?? null,
    pharmacyAddress: d.pharmacyAddress ?? null,
    prescriptionNumber: d.prescriptionNumber ?? null,
    urgency: d.urgency,
    status: d.status,
    notes: d.notes ?? null,
    doctorNotes: d.doctorNotes ?? null,
    requestedDate: tsToISO(d.requestedDate),
    createdAt: tsToISO(d.createdAt),
    updatedAt: tsToISO(d.updatedAt),
  });
}

async function patientRefills(db: Db, patientId: string, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const snap = await (await nc(db, "prescription-refills"))
    .where("patientId", "==", patientId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const refills = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      medicationName: d.medicationName,
      dosage: d.dosage,
      status: d.status,
      urgency: d.urgency,
      notes: d.notes ?? null,
      doctorNotes: d.doctorNotes ?? null,
      createdAt: tsToISO(d.createdAt),
    };
  });

  return json({ refills, count: refills.length });
}

async function updateRefill(db: Db, id: string, req: Request): Promise<Response> {
  const doc = await (await nc(db, "prescription-refills")).doc(id).get();
  if (!doc.exists) return error("Refill not found", 404);

  const body = await req.json() as Record<string, any>;
  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };

  if (body.status) {
    const validStatuses = ["pending", "approved", "denied", "completed", "cancelled"];
    if (!validStatuses.includes(body.status)) return error(`Invalid status. Must be: ${validStatuses.join(", ")}`);
    updates.status = body.status;
  }
  if ("doctorNotes" in body) updates.doctorNotes = String(body.doctorNotes).slice(0, 2000);
  if ("notes" in body) updates.notes = String(body.notes).slice(0, 2000);

  await (await nc(db, "prescription-refills")).doc(id).update(updates);
  return json({ success: true, refillId: id, status: updates.status ?? doc.data()!.status });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

async function patientDocuments(db: Db, patientId: string, url: URL): Promise<Response> {
  const type = url.searchParams.get("type");

  let query: FirebaseFirestore.Query = (await nc(db, "patient-documents"))
    .where("patientId", "==", patientId)
    .where("isActive", "==", true);

  if (type) query = query.where("documentType", "==", type);

  const snap = await query.get();
  const documents = snap.docs
    .map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        fileName: d.fileName,
        originalFileName: d.originalFileName,
        fileSize: d.fileSize,
        fileType: d.fileType,
        documentType: d.documentType,
        description: d.description ?? null,
        uploadedAt: tsToISO(d.uploadedAt),
        tags: d.tags ?? [],
      };
    })
    .sort((a, b) => {
      const at = new Date(a.uploadedAt || 0).getTime();
      const bt = new Date(b.uploadedAt || 0).getTime();
      return bt - at;
    });

  return json({ documents, count: documents.length });
}

async function documentStatus(db: Db, patientId: string): Promise<Response> {
  const required = ["drivers_license", "insurance_card_front", "insurance_card_back"];
  const snap = await (await nc(db, "patient-documents"))
    .where("patientId", "==", patientId)
    .where("isActive", "==", true)
    .get();

  const existing = new Set(snap.docs.map(d => d.data().documentType));
  const status = required.map(type => ({
    type,
    uploaded: existing.has(type),
  }));

  return json({
    patientId,
    requiredDocuments: status,
    complete: required.every(t => existing.has(t)),
    totalDocuments: snap.size,
  });
}

// ---------------------------------------------------------------------------
// Intake Forms
// ---------------------------------------------------------------------------

async function listIntakeForms(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const formStatus = url.searchParams.get("status");

  let query = (await nc(db, "patient-intake-forms"))
    .orderBy("updatedAt", "desc")
    .limit(limit);

  if (formStatus) {
    query = (await nc(db, "patient-intake-forms"))
      .where("status", "==", formStatus)
      .orderBy("updatedAt", "desc")
      .limit(limit);
  }

  const snap = await query.get();
  const forms = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      patientId: d.patientId,
      status: d.status,
      currentSection: d.currentSection ?? null,
      completedSections: d.completedSections ?? [],
      reviewedBy: d.reviewedBy ?? null,
      reviewNotes: d.reviewNotes ?? null,
      createdAt: tsToISO(d.createdAt),
      updatedAt: tsToISO(d.updatedAt),
      submittedAt: tsToISO(d.submittedAt),
    };
  });

  return json({ forms, count: forms.length });
}

async function getIntakeForm(db: Db, patientId: string): Promise<Response> {
  const snap = await (await nc(db, "patient-intake-forms"))
    .where("patientId", "==", patientId)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  if (snap.empty) return error("Intake form not found", 404);

  const doc = snap.docs[0];
  const d = doc.data();

  // Section data is stored as top-level fields (patientInfo, medicalHistory, etc.)
  const metaKeys = new Set([
    "patientId", "status", "currentSection", "completedSections",
    "reviewedBy", "reviewNotes", "reviewedAt", "createdAt", "updatedAt",
    "submittedAt", "skipIntakeForm",
  ]);
  const sections: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(d)) {
    if (!metaKeys.has(key) && typeof value === "object" && value !== null) {
      sections[key] = value;
    }
  }

  return json({
    id: doc.id,
    patientId: d.patientId,
    status: d.status,
    currentSection: d.currentSection ?? null,
    completedSections: d.completedSections ?? [],
    sections,
    reviewedBy: d.reviewedBy ?? null,
    reviewNotes: d.reviewNotes ?? null,
    createdAt: tsToISO(d.createdAt),
    updatedAt: tsToISO(d.updatedAt),
    submittedAt: tsToISO(d.submittedAt),
  });
}

async function approveIntakeForm(db: Db, formId: string, req: Request): Promise<Response> {
  const doc = await (await nc(db, "patient-intake-forms")).doc(formId).get();
  if (!doc.exists) return error("Form not found", 404);

  const reviewedBy = req.headers.get("x-user-uid");
  if (!reviewedBy) return error("Missing X-User-Uid header", 401);

  await (await nc(db, "patient-intake-forms")).doc(formId).update({
    status: "approved",
    reviewedBy,
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return json({ success: true, formId, status: "approved" });
}

async function sendBackIntakeForm(db: Db, formId: string, req: Request): Promise<Response> {
  const doc = await (await nc(db, "patient-intake-forms")).doc(formId).get();
  if (!doc.exists) return error("Form not found", 404);

  const reviewedBy = req.headers.get("x-user-uid");
  if (!reviewedBy) return error("Missing X-User-Uid header", 401);

  const body = await req.json() as Record<string, any>;
  if (!body.reviewNotes?.trim()) return error("reviewNotes is required");

  await (await nc(db, "patient-intake-forms")).doc(formId).update({
    status: "in_progress",
    reviewedBy,
    reviewNotes: String(body.reviewNotes).trim().slice(0, 2000),
    skipIntakeForm: false,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return json({ success: true, formId, status: "in_progress" });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function listNotifications(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url, 20, 50);
  const snap = await (await nc(db, "notifications"))
    .where("recipientRole", "==", "admin")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const notifications = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      type: d.type,
      title: d.title,
      message: d.message,
      isRead: d.isRead ?? false,
      meta: d.meta ?? {},
      createdAt: tsToISO(d.createdAt),
    };
  });

  return json({ notifications, count: notifications.length });
}

async function createNotification(db: Db, req: Request): Promise<Response> {
  const body = await req.json() as Record<string, any>;
  if (!body.title?.trim()) return error("title is required");
  if (!body.message?.trim()) return error("message is required");

  const validRoles = ["admin", "assistant", "patient"];
  const recipientRole = validRoles.includes(body.recipientRole) ? body.recipientRole : "admin";

  const ref = await (await nc(db, "notifications")).add({
    recipientRole,
    ...(body.recipientId ? { recipientId: body.recipientId } : {}),
    type: body.type ?? "general",
    title: String(body.title).trim().slice(0, 200),
    message: String(body.message).trim().slice(0, 1000),
    isRead: false,
    readBy: {},
    meta: body.meta ?? {},
    createdAt: FieldValue.serverTimestamp(),
  });

  return json({ success: true, notificationId: ref.id }, 201);
}

// ---------------------------------------------------------------------------
// Specialist Requests
// ---------------------------------------------------------------------------

async function listSpecialistRequests(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const snap = await (await nc(db, "specialist-requests"))
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const requests = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      patientId: d.patientId,
      specialistType: d.specialistType,
      reason: d.reason ?? null,
      notes: d.notes ?? null,
      status: d.status,
      createdAt: tsToISO(d.createdAt),
      updatedAt: tsToISO(d.updatedAt),
    };
  });

  return json({ requests, count: requests.length });
}

async function updateSpecialistRequest(db: Db, id: string, req: Request): Promise<Response> {
  const doc = await (await nc(db, "specialist-requests")).doc(id).get();
  if (!doc.exists) return error("Request not found", 404);

  const body = await req.json() as Record<string, any>;
  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
  if ("status" in body) {
    const validStatuses = ["pending", "approved", "referred", "denied", "closed"];
    if (!validStatuses.includes(body.status)) return error(`Invalid status. Must be: ${validStatuses.join(", ")}`);
    updates.status = body.status;
  }
  if ("notes" in body) updates.notes = String(body.notes).slice(0, 2000);

  await (await nc(db, "specialist-requests")).doc(id).update(updates);
  return json({ success: true, requestId: id });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleAdminApi(
  method: string,
  path: string,
  url: URL,
  request: Request,
): Promise<Response> {
  const db = getDb();

  const apiPath = path.replace(/^\/admin-api/, "");
  const parts = apiPath.split("/").filter(Boolean);
  const resource = parts[0];
  const id = parts[1];
  const action = parts[2];

  try {
    // EHR pass-throughs are handled uniformly via the registry — one branch,
    // one place to bolt on metrics / request-id / sim-flag logic.
    const ehr = EHR_REGISTRY[resource];
    if (ehr) return await ehrRoute(resource, method, parts, url, request, ehr);

    switch (resource) {
      // ── Patients (NO DELETE — forbidden) ──
      case "patients":
        if (method === "GET" && !id) return await listPatients(db, url);
        if (method === "GET" && id === "stats") return await patientStats(db);
        if (method === "GET" && id) return await getPatient(db, id);
        if (method === "PATCH" && id) return await updatePatient(db, id, request);
        if (method === "DELETE") return error("Patient deletion is forbidden. Use PATCH to deactivate instead.", 403);
        break;

      // ── Appointments (create + cancel require authorization) ──
      case "appointments":
        if (method === "GET" && !id) return await listAppointments(db, url);
        if (method === "GET" && id === "upcoming") return await upcomingAppointments(db);
        if (method === "GET" && id === "slots") return await appointmentSlots(db, url);
        if (method === "GET" && id === "patient" && action) return await patientAppointments(db, action, url);
        if (method === "GET" && id) return await getAppointment(db, id);
        if (method === "POST" && !id) return await createAppointment(db, request);
        if (method === "PATCH" && id) return await updateAppointment(db, id, request);
        break;

      // ── Messages ──
      case "messages":
        if (method === "GET" && !id) return await listThreads(db, url);
        if (method === "GET" && id) return await getThread(db, id, url);
        if (method === "POST" && !id) return await createThread(db, request);
        if (method === "POST" && id && action === "reply") return await sendMessage(db, id, request);
        if (method === "PATCH" && id) return await updateThread(db, id, request);
        break;

      // ── Refills ──
      case "refills":
        if (method === "GET" && !id) return await listRefills(db, url);
        if (method === "GET" && id === "patient" && action) return await patientRefills(db, action, url);
        if (method === "GET" && id) return await getRefill(db, id);
        if (method === "PATCH" && id) return await updateRefill(db, id, request);
        break;

      // ── Documents (read-only) ──
      case "documents":
        if (method === "GET" && id === "patient" && action) {
          if (parts[3] === "status") return await documentStatus(db, action);
          return await patientDocuments(db, action, url);
        }
        break;

      // ── Intake Forms ──
      case "intake-forms":
        if (method === "GET" && !id) return await listIntakeForms(db, url);
        if (method === "GET" && id === "patient" && action) return await getIntakeForm(db, action);
        if (method === "POST" && id && action === "approve") return await approveIntakeForm(db, id, request);
        if (method === "POST" && id && action === "send-back") return await sendBackIntakeForm(db, id, request);
        break;

      // ── Notifications ──
      case "notifications":
        if (method === "GET" && !id) return await listNotifications(db, url);
        if (method === "POST" && !id) return await createNotification(db, request);
        break;

      // ── Specialist Requests ──
      case "specialist-requests":
        if (method === "GET" && !id) return await listSpecialistRequests(db, url);
        if (method === "PATCH" && id) return await updateSpecialistRequest(db, id, request);
        break;

      // ── EHR pass-throughs (drchrono/athena/elation/ecw/nextgen/tebra/
      //    greenway/pfusion/cerner/epic) are resolved via EHR_REGISTRY
      //    above the switch — see ehrRoute().

      // ── Faxes ──
      // Path: /admin-api/faxes/<action>
      // Reads + PATCH work in both modes (sim → simulation/faxes/*,
      // real → inbound-faxes / outbound-faxes). Send + to-drchrono are
      // sim-only for now; real path still lives in the sendOutboundFax
      // / attachFaxToDrChrono Cloud Functions until fully migrated.
      case "faxes": {
        const sub = parts[1];
        const sim = await isSimulationOn();

        // Reads + PATCH + our-number: branch on sim inside each handler so
        // both modes share the admin-api surface. Aurelia doesn't know or
        // care whether the rows came from real Firestore or the sandbox.
        if (method === "GET" && sub === "our-number") {
          return sim ? await simFaxGetOurNumber() : await realFaxGetOurNumber();
        }
        if (method === "GET" && sub === "inbound") {
          return sim ? await simFaxListInbound() : await realFaxListInbound();
        }
        if (method === "GET" && sub === "outbound") {
          return sim ? await simFaxListOutbound() : await realFaxListOutbound();
        }

        // Sim-only creators (no real counterpart — seed data, not a real op).
        if (sim && method === "POST" && sub === "inject-inbound") return await simFaxInjectInbound(request);

        // Send + to-drchrono: sim has a sandbox implementation; real still
        // lives in Cloud Functions until the full migration.
        if (method === "POST" && sub === "to-drchrono") {
          if (!sim) return error("Real fax→chart still on Cloud Functions; use attachFaxToDrChrono callable", 501);
          return await simFaxToDrChrono(request);
        }
        if (method === "POST" && sub === "send") {
          const callerUid = request.headers.get("x-caller-uid") || "sidecar-agent";
          if (sim) return await simFaxSend(request, callerUid);
          return await realFaxSend(request, callerUid);
        }

        // Single-fax ops: /admin-api/faxes/:faxSid
        if (sub && method === "GET") {
          return sim ? await simFaxGet(sub) : await realFaxGet(sub);
        }
        if (sub && method === "PATCH") {
          return sim ? await simFaxPatch(sub, request) : await realFaxPatch(sub, request);
        }
        return error(`Unknown faxes action: ${method} ${sub}`, 404);
      }

      // ── Google Workspace (sim-only) ──
      // Path: /admin-api/workspace/<gmail|calendar>/<action>
      case "workspace": {
        if (!(await isSimulationOn())) {
          return error("Workspace admin-api is currently sim-only; real path is on Cloud Functions", 501);
        }
        const wsPath = parts.slice(1).join("/");
        return await simWorkspace(method, wsPath, url.searchParams, request);
      }

      // ── Messaging (SMS) ──
      // Path: /admin-api/messaging/<action>
      // Sim mode → simulation/sms/* sandbox. Real mode → Twilio REST +
      // sms-outbound/sms-inbound. inject-inbound is a sim-only helper.
      case "messaging": {
        const sub = parts[1];
        const sim = await isSimulationOn();
        if (method === "GET" && sub === "outbound") {
          return await simSmsListOutbound(); // real-mode history uses the Firestore subscription directly
        }
        if (method === "GET" && sub === "inbound") {
          return await simSmsListInbound();
        }
        if (method === "POST" && sub === "send") {
          return sim ? await simSmsSend(request) : await realSmsSend(request);
        }
        if (method === "POST" && sub === "inject-inbound") {
          if (!sim) return error("inject-inbound is sim-only", 400);
          return await simSmsInjectInbound(request);
        }
        return error(`Unknown messaging action: ${method} ${sub}`, 404);
      }

      // ── Prior Auth ──
      // Read PAs + events, append notes. Writes that drive the state
      // machine (create, status change, policy review) stay in the
      // admin UI / Cloud Functions — those enforce server-side rules.
      case "prior-auths": {
        if (method === "GET" && !id) return await listPriorAuths(url);
        if (method === "GET" && id && action === "events") return await listPriorAuthEvents(id, url);
        if (method === "GET" && id) return await getPriorAuth(id);
        if (method === "POST" && id && action === "notes") return await appendPriorAuthNote(id, request);
        if (method === "POST" && id && action === "chart-gap-check") return await runChartGapCheck(request);
        break;
      }
      // Singular alias — the runChartGapCheck Cloud Function posts here.
      case "prior-auth": {
        if (method === "POST" && id === "chart-gap-check") return await runChartGapCheck(request);
        break;
      }
      case "payers": {
        if (method === "GET" && !id) return await listPayers();
        break;
      }
      case "payer-policies": {
        if (method === "GET" && id) return await getPayerPolicy(id);
        break;
      }
      case "target-cpts": {
        if (method === "GET" && !id) return await listTargetCpts();
        break;
      }

      default:
        return json({
          error: "Unknown resource",
          available: [
            "GET    /admin-api/patients[?search=&status=&limit=&after=]",
            "GET    /admin-api/patients/stats",
            "GET    /admin-api/patients/:id",
            "PATCH  /admin-api/patients/:id  (deactivate requires X-Operator-Authorized)",
            "GET    /admin-api/appointments[?status=&limit=&after=]",
            "GET    /admin-api/appointments/upcoming",
            "GET    /admin-api/appointments/slots?date=YYYY-MM-DD",
            "GET    /admin-api/appointments/patient/:patientId",
            "GET    /admin-api/appointments/:id",
            "POST   /admin-api/appointments  (requires X-Operator-Authorized)",
            "PATCH  /admin-api/appointments/:id  (cancel requires X-Operator-Authorized)",
            "GET    /admin-api/messages[?filter=all|unread|priority&limit=&after=]",
            "GET    /admin-api/messages/:threadId",
            "POST   /admin-api/messages",
            "POST   /admin-api/messages/:threadId/reply",
            "PATCH  /admin-api/messages/:threadId",
            "GET    /admin-api/refills[?status=&limit=&after=]",
            "GET    /admin-api/refills/patient/:patientId",
            "GET    /admin-api/refills/:id",
            "PATCH  /admin-api/refills/:id",
            "GET    /admin-api/documents/patient/:patientId[?type=]",
            "GET    /admin-api/documents/patient/:patientId/status",
            "GET    /admin-api/intake-forms[?status=&limit=]",
            "GET    /admin-api/intake-forms/patient/:patientId",
            "POST   /admin-api/intake-forms/:id/approve",
            "POST   /admin-api/intake-forms/:id/send-back",
            "GET    /admin-api/notifications[?limit=]",
            "POST   /admin-api/notifications",
            "GET    /admin-api/specialist-requests[?limit=]",
            "PATCH  /admin-api/specialist-requests/:id",
            "*      /admin-api/drchrono/<path>  (when integration enabled)",
            "*      /admin-api/athena/<path>    (when integration enabled)",
            "*      /admin-api/elation/<path>   (when integration enabled)",
            "*      /admin-api/ecw/<path>       (when integration enabled)",
            "*      /admin-api/nextgen/<path>   (when integration enabled)",
            "*      /admin-api/tebra/<path>     (when integration enabled)",
            "*      /admin-api/greenway/<path>  (when integration enabled)",
            "*      /admin-api/pfusion/<path>   (when integration enabled)",
            "*      /admin-api/cerner/<path>    (when integration enabled)",
            "*      /admin-api/epic/<path>      (when integration enabled)",
          ],
        }, 404);
    }

    return error("Method not allowed for this endpoint", 405);
  } catch (err: any) {
    console.error(`[admin-api] ${method} ${apiPath} error:`, err.message);
    return json({ error: "Internal error" }, 500);
  }
}
