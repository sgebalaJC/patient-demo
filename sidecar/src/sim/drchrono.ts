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
): Promise<Response> {
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

  // /drchrono/patient-lookup — unified aggregator (sidecar-specific path,
  // mirrors the Cloud Function simulator's patient_lookup op).
  if (method === "GET" && path === "patient-lookup") {
    const firstName = searchParams.get("firstName") || undefined;
    const lastName = searchParams.get("lastName") || undefined;
    const email = searchParams.get("email") || undefined;
    const phone = searchParams.get("phone") || undefined;
    const drchronoId = searchParams.get("drchronoId") || undefined;

    if (drchronoId) {
      const snap = await db.doc(`${PATIENTS}/${drchronoId}`).get();
      if (!snap.exists) {
        return json({
          status: "no-match",
          matched: false,
          candidatesCount: 0,
          exactMatchesCount: 0,
          patient: null,
          candidates: [],
          errorMessage: null,
        });
      }
      const p = toUnified(snap.data());
      return json({
        status: "matched",
        matched: true,
        candidatesCount: 1,
        exactMatchesCount: 1,
        patient: p,
        candidates: [p],
        errorMessage: null,
      });
    }

    const snap = await db.collection(PATIENTS).limit(500).get();
    const all = snap.docs.map((d) => d.data());
    const first = firstName?.toLowerCase();
    const last = lastName?.toLowerCase();
    const emailLc = email?.toLowerCase();
    const phoneDigits = phone?.replace(/\D/g, "");
    const matches = all.filter((p: any) => {
      if (emailLc && (p.email || "").toLowerCase() !== emailLc) return false;
      if (phoneDigits && (p.cell_phone || "").replace(/\D/g, "") !== phoneDigits) return false;
      if (first && !(p.first_name || "").toLowerCase().startsWith(first)) return false;
      if (last && !(p.last_name || "").toLowerCase().startsWith(last)) return false;
      return true;
    });
    const candidates = matches.map(toUnified);
    if (candidates.length === 0) {
      return json({
        status: "no-match",
        matched: false,
        candidatesCount: 0,
        exactMatchesCount: 0,
        patient: null,
        candidates: [],
        errorMessage: null,
      });
    }
    if (candidates.length === 1) {
      return json({
        status: "matched",
        matched: true,
        candidatesCount: 1,
        exactMatchesCount: 1,
        patient: candidates[0],
        candidates,
        errorMessage: null,
      });
    }
    return json({
      status: "skipped-multi",
      matched: false,
      candidatesCount: candidates.length,
      exactMatchesCount: 0,
      patient: null,
      candidates,
      errorMessage: null,
    });
  }

  // Fallback — unknown DrChrono path in sim mode.
  return json(
    { error: `Simulated DrChrono does not implement: ${method} ${path}` },
    501,
  );
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
