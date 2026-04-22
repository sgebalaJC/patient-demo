/**
 * Elation Health simulator. Reads from the shared
 * `simulation/drchrono/patients` pool and transforms it into Elation's
 * native patient shape.
 */
import { getDb } from "../lib/firebase.js";

const PATIENTS = "simulation/drchrono/patients";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function toElation(p: any) {
  return {
    id: p.id,
    first_name: p.first_name || "",
    last_name: p.last_name || "",
    dob: p.date_of_birth || null,
    sex: (p.gender || "unknown").toUpperCase().slice(0, 1) || "U",
    emails: p.email ? [{email: p.email}] : [],
    phones: p.cell_phone ? [{phone: p.cell_phone, phone_type: "Mobile"}] : [],
    primary_physician: 1,
    caregiver_practice: 1,
    deleted: p.is_active === false,
  };
}

export async function simElation(
  method: string,
  path: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  const db = getDb();

  // GET /patients[?first_name=&last_name=&limit=]
  if (method === "GET" && path === "patients") {
    const limit = Math.min(Number(searchParams.get("limit") || 25), 100);
    const first = (searchParams.get("first_name") || "").toLowerCase();
    const last = (searchParams.get("last_name") || "").toLowerCase();
    const snap = await db.collection(PATIENTS).limit(500).get();
    const all = snap.docs.map((d) => d.data() as any);
    const matched = all.filter((p) => {
      if (first && !(p.first_name || "").toLowerCase().startsWith(first)) return false;
      if (last && !(p.last_name || "").toLowerCase().startsWith(last)) return false;
      return true;
    });
    return json({
      count: matched.length,
      results: matched.slice(0, limit).map(toElation),
    });
  }

  // GET /patients/:id
  if (method === "GET" && /^patients\/\d+$/.test(path)) {
    const id = path.split("/")[1];
    const snap = await db.doc(`${PATIENTS}/${id}`).get();
    if (!snap.exists) return json({ detail: "Not found." }, 404);
    return json(toElation(snap.data()));
  }

  return json(
    { error: `Simulated Elation does not implement: ${method} ${path}` },
    501,
  );
}
