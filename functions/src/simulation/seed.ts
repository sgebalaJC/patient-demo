/**
 * One-shot seeder for the simulation Firestore mirror. Idempotent: running it
 * again wipes and rewrites. Admin-only.
 *
 * Uses deterministic pseudo-random so the same seed always produces the same
 * records — avoids re-seeding "drift" between demo sessions.
 */
import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {isSuperAdminEmail} from "../superAdmins.js";

function assertSuperAdmin(auth: {uid: string; token?: {email?: string}} | undefined) {
  if (!auth) throw new HttpsError("unauthenticated", "Sign-in required");
  if (!isSuperAdminEmail(auth.token?.email)) {
    throw new HttpsError("permission-denied", "Super-admin only");
  }
}

const SEED = 20260416;
const RECORD_COUNT = 50;

function rand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

const FIRST_NAMES = ["Alice", "Ben", "Carla", "Diego", "Emma", "Faisal", "Grace", "Hiro", "Ivy", "Jamal"];
const LAST_NAMES = ["Rivera", "Chen", "Okafor", "Patel", "Nguyen", "Silva", "Kim", "Garcia", "Hassan", "Müller"];

async function wipeCollection(db: admin.firestore.Firestore, path: string) {
  const snap = await db.collection(path).limit(500).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

async function seedDrChronoPatients(db: admin.firestore.Firestore): Promise<number[]> {
  const path = "simulation/drchrono/patients";
  await wipeCollection(db, path);
  const r = rand(SEED);
  const batch = db.batch();
  const ids: number[] = [];
  for (let i = 1; i <= RECORD_COUNT; i++) {
    const first = FIRST_NAMES[Math.floor(r() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(r() * LAST_NAMES.length)];
    const id = 1000 + i;
    ids.push(id);
    batch.set(db.doc(`${path}/${id}`), {
      id,
      first_name: first,
      last_name: last,
      email: `${first}.${last}${i}@example.com`.toLowerCase(),
      cell_phone: `+1555${String(1000000 + i).padStart(7, "0")}`,
      date_of_birth: `19${50 + Math.floor(r() * 50)}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`,
      gender: r() < 0.5 ? "female" : "male",
      is_active: true,
    });
  }
  await batch.commit();
  return ids;
}

const REASONS = ["Annual physical", "Follow-up", "Consultation", "Telehealth visit", "Lab review"];
const STATUSES = ["scheduled", "confirmed", "complete", "cancelled"];

async function seedDrChronoAppointments(
  db: admin.firestore.Firestore,
  patientIds: number[],
): Promise<number> {
  const path = "simulation/drchrono/appointments";
  await wipeCollection(db, path);
  const r = rand(SEED + 1);
  const batch = db.batch();
  const count = RECORD_COUNT;
  const now = Date.now();
  for (let i = 1; i <= count; i++) {
    const id = 5000 + i;
    const patient = patientIds[Math.floor(r() * patientIds.length)];
    const offsetDays = Math.floor(r() * 60) - 30;
    batch.set(db.doc(`${path}/${id}`), {
      id,
      patient,
      scheduled_time: new Date(now + offsetDays * 86400_000).toISOString(),
      duration: 15 + 15 * Math.floor(r() * 4),
      status: STATUSES[Math.floor(r() * STATUSES.length)],
      reason: REASONS[Math.floor(r() * REASONS.length)],
      exam_room: 1 + Math.floor(r() * 4),
    });
  }
  await batch.commit();
  return count;
}

const MEDS = ["Lisinopril 10mg", "Metformin 500mg", "Atorvastatin 20mg", "Sertraline 50mg", "Albuterol HFA"];
const REFILL_STATUSES = ["pending", "approved", "denied"] as const;

async function seedDrChronoRefills(
  db: admin.firestore.Firestore,
  patientIds: number[],
): Promise<number> {
  const path = "simulation/drchrono/refills";
  await wipeCollection(db, path);
  const r = rand(SEED + 2);
  const batch = db.batch();
  const count = RECORD_COUNT;
  const now = Date.now();
  for (let i = 1; i <= count; i++) {
    const id = 9000 + i;
    const patient = patientIds[Math.floor(r() * patientIds.length)];
    batch.set(db.doc(`${path}/${id}`), {
      id,
      patient,
      medication: MEDS[Math.floor(r() * MEDS.length)],
      status: REFILL_STATUSES[Math.floor(r() * REFILL_STATUSES.length)],
      requested_at: new Date(now - Math.floor(r() * 30) * 86400_000).toISOString(),
    });
  }
  await batch.commit();
  return count;
}

export const seedSimulationData = onCall({timeoutSeconds: 120}, async (req) => {
  assertSuperAdmin(req.auth);
  const db = admin.firestore();
  const patientIds = await seedDrChronoPatients(db);
  const appointments = await seedDrChronoAppointments(db, patientIds);
  const refills = await seedDrChronoRefills(db, patientIds);
  return {
    ok: true,
    seeded: {
      drchrono_patients: patientIds.length,
      drchrono_appointments: appointments,
      drchrono_refills: refills,
    },
  };
});

export const clearSimulationData = onCall({timeoutSeconds: 120}, async (req) => {
  assertSuperAdmin(req.auth);
  const db = admin.firestore();
  const paths = [
    "simulation/drchrono/patients",
    "simulation/drchrono/appointments",
    "simulation/drchrono/refills",
  ];
  const cleared: Record<string, number> = {};
  for (const p of paths) {
    let total = 0;
    for (;;) {
      const snap = await db.collection(p).limit(500).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      total += snap.size;
      if (snap.size < 500) break;
    }
    cleared[p.replace("simulation/", "").replace("/", "_")] = total;
  }
  return {ok: true, cleared};
});
