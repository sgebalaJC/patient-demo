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
// Patients
// ---------------------------------------------------------------------------

async function listPatients(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const search = url.searchParams.get("search")?.trim();
  const statusFilter = url.searchParams.get("status");

  let query: FirebaseFirestore.Query = db.collection("users")
    .where("role", "==", "patient")
    .orderBy("lastName")
    .limit(limit);

  if (search) {
    query = db.collection("users")
      .where("role", "==", "patient")
      .where("lastName", ">=", search)
      .where("lastName", "<=", search + "\uf8ff")
      .orderBy("lastName")
      .limit(limit);
  }

  // Apply status filter at query level to avoid fetching unnecessary docs
  if (statusFilter === "active") {
    query = query.where("isActive", "==", true);
  } else if (statusFilter === "inactive") {
    query = query.where("isActive", "==", false);
  }

  const after = url.searchParams.get("after");
  if (after) {
    const cursor = await db.collection("users").doc(after).get();
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
  const doc = await db.collection("users").doc(id).get();
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
  const doc = await db.collection("users").doc(id).get();
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

  await db.collection("users").doc(id).update(updates);
  return json({ success: true, patientId: id });
}

async function patientStats(db: Db): Promise<Response> {
  const allSnap = await db.collection("users").where("role", "==", "patient").count().get();
  const activeSnap = await db.collection("users").where("role", "==", "patient").where("isActive", "==", true).count().get();
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

  let query = db.collection("appointments")
    .orderBy("appointmentDate", "desc")
    .limit(limit);

  if (status) {
    query = db.collection("appointments")
      .where("status", "==", status)
      .orderBy("appointmentDate", "desc")
      .limit(limit);
  }

  const after = url.searchParams.get("after");
  if (after) {
    const cursor = await db.collection("appointments").doc(after).get();
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

async function upcomingAppointments(db: Db): Promise<Response> {
  const now = Timestamp.now();
  // Include both "scheduled" and "confirmed" — either status means the appointment is upcoming
  const snap = await db.collection("appointments")
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
  const snap = await db.collection("appointments")
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
  const doc = await db.collection("appointments").doc(id).get();
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
  const doc = await db.collection("appointments").doc(id).get();
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

  await db.collection("appointments").doc(id).update(updates);
  return json({ success: true, appointmentId: id });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

async function listThreads(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const filter = url.searchParams.get("filter");

  let query = db.collection("message-threads")
    .where("isActive", "==", true)
    .orderBy("updatedAt", "desc")
    .limit(limit);

  if (filter === "unread") {
    query = db.collection("message-threads")
      .where("isActive", "==", true)
      .where("unreadForAdmin", "==", true)
      .orderBy("updatedAt", "desc")
      .limit(limit);
  } else if (filter === "priority") {
    query = db.collection("message-threads")
      .where("isActive", "==", true)
      .where("priority", "==", "high")
      .orderBy("updatedAt", "desc")
      .limit(limit);
  }

  const after = url.searchParams.get("after");
  if (after) {
    const cursor = await db.collection("message-threads").doc(after).get();
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
  const threadDoc = await db.collection("message-threads").doc(threadId).get();
  if (!threadDoc.exists) return error("Thread not found", 404);

  const limit = parseLimit(url, 50, 100);
  const snap = await db.collection("thread-messages")
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
  const threadDoc = await db.collection("message-threads").doc(threadId).get();
  if (!threadDoc.exists) return error("Thread not found", 404);

  const body = await req.json() as Record<string, any>;
  if (!body.content?.trim()) return error("content is required");

  const content = String(body.content).trim().slice(0, 5000);
  const senderId = req.headers.get("x-user-uid");
  const senderName = req.headers.get("x-user-name");
  if (!senderId || !senderName) return error("Missing X-User-Uid or X-User-Name headers", 401);

  const msgRef = await db.collection("thread-messages").add({
    threadId,
    senderId,
    senderName,
    senderRole: "admin",
    content,
    attachments: [],
    createdAt: FieldValue.serverTimestamp(),
  });

  db.collection("message-threads").doc(threadId).update({
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

  const patientDoc = await db.collection("users").doc(body.patientId).get();
  if (!patientDoc.exists || patientDoc.data()!.role !== "patient") {
    return error("Patient not found", 404);
  }

  const threadRef = await db.collection("message-threads").add({
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

    await db.collection("thread-messages").add({
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
  const doc = await db.collection("message-threads").doc(threadId).get();
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

  await db.collection("message-threads").doc(threadId).update(updates);
  return json({ success: true, threadId });
}

// ---------------------------------------------------------------------------
// Refills
// ---------------------------------------------------------------------------

async function listRefills(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const status = url.searchParams.get("status");

  let query = db.collection("prescription-refills")
    .orderBy("createdAt", "desc")
    .limit(limit);

  if (status) {
    query = db.collection("prescription-refills")
      .where("status", "==", status)
      .orderBy("createdAt", "desc")
      .limit(limit);
  }

  const after = url.searchParams.get("after");
  if (after) {
    const cursor = await db.collection("prescription-refills").doc(after).get();
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
  const doc = await db.collection("prescription-refills").doc(id).get();
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
  const snap = await db.collection("prescription-refills")
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
  const doc = await db.collection("prescription-refills").doc(id).get();
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

  await db.collection("prescription-refills").doc(id).update(updates);
  return json({ success: true, refillId: id, status: updates.status ?? doc.data()!.status });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

async function patientDocuments(db: Db, patientId: string, url: URL): Promise<Response> {
  const type = url.searchParams.get("type");

  let query: FirebaseFirestore.Query = db.collection("patient-documents")
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
  const snap = await db.collection("patient-documents")
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

  let query = db.collection("patient-intake-forms")
    .orderBy("updatedAt", "desc")
    .limit(limit);

  if (formStatus) {
    query = db.collection("patient-intake-forms")
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
  const snap = await db.collection("patient-intake-forms")
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
  const doc = await db.collection("patient-intake-forms").doc(formId).get();
  if (!doc.exists) return error("Form not found", 404);

  const reviewedBy = req.headers.get("x-user-uid");
  if (!reviewedBy) return error("Missing X-User-Uid header", 401);

  await db.collection("patient-intake-forms").doc(formId).update({
    status: "approved",
    reviewedBy,
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return json({ success: true, formId, status: "approved" });
}

async function sendBackIntakeForm(db: Db, formId: string, req: Request): Promise<Response> {
  const doc = await db.collection("patient-intake-forms").doc(formId).get();
  if (!doc.exists) return error("Form not found", 404);

  const reviewedBy = req.headers.get("x-user-uid");
  if (!reviewedBy) return error("Missing X-User-Uid header", 401);

  const body = await req.json() as Record<string, any>;
  if (!body.reviewNotes?.trim()) return error("reviewNotes is required");

  await db.collection("patient-intake-forms").doc(formId).update({
    status: "in_progress",
    reviewedBy,
    reviewNotes: String(body.reviewNotes).trim().slice(0, 2000),
    skipIntakeForm: false,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return json({ success: true, formId, status: "in_progress" });
}

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

async function listTodos(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url);
  const filter = url.searchParams.get("filter");

  let query = db.collection("admin-todos")
    .where("isActive", "==", true)
    .orderBy("createdAt", "desc")
    .limit(limit);

  if (filter === "completed") {
    query = db.collection("admin-todos")
      .where("isActive", "==", true)
      .where("isCompleted", "==", true)
      .orderBy("createdAt", "desc")
      .limit(limit);
  } else if (filter === "upcoming" || filter === "overdue") {
    query = db.collection("admin-todos")
      .where("isActive", "==", true)
      .where("isCompleted", "==", false)
      .orderBy("scheduledDateTime", "asc")
      .limit(limit);
  }

  const snap = await query.get();
  const now = new Date();
  let todos = snap.docs.map(doc => {
    const d = doc.data();
    const scheduledDateTime = d.scheduledDateTime?.toDate?.() ?? null;
    return {
      id: doc.id,
      title: d.title,
      description: d.description ?? null,
      isCompleted: d.isCompleted ?? false,
      scheduledDateTime: scheduledDateTime?.toISOString() ?? null,
      isOverdue: scheduledDateTime ? scheduledDateTime < now && !d.isCompleted : false,
      reminderSent: d.reminderSent ?? false,
      createdAt: tsToISO(d.createdAt),
    };
  });

  if (filter === "upcoming") todos = todos.filter(t => !t.isOverdue && !t.isCompleted);
  if (filter === "overdue") todos = todos.filter(t => t.isOverdue);

  return json({ todos, count: todos.length });
}

async function createTodo(db: Db, req: Request): Promise<Response> {
  const body = await req.json() as Record<string, any>;
  if (!body.title?.trim()) return error("title is required");

  const data: Record<string, any> = {
    title: String(body.title).trim().slice(0, 200),
    isCompleted: false,
    isActive: true,
    reminderSent: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (body.description) data.description = String(body.description).trim().slice(0, 1000);
  if (body.scheduledDateTime) {
    const d = new Date(body.scheduledDateTime);
    if (isNaN(d.getTime())) return error("Invalid scheduledDateTime format (use ISO 8601)");
    data.scheduledDateTime = Timestamp.fromDate(d);
  }

  const ref = await db.collection("admin-todos").add(data);
  return json({ success: true, todoId: ref.id }, 201);
}

async function updateTodo(db: Db, id: string, req: Request): Promise<Response> {
  const doc = await db.collection("admin-todos").doc(id).get();
  if (!doc.exists) return error("Todo not found", 404);

  const body = await req.json() as Record<string, any>;
  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
  if ("title" in body) updates.title = String(body.title).trim().slice(0, 200);
  if ("description" in body) updates.description = String(body.description).trim().slice(0, 1000);
  if ("isCompleted" in body) updates.isCompleted = !!body.isCompleted;
  if ("scheduledDateTime" in body) {
    if (body.scheduledDateTime) {
      const d = new Date(body.scheduledDateTime);
      if (isNaN(d.getTime())) return error("Invalid scheduledDateTime format (use ISO 8601)");
      updates.scheduledDateTime = Timestamp.fromDate(d);
    } else {
      updates.scheduledDateTime = null;
    }
  }
  if ("isActive" in body) updates.isActive = !!body.isActive;

  await db.collection("admin-todos").doc(id).update(updates);
  return json({ success: true, todoId: id });
}

async function deleteTodo(db: Db, id: string): Promise<Response> {
  const doc = await db.collection("admin-todos").doc(id).get();
  if (!doc.exists) return error("Todo not found", 404);

  await db.collection("admin-todos").doc(id).update({
    isActive: false,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return json({ success: true, todoId: id });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function listNotifications(db: Db, url: URL): Promise<Response> {
  const limit = parseLimit(url, 20, 50);
  const snap = await db.collection("notifications")
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

  const ref = await db.collection("notifications").add({
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
  const snap = await db.collection("specialist-requests")
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
  const doc = await db.collection("specialist-requests").doc(id).get();
  if (!doc.exists) return error("Request not found", 404);

  const body = await req.json() as Record<string, any>;
  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
  if ("status" in body) {
    const validStatuses = ["pending", "approved", "referred", "denied", "closed"];
    if (!validStatuses.includes(body.status)) return error(`Invalid status. Must be: ${validStatuses.join(", ")}`);
    updates.status = body.status;
  }
  if ("notes" in body) updates.notes = String(body.notes).slice(0, 2000);

  await db.collection("specialist-requests").doc(id).update(updates);
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
    switch (resource) {
      // ── Patients (NO DELETE — forbidden) ──
      case "patients":
        if (method === "GET" && !id) return await listPatients(db, url);
        if (method === "GET" && id === "stats") return await patientStats(db);
        if (method === "GET" && id) return await getPatient(db, id);
        if (method === "PATCH" && id) return await updatePatient(db, id, request);
        if (method === "DELETE") return error("Patient deletion is forbidden. Use PATCH to deactivate instead.", 403);
        break;

      // ── Appointments (cancel requires authorization) ──
      case "appointments":
        if (method === "GET" && !id) return await listAppointments(db, url);
        if (method === "GET" && id === "upcoming") return await upcomingAppointments(db);
        if (method === "GET" && id === "patient" && action) return await patientAppointments(db, action, url);
        if (method === "GET" && id) return await getAppointment(db, id);
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

      // ── Todos ──
      case "todos":
        if (method === "GET" && !id) return await listTodos(db, url);
        if (method === "POST" && !id) return await createTodo(db, request);
        if (method === "PATCH" && id) return await updateTodo(db, id, request);
        if (method === "DELETE" && id) return await deleteTodo(db, id);
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
            "GET    /admin-api/appointments/patient/:patientId",
            "GET    /admin-api/appointments/:id",
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
            "GET    /admin-api/todos[?filter=all|upcoming|overdue|completed&limit=]",
            "POST   /admin-api/todos",
            "PATCH  /admin-api/todos/:id",
            "DELETE /admin-api/todos/:id",
            "GET    /admin-api/notifications[?limit=]",
            "POST   /admin-api/notifications",
            "GET    /admin-api/specialist-requests[?limit=]",
            "PATCH  /admin-api/specialist-requests/:id",
          ],
        }, 404);
    }

    return error("Method not allowed for this endpoint", 405);
  } catch (err: any) {
    console.error(`[admin-api] ${method} ${apiPath} error:`, err.message);
    return json({ error: "Internal error" }, 500);
  }
}
