/**
 * Seeds the `simulation/native/*` subcollections the admin pages read when
 * `system/settings.simulationMode` is on. Every record references the same
 * pool of demo patient UIDs so Appointments / Refills / Specialist Requests /
 * Intake Forms / Prior Auth all align with the Users list.
 *
 * Deterministic: same SEED → same dataset. Idempotent: wipes its own
 * collections before writing.
 */
import * as admin from "firebase-admin";

type TS = admin.firestore.Timestamp;

const SEED = 20260422;

const PATIENT_COUNT = 20;
const APPT_COUNT = 30;
const REFILL_COUNT = 25;
const SPECIALIST_COUNT = 12;
const INTAKE_COUNT = 10;
const PA_COUNT = 8;

const FIRST_NAMES = [
  "Alice", "Ben", "Carla", "Diego", "Emma", "Faisal", "Grace", "Hiro",
  "Ivy", "Jamal", "Kira", "Leo", "Maya", "Noah", "Olivia", "Priya",
  "Quinn", "Rafael", "Sana", "Theo",
];
const LAST_NAMES = [
  "Rivera", "Chen", "Okafor", "Patel", "Nguyen", "Silva", "Kim", "Garcia",
  "Hassan", "Müller", "Johnson", "Brown", "Davis", "Wilson", "Martinez",
  "Anderson", "Thomas", "Taylor", "Moore", "Jackson",
];

const REASONS = ["Annual physical", "Follow-up", "Consultation", "Telehealth visit", "Lab review"];
const APPT_TYPES = ["consultation", "follow-up", "physical", "urgent"] as const;
const APPT_STATUSES = ["scheduled", "confirmed", "completed", "cancelled", "no-show"] as const;

const MEDS = [
  {name: "Lisinopril", dosage: "10mg", qty: "30"},
  {name: "Metformin", dosage: "500mg", qty: "60"},
  {name: "Atorvastatin", dosage: "20mg", qty: "30"},
  {name: "Sertraline", dosage: "50mg", qty: "30"},
  {name: "Albuterol HFA", dosage: "90mcg/actuation", qty: "1 inhaler"},
  {name: "Amlodipine", dosage: "5mg", qty: "30"},
  {name: "Omeprazole", dosage: "20mg", qty: "30"},
];
const REFILL_STATUSES = ["pending", "approved", "denied", "completed", "cancelled"] as const;
const URGENCIES = ["routine", "urgent", "emergency"] as const;

const SPECIALIST_TYPES = [
  "Cardiology", "Dermatology", "Endocrinology", "Gastroenterology",
  "Neurology", "Orthopedics", "Psychiatry", "Pulmonology",
];
const SPECIALIST_REASONS = [
  "Chronic symptoms — needs evaluation",
  "PCP referral for specialist workup",
  "Follow-up on imaging results",
  "Second opinion requested",
];
const SPECIALIST_STATUSES = ["pending", "confirmed", "cancelled"] as const;

const INTAKE_STATUSES = ["draft", "in_progress", "completed", "approved", "rejected"] as const;
const INTAKE_SECTIONS = [
  "patientInfo", "medicalHistory", "familyHistory", "consentForm",
];

const PAYERS = [
  {id: "aetna", name: "Aetna"},
  {id: "bcbs-ca", name: "Blue Cross Blue Shield of California"},
  {id: "uhc", name: "UnitedHealthcare"},
  {id: "cigna", name: "Cigna"},
  {id: "humana", name: "Humana"},
];
const CPTS = [
  {code: "70553", label: "MRI brain with and without contrast"},
  {code: "27447", label: "Total knee arthroplasty"},
  {code: "45378", label: "Colonoscopy, diagnostic"},
  {code: "93306", label: "Echocardiography, complete"},
  {code: "72148", label: "MRI lumbar spine without contrast"},
];
const PA_STATUSES = ["draft", "submitted", "pending", "needs_info", "peer_to_peer", "approved", "denied"] as const;

function rand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

function ts(daysOffset: number): TS {
  return admin.firestore.Timestamp.fromMillis(
    Date.now() + daysOffset * 86400_000,
  );
}

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)];
}

async function wipe(db: admin.firestore.Firestore, path: string): Promise<void> {
  for (;;) {
    const snap = await db.collection(path).limit(500).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 500) return;
  }
}

export interface DemoPatient {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  dob: string; // YYYY-MM-DD
}

async function seedUsers(
  db: admin.firestore.Firestore,
): Promise<DemoPatient[]> {
  const path = "simulation/native/users";
  await wipe(db, path);
  const r = rand(SEED);
  const patients: DemoPatient[] = [];
  const batch = db.batch();

  // Demo admin
  batch.set(db.doc(`${path}/demo-admin-001`), {
    id: "demo-admin-001",
    email: "admin@demo.local",
    firstName: "Dana",
    lastName: "Admin",
    role: "admin",
    phoneNumber: "+15550000001",
    isActive: true,
    phoneVerified: true,
    emailVerified: true,
    createdAt: ts(-60),
    updatedAt: ts(-1),
  });

  for (let i = 0; i < PATIENT_COUNT; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 3) % LAST_NAMES.length];
    const uid = `demo-patient-${String(i + 1).padStart(3, "0")}`;
    const year = 1950 + Math.floor(r() * 50);
    const month = 1 + Math.floor(r() * 12);
    const day = 1 + Math.floor(r() * 28);
    const dob = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const phone = `+1555${String(1000000 + i * 37).padStart(7, "0")}`;
    const email = `${first}.${last}${i + 1}@demo.local`.toLowerCase();
    const createdOffset = -Math.floor(r() * 180) - 1;
    patients.push({uid, firstName: first, lastName: last, email, phoneNumber: phone, dob});
    batch.set(db.doc(`${path}/${uid}`), {
      id: uid,
      email,
      firstName: first,
      lastName: last,
      role: "patient",
      phoneNumber: phone,
      dateOfBirth: admin.firestore.Timestamp.fromDate(new Date(dob)),
      gender: r() < 0.5 ? "female" : "male",
      isActive: r() < 0.9,
      phoneVerified: r() < 0.7,
      emailVerified: true,
      allergies: [],
      medicalHistory: [],
      assignedDoctors: [],
      createdAt: ts(createdOffset),
      updatedAt: ts(createdOffset + Math.floor(r() * 30)),
    });
  }

  await batch.commit();
  return patients;
}

async function seedAppointments(
  db: admin.firestore.Firestore,
  patients: DemoPatient[],
): Promise<number> {
  const path = "simulation/native/appointments";
  await wipe(db, path);
  const r = rand(SEED + 1);
  const batch = db.batch();
  for (let i = 0; i < APPT_COUNT; i++) {
    const p = patients[Math.floor(r() * patients.length)];
    const offsetDays = Math.floor(r() * 28) - 14;
    const apptTs = ts(offsetDays);
    const status = pick(r, APPT_STATUSES);
    const id = `appt-${String(i + 1).padStart(3, "0")}`;
    batch.set(db.doc(`${path}/${id}`), {
      id,
      patientId: p.uid,
      patientName: `${p.firstName} ${p.lastName}`,
      appointmentDate: apptTs,
      duration: 15 + 15 * Math.floor(r() * 4),
      appointmentType: pick(r, APPT_TYPES),
      reason: pick(r, REASONS),
      status,
      reminderSent: status !== "scheduled",
      createdAt: ts(offsetDays - Math.floor(r() * 14)),
      updatedAt: ts(offsetDays - Math.floor(r() * 3)),
    });
  }
  await batch.commit();
  return APPT_COUNT;
}

async function seedRefills(
  db: admin.firestore.Firestore,
  patients: DemoPatient[],
): Promise<number> {
  const path = "simulation/native/prescription-refills";
  await wipe(db, path);
  const r = rand(SEED + 2);
  const batch = db.batch();
  for (let i = 0; i < REFILL_COUNT; i++) {
    const p = patients[Math.floor(r() * patients.length)];
    const med = MEDS[Math.floor(r() * MEDS.length)];
    const offsetDays = -Math.floor(r() * 30) - 1;
    const id = `refill-${String(i + 1).padStart(3, "0")}`;
    batch.set(db.doc(`${path}/${id}`), {
      id,
      patientId: p.uid,
      medicationName: med.name,
      dosage: med.dosage,
      quantity: med.qty,
      pharmacyName: pick(r, ["CVS Pharmacy", "Walgreens", "Rite Aid", "Costco Pharmacy"]),
      pharmacyAddress: "123 Demo St, Sampleville, CA 90000",
      requestedDate: ts(offsetDays),
      urgency: pick(r, URGENCIES),
      status: pick(r, REFILL_STATUSES),
      createdAt: ts(offsetDays),
      updatedAt: ts(offsetDays + Math.floor(r() * 5)),
    });
  }
  await batch.commit();
  return REFILL_COUNT;
}

async function seedSpecialistRequests(
  db: admin.firestore.Firestore,
  patients: DemoPatient[],
): Promise<number> {
  const path = "simulation/native/specialist-requests";
  await wipe(db, path);
  const r = rand(SEED + 3);
  const batch = db.batch();
  for (let i = 0; i < SPECIALIST_COUNT; i++) {
    const p = patients[Math.floor(r() * patients.length)];
    const offsetDays = -Math.floor(r() * 20) - 1;
    const id = `specreq-${String(i + 1).padStart(3, "0")}`;
    const status = pick(r, SPECIALIST_STATUSES);
    batch.set(db.doc(`${path}/${id}`), {
      id,
      patientId: p.uid,
      specialistType: pick(r, SPECIALIST_TYPES),
      reason: pick(r, SPECIALIST_REASONS),
      status,
      ...(status === "confirmed" ? {
        confirmedAt: ts(offsetDays + 2),
        confirmedBy: "demo-admin-001",
      } : {}),
      createdAt: ts(offsetDays),
      updatedAt: ts(offsetDays + Math.floor(r() * 3)),
    });
  }
  await batch.commit();
  return SPECIALIST_COUNT;
}

async function seedIntakeForms(
  db: admin.firestore.Firestore,
  patients: DemoPatient[],
): Promise<number> {
  const path = "simulation/native/patient-intake-forms";
  await wipe(db, path);
  const r = rand(SEED + 4);
  const batch = db.batch();
  for (let i = 0; i < INTAKE_COUNT; i++) {
    const p = patients[i % patients.length];
    const status = pick(r, INTAKE_STATUSES);
    const createdOffset = -Math.floor(r() * 45) - 1;
    const completedCount = Math.min(
      INTAKE_SECTIONS.length,
      Math.floor(r() * (INTAKE_SECTIONS.length + 1)),
    );
    const completedSections = INTAKE_SECTIONS.slice(0, completedCount);
    const id = `intake-${String(i + 1).padStart(3, "0")}`;
    batch.set(db.doc(`${path}/${id}`), {
      id,
      patientId: p.uid,
      status,
      completedSections,
      currentSection: INTAKE_SECTIONS[Math.min(completedCount, INTAKE_SECTIONS.length - 1)],
      patientInfo: {
        fullName: `${p.firstName} ${p.lastName}`,
        dateOfBirth: p.dob,
        phoneNumber: p.phoneNumber,
        gender: r() < 0.5 ? "female" : "male",
        emailAddress: p.email,
        address: "123 Demo St, Sampleville, CA 90000",
        emergencyContactName: "Jordan Demo",
        emergencyContactRelationship: "Sibling",
        emergencyContactPhone: "+15550001234",
      },
      createdAt: ts(createdOffset),
      updatedAt: ts(createdOffset + Math.floor(r() * 10)),
      ...(status === "completed" || status === "approved" ? {
        completedAt: ts(createdOffset + 5),
      } : {}),
      ...(status === "approved" ? {
        approvedAt: ts(createdOffset + 7),
        reviewedBy: "demo-admin-001",
      } : {}),
    });
  }
  await batch.commit();
  return INTAKE_COUNT;
}

async function seedPriorAuths(
  db: admin.firestore.Firestore,
  patients: DemoPatient[],
): Promise<number> {
  const path = "simulation/native/prior-auths";
  await wipe(db, path);
  const r = rand(SEED + 5);
  const batch = db.batch();
  for (let i = 0; i < PA_COUNT; i++) {
    const p = patients[Math.floor(r() * patients.length)];
    const payer = PAYERS[Math.floor(r() * PAYERS.length)];
    const cpt = CPTS[Math.floor(r() * CPTS.length)];
    const status = pick(r, PA_STATUSES);
    const createdOffset = -Math.floor(r() * 21) - 1;
    const id = `pa-${String(i + 1).padStart(3, "0")}`;
    batch.set(db.doc(`${path}/${id}`), {
      id,
      patientId: p.uid,
      patientName: `${p.firstName} ${p.lastName}`,
      patientDob: p.dob,
      payerId: payer.id,
      payerName: payer.name,
      memberNumber: `M${String(100000 + i * 7).padStart(6, "0")}`,
      cptCode: cpt.code,
      procedureLabel: cpt.label,
      icd10Codes: [pick(r, ["M17.11", "G44.1", "E11.9", "I10", "K21.9"])],
      status,
      criteriaChecklist: [],
      attachedDocuments: [],
      notes: [],
      needsFollowup: r() < 0.3,
      createdBy: "demo-admin-001",
      createdAt: ts(createdOffset),
      updatedAt: ts(createdOffset + Math.floor(r() * 5)),
      ...(status === "submitted" || status === "pending" || status === "approved" || status === "denied" ? {
        submittedAt: ts(createdOffset + 1),
        referenceNumber: `REF-${String(1000 + i).padStart(5, "0")}`,
      } : {}),
      ...(status === "approved" ? {
        approvedAt: ts(createdOffset + 3),
        authNumber: `AUTH-${String(9000 + i).padStart(5, "0")}`,
      } : {}),
      ...(status === "denied" ? {
        deniedAt: ts(createdOffset + 3),
        denialReason: "Additional clinical documentation required",
      } : {}),
    });
  }
  await batch.commit();
  return PA_COUNT;
}

// Tiny stub PDF (single empty page) — embedded so seeded documents have a
// real downloadable file without requiring Storage uploads. Browsers + the
// PatientDocumentManagement preview render it as a blank page; that's enough
// to demonstrate the "open patient document" flow.
const STUB_PDF_DATA_URL =
  "data:application/pdf;base64," +
  "JVBERi0xLjQKJeLjz9MKMyAwIG9iago8PC9UeXBlIC9QYWdlIC9QYXJlbnQgMSAwIFIgL1Jlc291cmNlcyA8PD4+IC9NZWRpYUJveCBbMCAwIDYxMiA3OTJdIC9Db250ZW50cyBbXSA+PgplbmRvYmoKMSAwIG9iago8PC9UeXBlIC9QYWdlcyAvS2lkcyBbMyAwIFJdIC9Db3VudCAxPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMSAwIFI+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMTI4IDAwMDAwIG4gCjAwMDAwMDAxNzcgMDAwMDAgbiAKMDAwMDAwMDAxNSAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNCAvUm9vdCAyIDAgUj4+CnN0YXJ0eHJlZgoyMjUKJSVFT0YK";

const DOC_TEMPLATES: Array<{ type: string; fileName: string; description: string }> = [
  { type: "drivers_license",       fileName: "drivers_license.pdf",       description: "California Driver's License" },
  { type: "insurance_card_front",  fileName: "insurance_card_front.pdf",  description: "Insurance card — front" },
  { type: "insurance_card_back",   fileName: "insurance_card_back.pdf",   description: "Insurance card — back" },
  { type: "lab_results",           fileName: "lab_panel_2026.pdf",        description: "CBC + metabolic panel" },
];

async function seedPatientDocuments(
  db: admin.firestore.Firestore,
  patients: DemoPatient[],
): Promise<number> {
  const path = "simulation/native/patient-documents";
  await wipe(db, path);
  const r = rand(SEED + 6);
  const batch = db.batch();
  let count = 0;
  for (const p of patients) {
    // Most patients get the 3 ID/insurance docs; some get a lab result too.
    const templates = r() < 0.4 ? DOC_TEMPLATES : DOC_TEMPLATES.slice(0, 3);
    for (const t of templates) {
      const id = `doc-${p.uid}-${t.type}`;
      const offsetDays = -Math.floor(r() * 90) - 1;
      batch.set(db.doc(`${path}/${id}`), {
        id,
        patientId: p.uid,
        fileName: t.fileName,
        originalFileName: t.fileName,
        // Stub data URL — the preview/download flow handles it like any URL.
        // Real customer deploys upload to Storage and use a signed URL here.
        fileUrl: STUB_PDF_DATA_URL,
        fileSize: 800,
        fileType: "application/pdf",
        documentType: t.type,
        description: t.description,
        uploadedAt: ts(offsetDays),
        isActive: true,
      });
      count++;
    }
  }
  await batch.commit();
  return count;
}

export interface NativeSeedResult {
  users: number;
  appointments: number;
  refills: number;
  specialistRequests: number;
  intakeForms: number;
  priorAuths: number;
  patientDocuments: number;
  /** The seeded demo patients — shared with DrChrono/EHR sims for 1:1 alignment. */
  patients: DemoPatient[];
}

export async function seedNative(
  db: admin.firestore.Firestore,
): Promise<NativeSeedResult> {
  const patients = await seedUsers(db);
  const [appointments, refills, specialistRequests, intakeForms, priorAuths, patientDocuments] = await Promise.all([
    seedAppointments(db, patients),
    seedRefills(db, patients),
    seedSpecialistRequests(db, patients),
    seedIntakeForms(db, patients),
    seedPriorAuths(db, patients),
    seedPatientDocuments(db, patients),
  ]);
  return {
    users: patients.length + 1, // +1 admin
    appointments,
    refills,
    specialistRequests,
    intakeForms,
    priorAuths,
    patientDocuments,
    patients,
  };
}

export const NATIVE_SIM_PATHS = [
  "simulation/native/users",
  "simulation/native/appointments",
  "simulation/native/prescription-refills",
  "simulation/native/specialist-requests",
  "simulation/native/patient-intake-forms",
  "simulation/native/prior-auths",
  "simulation/native/patient-documents",
];
