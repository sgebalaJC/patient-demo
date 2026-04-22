/**
 * Athena Health simulator. Reads from the shared `simulation/drchrono/patients`
 * pool and transforms it into athenahealth's native patient shape (no
 * underscores, practiceid context, etc.) so the same seed covers every EHR.
 */
import { getDb } from "../lib/firebase.js";

const PATIENTS = "simulation/drchrono/patients";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function toAthena(p: any) {
  return {
    patientid: String(p.id),
    firstname: p.first_name || "",
    lastname: p.last_name || "",
    email: p.email || null,
    mobilephone: (p.cell_phone || "").replace(/\D/g, "") || null,
    dob: p.date_of_birth || null,
    sex: (p.gender || "").toUpperCase().slice(0, 1) || null,
    status: p.is_active === false ? "inactive" : "active",
    practiceid: "1",
  };
}

export async function simAthena(
  method: string,
  path: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  const db = getDb();

  // GET patients[?firstname=&lastname=&limit=]
  if (method === "GET" && path === "patients") {
    const limit = Math.min(Number(searchParams.get("limit") || 25), 100);
    const first = (searchParams.get("firstname") || "").toLowerCase();
    const last = (searchParams.get("lastname") || "").toLowerCase();
    const snap = await db.collection(PATIENTS).limit(500).get();
    const all = snap.docs.map((d) => d.data() as any);
    const matched = all.filter((p) => {
      if (first && !(p.first_name || "").toLowerCase().startsWith(first)) return false;
      if (last && !(p.last_name || "").toLowerCase().startsWith(last)) return false;
      return true;
    });
    return json({
      patients: matched.slice(0, limit).map(toAthena),
      totalcount: matched.length,
    });
  }

  // GET patients/:id
  if (method === "GET" && /^patients\/\d+$/.test(path)) {
    const id = path.split("/")[1];
    const snap = await db.doc(`${PATIENTS}/${id}`).get();
    if (!snap.exists) return json({ error: "Patient not found" }, 404);
    return json(toAthena(snap.data()));
  }

  return json(
    { error: `Simulated Athena does not implement: ${method} ${path}` },
    501,
  );
}
