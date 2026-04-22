/**
 * Greenway Health simulator. Reads from the shared
 * `simulation/drchrono/patients` pool, transformed into Greenway's
 * Intergy-style patient shape.
 */
import { getDb } from "../lib/firebase.js";

const PATIENTS = "simulation/drchrono/patients";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function toGreenway(p: any) {
  return {
    PatientId: p.id,
    FirstName: p.first_name || "",
    LastName: p.last_name || "",
    DateOfBirth: p.date_of_birth || null,
    Gender: (p.gender || "unknown").toLowerCase() === "female" ? "F" : "M",
    Email: p.email || null,
    HomePhone: null,
    CellPhone: p.cell_phone || null,
    Status: p.is_active === false ? "Inactive" : "Active",
  };
}

export async function simGreenway(
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
      Patients: matched.slice(0, limit).map(toGreenway),
      TotalCount: matched.length,
    });
  }

  if (method === "GET" && /^patients\/\d+$/.test(path)) {
    const id = path.split("/")[1];
    const snap = await db.doc(`${PATIENTS}/${id}`).get();
    if (!snap.exists) return json({ error: "Patient not found" }, 404);
    return json(toGreenway(snap.data()));
  }

  return json(
    { error: `Simulated Greenway does not implement: ${method} ${path}` },
    501,
  );
}
