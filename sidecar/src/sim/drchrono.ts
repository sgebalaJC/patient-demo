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

  // Fallback — unknown DrChrono path in sim mode.
  return json(
    { error: `Simulated DrChrono does not implement: ${method} ${path}` },
    501,
  );
}
