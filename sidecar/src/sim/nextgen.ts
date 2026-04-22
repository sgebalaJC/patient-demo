/**
 * NextGen Healthcare simulator. Reads from the shared
 * `simulation/drchrono/patients` pool, transformed into NextGen's
 * FHIR-ish patient shape.
 */
import { getDb } from "../lib/firebase.js";

const PATIENTS = "simulation/drchrono/patients";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function toNextGen(p: any) {
  return {
    personId: String(p.id),
    firstName: p.first_name || "",
    lastName: p.last_name || "",
    dateOfBirth: p.date_of_birth || null,
    sex: (p.gender || "unknown").toUpperCase().charAt(0) || "U",
    email: p.email || null,
    cellPhone: p.cell_phone || null,
    active: p.is_active !== false,
  };
}

export async function simNextGen(
  method: string,
  path: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  const db = getDb();

  if (method === "GET" && path === "patients") {
    const limit = Math.min(Number(searchParams.get("limit") || 25), 100);
    const first = (searchParams.get("firstName") || "").toLowerCase();
    const last = (searchParams.get("lastName") || "").toLowerCase();
    const snap = await db.collection(PATIENTS).limit(500).get();
    const all = snap.docs.map((d) => d.data() as any);
    const matched = all.filter((p) => {
      if (first && !(p.first_name || "").toLowerCase().startsWith(first)) return false;
      if (last && !(p.last_name || "").toLowerCase().startsWith(last)) return false;
      return true;
    });
    return json({
      items: matched.slice(0, limit).map(toNextGen),
      totalCount: matched.length,
    });
  }

  if (method === "GET" && /^patients\/\d+$/.test(path)) {
    const id = path.split("/")[1];
    const snap = await db.doc(`${PATIENTS}/${id}`).get();
    if (!snap.exists) return json({ error: "Patient not found" }, 404);
    return json(toNextGen(snap.data()));
  }

  return json(
    { error: `Simulated NextGen does not implement: ${method} ${path}` },
    501,
  );
}
