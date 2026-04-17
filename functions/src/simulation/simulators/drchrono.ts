/**
 * DrChrono simulator — reads from the seeded Firestore mirror at
 * `simulation/drchrono/patients/*`. Shape matches the real DrChrono API so
 * the client can't tell the difference.
 *
 * Writes persist to the same mirror; a scheduled reset (or manual re-seed)
 * restores the baseline.
 */
import {SimContext} from "../index.js";

const PATIENTS = "simulation/drchrono/patients";
const APPOINTMENTS = "simulation/drchrono/appointments";
const REFILLS = "simulation/drchrono/refills";

interface DrChronoPatient {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  cell_phone?: string;
  date_of_birth?: string;
  gender?: string;
  is_active?: boolean;
}

interface DrChronoAppointment {
  id: number;
  patient: number;
  scheduled_time: string;
  duration: number;
  status: string;
  reason?: string;
  exam_room?: number;
}

interface DrChronoRefill {
  id: number;
  patient: number;
  medication: string;
  status: "pending" | "approved" | "denied";
  requested_at: string;
}

export async function list_patients(
  ctx: SimContext,
  params: {first_name?: string; last_name?: string; page_size?: number},
): Promise<{results: DrChronoPatient[]}> {
  const pageSize = Math.min(params.page_size ?? 25, 100);
  const snap = await ctx.db.collection(PATIENTS).limit(500).get();
  const all = snap.docs.map((d) => d.data() as DrChronoPatient);

  const first = params.first_name?.toLowerCase();
  const last = params.last_name?.toLowerCase();
  const matched = all.filter((p) => {
    if (first && !(p.first_name || "").toLowerCase().startsWith(first)) return false;
    if (last && !(p.last_name || "").toLowerCase().startsWith(last)) return false;
    return true;
  });
  return {results: matched.slice(0, pageSize)};
}

export async function get_patient(
  ctx: SimContext,
  params: {id: string | number},
): Promise<DrChronoPatient> {
  if (params.id == null) throw new Error("id required");
  const snap = await ctx.db.doc(`${PATIENTS}/${params.id}`).get();
  if (!snap.exists) throw new Error(`Patient ${params.id} not found`);
  return snap.data() as DrChronoPatient;
}

export async function list_appointments(
  ctx: SimContext,
  params: {patient?: number; page_size?: number},
): Promise<{results: DrChronoAppointment[]}> {
  const pageSize = Math.min(params.page_size ?? 50, 200);
  let q: FirebaseFirestore.Query = ctx.db.collection(APPOINTMENTS);
  if (params.patient != null) q = q.where("patient", "==", Number(params.patient));
  const snap = await q.limit(pageSize).get();
  return {results: snap.docs.map((d) => d.data() as DrChronoAppointment)};
}

export async function list_refills(
  ctx: SimContext,
  params: {patient?: number; status?: DrChronoRefill["status"]; page_size?: number},
): Promise<{results: DrChronoRefill[]}> {
  const pageSize = Math.min(params.page_size ?? 50, 200);
  let q: FirebaseFirestore.Query = ctx.db.collection(REFILLS);
  if (params.patient != null) q = q.where("patient", "==", Number(params.patient));
  if (params.status) q = q.where("status", "==", params.status);
  const snap = await q.limit(pageSize).get();
  return {results: snap.docs.map((d) => d.data() as DrChronoRefill)};
}
