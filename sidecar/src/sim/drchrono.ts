/**
 * Sidecar-side DrChrono simulator. Mirrors the subset of DrChrono's REST
 * API the skills + admin UI actually call, reading from the shared
 * `simulation/drchrono/*` Firestore sandbox seeded by
 * `seedSimulationData` Cloud Function.
 *
 * Shape parity is the contract: the caller can't tell whether the bytes
 * came from DrChrono or Firestore.
 */
import { getDb } from "../lib/firebase.js";

const PATIENTS = "simulation/drchrono/patients";
const APPOINTMENTS = "simulation/drchrono/appointments";
const REFILLS = "simulation/drchrono/refills";
const DOCUMENTS = "simulation/drchrono/documents";
const CLINICAL_NOTES = "simulation/drchrono/clinical_notes";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/**
 * Proxy-level DrChrono simulator. Matches the route shape of
 * `/admin-api/drchrono/<path>?<qs>` — the real `proxyDrChrono` stand-in.
 * Returns the same {results: [...]} envelope DrChrono uses.
 */
export async function simDrChrono(
  method: string,
  path: string,
  searchParams: URLSearchParams,
  request?: Request,
): Promise<Response> {
  async function readJsonBody(): Promise<any | null> {
    if (!request) return null;
    try { return await request.clone().json(); } catch { return null; }
  }
  const db = getDb();

  // /drchrono/patients[?first_name=&last_name=&page_size=]
  if (method === "GET" && path === "patients") {
    const pageSize = Math.min(Number(searchParams.get("page_size") || 25), 100);
    const first = (searchParams.get("first_name") || "").toLowerCase();
    const last = (searchParams.get("last_name") || "").toLowerCase();
    const snap = await db.collection(PATIENTS).limit(500).get();
    const all = snap.docs.map((d) => d.data());
    const matched = all.filter((p: any) => {
      if (first && !(p.first_name || "").toLowerCase().startsWith(first)) return false;
      if (last && !(p.last_name || "").toLowerCase().startsWith(last)) return false;
      return true;
    });
    return json({ results: matched.slice(0, pageSize) });
  }

  // /drchrono/patients/:id
  if (method === "GET" && /^patients\/\d+$/.test(path)) {
    const id = path.split("/")[1];
    const snap = await db.doc(`${PATIENTS}/${id}`).get();
    if (!snap.exists) return json({ detail: "Not found." }, 404);
    return json(snap.data());
  }

  // /drchrono/appointments[?patient=&page_size=]
  if (method === "GET" && path === "appointments") {
    const pageSize = Math.min(Number(searchParams.get("page_size") || 50), 200);
    const patientFilter = searchParams.get("patient");
    let q: FirebaseFirestore.Query = db.collection(APPOINTMENTS);
    if (patientFilter) q = q.where("patient", "==", Number(patientFilter));
    const snap = await q.limit(pageSize).get();
    return json({ results: snap.docs.map((d) => d.data()) });
  }

  // Chart-read endpoints used by Aurelia's chart-summarization skill. The
  // sandbox doesn't seed clinical content (allergies, problems, meds, notes,
  // documents) — return empty {results:[]} so the skill reports "none on
  // file" instead of hitting the 501 fallback.
  if (method === "GET" && (
    path === "allergies" ||
    path === "problems" ||
    path === "medications" ||
    path === "clinical_notes" ||
    path === "documents" ||
    path === "vitals" ||
    path === "labs"
  )) {
    return json({ results: [] });
  }

  // /drchrono/patient-lookup — unified aggregator (sidecar-specific path,
  // mirrors the Cloud Function simulator's patient_lookup op).
  if (method === "GET" && path === "patient-lookup") {
    const q = {
      firstName: searchParams.get("firstName") || undefined,
      lastName: searchParams.get("lastName") || undefined,
      email: searchParams.get("email") || undefined,
      phone: searchParams.get("phone") || undefined,
      drchronoId: searchParams.get("drchronoId") || undefined,
    };
    return json(await lookupOne(db, q));
  }

  // /drchrono/patient-batch — run N lookups in one round-trip. Body:
  // {items:[{id, query:{firstName?,lastName?,email?,phone?,drchronoId?}}]}
  if (method === "POST" && path === "patient-batch") {
    const body = await readJsonBody();
    const items: Array<{ id: string; query: any }> = Array.isArray(body?.items) ? body.items : [];
    const results = await Promise.all(
      items.map(async (it) => ({
        id: it.id,
        query: it.query || {},
        result: await lookupOne(db, it.query || {}),
      })),
    );
    return json({ results });
  }

  // /drchrono/patient-details?drchronoId=X — returns allergies/problems/
  // appointments stub pulled from the sandbox. Shape parity with real.
  if (method === "GET" && path === "patient-details") {
    const drchronoId = searchParams.get("drchronoId");
    if (!drchronoId) return json({ detail: "drchronoId required" }, 400);
    const apptSnap = await db
      .collection(APPOINTMENTS)
      .where("patient", "==", Number(drchronoId))
      .limit(50)
      .get();
    return json({
      allergies: [],
      problems: [],
      appointments: apptSnap.docs.map((d) => {
        const a: any = d.data();
        return {
          id: Number(a.id),
          date: a.scheduled_time || null,
          reason: a.reason || null,
          status: a.status || null,
          duration: typeof a.duration === "number" ? a.duration : null,
          notesLocked: false,
        };
      }),
    });
  }

  // ── Write-side ops ───────────────────────────────────────────────

  // PATCH patients/:id — partial update to demographics/contact.
  if (method === "PATCH" && /^patients\/\d+$/.test(path)) {
    const id = path.split("/")[1];
    const ref = db.doc(`${PATIENTS}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) return json({ detail: "Not found." }, 404);
    const body = await readJsonBody();
    if (!body) return json({ detail: "Invalid body" }, 400);
    const allowed = [
      "first_name", "last_name", "email", "cell_phone",
      "date_of_birth", "gender", "is_active",
    ];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) updates[k] = body[k];
    await ref.update(updates);
    return json({ ...snap.data(), ...updates });
  }

  // POST patients — create a new record. Assigns id = 9000 + count.
  if (method === "POST" && path === "patients") {
    const body = await readJsonBody();
    if (!body) return json({ detail: "Invalid body" }, 400);
    const existing = await db.collection(PATIENTS).count().get();
    const id = 9000 + existing.data().count + 1;
    const doc = {
      id,
      first_name: body.first_name || "",
      last_name: body.last_name || "",
      email: body.email || null,
      cell_phone: body.cell_phone || null,
      date_of_birth: body.date_of_birth || null,
      gender: body.gender || null,
      is_active: true,
    };
    await db.doc(`${PATIENTS}/${id}`).set(doc);
    return json(doc, 201);
  }

  // POST appointments — create appointment.
  if (method === "POST" && path === "appointments") {
    const body = await readJsonBody();
    if (!body || !body.patient) return json({ detail: "patient required" }, 400);
    const count = await db.collection(APPOINTMENTS).count().get();
    const id = 7000 + count.data().count + 1;
    const doc = {
      id,
      patient: Number(body.patient),
      scheduled_time: body.scheduled_time || new Date().toISOString(),
      duration: body.duration ?? 15,
      status: body.status || "scheduled",
      reason: body.reason || null,
      exam_room: body.exam_room ?? null,
    };
    await db.doc(`${APPOINTMENTS}/${id}`).set(doc);
    return json(doc, 201);
  }

  // PATCH appointments/:id
  if (method === "PATCH" && /^appointments\/\d+$/.test(path)) {
    const id = path.split("/")[1];
    const ref = db.doc(`${APPOINTMENTS}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) return json({ detail: "Not found." }, 404);
    const body = await readJsonBody();
    if (!body) return json({ detail: "Invalid body" }, 400);
    const allowed = ["scheduled_time", "duration", "status", "reason", "exam_room"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) updates[k] = body[k];
    await ref.update(updates);
    return json({ ...snap.data(), ...updates });
  }

  // POST documents — attach a document to a patient's chart (fax → chart
  // flow uses this). Returns {id} so the caller can reference it later.
  if (method === "POST" && path === "documents") {
    const body = await readJsonBody();
    if (!body || !body.patient) return json({ detail: "patient required" }, 400);
    const count = await db.collection(DOCUMENTS).count().get();
    const id = 8000 + count.data().count + 1;
    const doc = {
      id,
      patient: Number(body.patient),
      description: body.description || null,
      document_date: body.document_date || new Date().toISOString().slice(0, 10),
      document_type: body.document_type || "other",
      uploaded_at: new Date().toISOString(),
    };
    await db.doc(`${DOCUMENTS}/${id}`).set(doc);
    return json(doc, 201);
  }

  // POST clinical_notes — agent-written SOAP note.
  if (method === "POST" && path === "clinical_notes") {
    const body = await readJsonBody();
    if (!body || !body.patient) return json({ detail: "patient required" }, 400);
    const count = await db.collection(CLINICAL_NOTES).count().get();
    const id = 6000 + count.data().count + 1;
    const doc = {
      id,
      patient: Number(body.patient),
      appointment: body.appointment ?? null,
      note_body: body.note_body || "",
      locked: false,
      created_at: new Date().toISOString(),
    };
    await db.doc(`${CLINICAL_NOTES}/${id}`).set(doc);
    return json(doc, 201);
  }

  // PATCH clinical_notes/:id — amend or lock.
  if (method === "PATCH" && /^clinical_notes\/\d+$/.test(path)) {
    const id = path.split("/")[1];
    const ref = db.doc(`${CLINICAL_NOTES}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) return json({ detail: "Not found." }, 404);
    const body = await readJsonBody();
    if (!body) return json({ detail: "Invalid body" }, 400);
    const allowed = ["note_body", "locked"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) updates[k] = body[k];
    await ref.update(updates);
    return json({ ...snap.data(), ...updates });
  }

  // Fallback — unknown DrChrono path in sim mode.
  return json(
    { error: `Simulated DrChrono does not implement: ${method} ${path}` },
    501,
  );
}


async function lookupOne(
  db: FirebaseFirestore.Firestore,
  q: { firstName?: string; lastName?: string; email?: string; phone?: string; drchronoId?: string },
) {
  if (q.drchronoId) {
    const snap = await db.doc(`${PATIENTS}/${q.drchronoId}`).get();
    if (!snap.exists) {
      return {
        status: "no-match",
        matched: false,
        candidatesCount: 0,
        exactMatchesCount: 0,
        patient: null,
        candidates: [],
        errorMessage: null,
      };
    }
    const p = toUnified(snap.data());
    return {
      status: "matched",
      matched: true,
      candidatesCount: 1,
      exactMatchesCount: 1,
      patient: p,
      candidates: [p],
      errorMessage: null,
    };
  }

  const snap = await db.collection(PATIENTS).limit(500).get();
  const all = snap.docs.map((d) => d.data());
  const first = q.firstName?.toLowerCase();
  const last = q.lastName?.toLowerCase();
  const emailLc = q.email?.toLowerCase();
  const phoneDigits = q.phone?.replace(/\D/g, "");
  const matches = all.filter((p: any) => {
    if (emailLc && (p.email || "").toLowerCase() !== emailLc) return false;
    if (phoneDigits && (p.cell_phone || "").replace(/\D/g, "") !== phoneDigits) return false;
    if (first && !(p.first_name || "").toLowerCase().startsWith(first)) return false;
    if (last && !(p.last_name || "").toLowerCase().startsWith(last)) return false;
    return true;
  });
  const candidates = matches.map(toUnified);
  if (candidates.length === 0) {
    return {
      status: "no-match",
      matched: false,
      candidatesCount: 0,
      exactMatchesCount: 0,
      patient: null,
      candidates: [],
      errorMessage: null,
    };
  }
  if (candidates.length === 1) {
    return {
      status: "matched",
      matched: true,
      candidatesCount: 1,
      exactMatchesCount: 1,
      patient: candidates[0],
      candidates,
      errorMessage: null,
    };
  }
  return {
    status: "skipped-multi",
    matched: false,
    candidatesCount: candidates.length,
    exactMatchesCount: 0,
    patient: null,
    candidates,
    errorMessage: null,
  };
}

function toUnified(p: any) {
  return {
    drchronoId: p.id,
    firstName: p.first_name || "",
    lastName: p.last_name || "",
    middleName: null,
    dateOfBirth: p.date_of_birth || null,
    gender: p.gender || null,
    patientStatus: p.is_active ? "active" : "inactive",
    email: p.email || null,
    cellPhone: p.cell_phone || null,
    homePhone: null,
    officePhone: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    insurance: { carrier: null, policyNumber: null, groupNumber: null, planName: null },
  };
}
