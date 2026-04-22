/**
 * Practice Fusion simulator. Reads from the shared
 * `simulation/drchrono/patients` pool, transformed into Practice
 * Fusion's patient shape (camelCase + profile wrapper).
 */
import { getDb } from "../lib/firebase.js";

const PATIENTS = "simulation/drchrono/patients";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function toPfusion(p: any) {
  return {
    patientId: String(p.id),
    profile: {
      firstName: p.first_name || "",
      lastName: p.last_name || "",
      birthDate: p.date_of_birth || null,
      sex: (p.gender || "unknown").toLowerCase(),
      active: p.is_active !== false,
    },
    contact: {
      email: p.email || null,
      mobilePhone: p.cell_phone || null,
    },
  };
}

export async function simPfusion(
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
      patients: matched.slice(0, limit).map(toPfusion),
      totalCount: matched.length,
    });
  }

  if (method === "GET" && /^patients\/\d+$/.test(path)) {
    const id = path.split("/")[1];
    const snap = await db.doc(`${PATIENTS}/${id}`).get();
    if (!snap.exists) return json({ error: "Patient not found" }, 404);
    return json(toPfusion(snap.data()));
  }

  return json(
    { error: `Simulated Practice Fusion does not implement: ${method} ${path}` },
    501,
  );
}
