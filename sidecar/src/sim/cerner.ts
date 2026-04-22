/**
 * Cerner / Oracle Health simulator. FHIR R4 over the shared
 * `simulation/drchrono/patients` pool.
 */
import { getDb } from "../lib/firebase.js";

const PATIENTS = "simulation/drchrono/patients";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function toFhirPatient(p: any) {
  return {
    resourceType: "Patient",
    id: String(p.id),
    active: p.is_active !== false,
    name: [{use: "official", family: p.last_name || "", given: [p.first_name || ""]}],
    telecom: [
      ...(p.email ? [{system: "email", value: p.email, use: "home"}] : []),
      ...(p.cell_phone ? [{system: "phone", value: p.cell_phone, use: "mobile"}] : []),
    ],
    gender: (p.gender || "unknown").toLowerCase(),
    birthDate: p.date_of_birth || undefined,
  };
}

function bundle(entries: any[]) {
  return {resourceType: "Bundle", type: "searchset", total: entries.length, entry: entries.map((r) => ({resource: r}))};
}

export async function simCerner(
  method: string,
  path: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  const db = getDb();

  if (method === "GET" && path === "Patient") {
    const limit = Math.min(Number(searchParams.get("_count") || 25), 100);
    const family = (searchParams.get("family") || "").toLowerCase();
    const given = (searchParams.get("given") || "").toLowerCase();
    const snap = await db.collection(PATIENTS).limit(500).get();
    const all = snap.docs.map((d) => d.data() as any);
    const matched = all.filter((p) => {
      if (family && !(p.last_name || "").toLowerCase().startsWith(family)) return false;
      if (given && !(p.first_name || "").toLowerCase().startsWith(given)) return false;
      return true;
    });
    return json(bundle(matched.slice(0, limit).map(toFhirPatient)));
  }

  if (method === "GET" && /^Patient\/\d+$/.test(path)) {
    const id = path.split("/")[1];
    const snap = await db.doc(`${PATIENTS}/${id}`).get();
    if (!snap.exists) {
      return json(
        {resourceType: "OperationOutcome", issue: [{severity: "error", code: "not-found"}]},
        404,
      );
    }
    return json(toFhirPatient(snap.data()));
  }

  return json(
    {resourceType: "OperationOutcome", issue: [{severity: "error", code: "not-supported", diagnostics: `Simulated Cerner does not implement: ${method} ${path}`}]},
    501,
  );
}
