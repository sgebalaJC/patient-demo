/**
 * Fax seed + PDF renderer. Runtime sim ops (list/send/inject) live on
 * the sidecar at `sidecar/src/sim/faxes.ts`; this module exists only
 * to supply the deterministic seeded rows + synthetic PDF content for
 * the admin sandbox.
 *
 * Shapes mirror the real inbound-faxes/outbound-faxes collections so
 * the UI can swap collection paths transparently.
 */
import * as admin from "firebase-admin";
import {PDFDocument, StandardFonts, rgb} from "pdf-lib";

/** Reserved US "555" range, never routable. */
export const SIM_FAX_NUMBER = "+15559990000";

const INBOUND = "simulation/faxes/inbound";
const OUTBOUND = "simulation/faxes/outbound";

type FaxStatus = "pending" | "processing" | "needs_review" | "completed" | "failed";

interface InboundFax {
  faxSid: string;
  receivedAt: admin.firestore.Timestamp;
  from: string;
  to: string;
  pageCount: number;
  pdfPath: string | null;
  status: FaxStatus;
  attempts: number;
}

interface OutboundFax {
  faxSid: string;
  from: string;
  to: string;
  subject: string | null;
  pageCount: number | null;
  fileCount: number;
  status: "queued" | "sending" | "delivered" | "failed";
  submittedBy: string;
  submittedAt: admin.firestore.Timestamp;
  completedAt: admin.firestore.Timestamp | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Synthetic PDF generator — anonymized radiology report styled to look
// like a real imaging-center fax. All names/IDs/phones/dates are fake.
// ─────────────────────────────────────────────────────────────────────────

interface FaxPdfSpec {
  header: {
    title: string;
    addressLines: string[];
    phone: string;
    tagline: string;
  };
  patient: {
    name: string;
    dob: string;
    id: string;
    age: number;
    sex: string;
    examDate: string;
    accession: string;
    requestedBy: string;
    requestAddress: string[];
  };
  procedure: string;
  comparison: string;
  indications: string;
  findings: {heading: string; text: string}[];
  conclusion: string[];
  dictatedBy: string;
  dictatedAt: string;
  pageCount: number;
  faxHeaderTime: string;
  faxSid: string;
}

async function renderFaxPdf(spec: FaxPdfSpec): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  for (let pageIdx = 0; pageIdx < spec.pageCount; pageIdx++) {
    const page = pdfDoc.addPage([612, 792]); // US Letter
    const margin = 54;
    let y = 792 - margin;

    // Thin fax-machine header strip (faded).
    page.drawText(
      `${spec.faxHeaderTime}    Fax Services    → ${spec.patient.accession} ${spec.patient.requestedBy.split(",")[0].toUpperCase()} MD    pg ${pageIdx + 1} of ${spec.pageCount}`,
      {x: margin, y, size: 7, font: regular, color: rgb(0.45, 0.45, 0.45)},
    );
    y -= 22;

    // Imaging center title block (left) + address block (right).
    page.drawText(spec.header.title, {x: margin, y: y - 14, size: 20, font: bold, color: rgb(0.12, 0.12, 0.12)});
    page.drawText("SPECIALISTS", {x: margin, y: y - 30, size: 10, font: regular, color: rgb(0.3, 0.3, 0.3)});

    const rightX = 320;
    page.drawText(`${spec.header.title} - ${spec.header.addressLines[0].split(",").slice(-1)[0]?.trim() || ""}`, {
      x: rightX, y: y - 4, size: 10, font: bold,
    });
    spec.header.addressLines.forEach((line, i) => {
      page.drawText(line, {x: rightX, y: y - 18 - i * 12, size: 9, font: regular});
    });
    page.drawText(`Phone #: ${spec.header.phone}`, {
      x: rightX, y: y - 18 - spec.header.addressLines.length * 12, size: 9, font: regular,
    });

    y -= 68;

    page.drawText(spec.header.tagline, {x: margin, y, size: 9, font: italic, color: rgb(0.25, 0.25, 0.25)});
    y -= 28;

    // Patient block.
    const drawField = (label: string, value: string, x: number, yy: number) => {
      page.drawText(label, {x, y: yy, size: 9, font: bold});
      page.drawText(value, {x: x + 68, y: yy, size: 9, font: regular});
    };
    drawField("Patient:", spec.patient.name, margin, y);
    drawField("DOB:", spec.patient.dob, 260, y);
    drawField("Age:", String(spec.patient.age), 410, y);
    y -= 14;
    drawField("Exam Date:", spec.patient.examDate, margin, y);
    drawField("ID:", spec.patient.id, 260, y);
    drawField("Sex:", spec.patient.sex, 410, y);
    y -= 14;
    drawField("Accession #:", spec.patient.accession, margin, y);
    y -= 14;
    drawField("At the", "", margin, y);
    page.drawText(spec.patient.requestedBy, {x: margin + 68, y, size: 9, font: regular});
    y -= 12;
    drawField("Request of:", "", margin, y);
    spec.patient.requestAddress.forEach((line, i) => {
      page.drawText(line, {x: margin + 68, y: y - i * 12, size: 9, font: regular});
    });
    y -= spec.patient.requestAddress.length * 12 + 16;

    // Procedure / comparison / indications / findings / conclusion.
    const drawSection = (heading: string, body: string | string[]) => {
      page.drawText(heading, {x: margin, y, size: 9, font: bold});
      y -= 12;
      const lines = Array.isArray(body) ? body : [body];
      for (const line of lines) {
        for (const chunk of wrapText(line, 85)) {
          page.drawText(chunk, {x: margin, y, size: 9, font: regular});
          y -= 11;
        }
      }
      y -= 8;
    };

    drawSection("PROCEDURE:", spec.procedure);
    drawSection("COMPARISON:", spec.comparison);
    drawSection("INDICATIONS:", spec.indications);

    page.drawText("FINDINGS:", {x: margin, y, size: 9, font: bold});
    y -= 12;
    for (const f of spec.findings) {
      page.drawText(f.heading, {x: margin, y, size: 9, font: bold});
      const afterHeading = f.heading.length * 5 + 4;
      for (const chunk of wrapText(f.text, 78)) {
        page.drawText(chunk, {x: margin + afterHeading, y, size: 9, font: regular});
        y -= 11;
        break;
      }
      // Continuation lines left-aligned.
      const rest = wrapText(f.text, 85).slice(1);
      for (const chunk of rest) {
        page.drawText(chunk, {x: margin, y, size: 9, font: regular});
        y -= 11;
      }
    }
    y -= 10;

    drawSection("CONCLUSION:", spec.conclusion);

    y -= 10;
    page.drawText(
      `Dictated and Electronically Authenticated by: ${spec.dictatedBy} on ${spec.dictatedAt}`,
      {x: margin, y, size: 8, font: regular, color: rgb(0.2, 0.2, 0.2)},
    );
    y -= 30;

    page.drawText(spec.header.title, {x: margin + 130, y, size: 9, font: bold});
    y -= 11;
    spec.header.addressLines.forEach((line, i) => {
      page.drawText(line, {x: margin + 130, y: y - i * 11, size: 9, font: regular});
    });
    y -= 11 * spec.header.addressLines.length;
    page.drawText(`${spec.header.phone}`, {x: margin + 130, y, size: 9, font: regular});
  }

  return pdfDoc.save();
}

/** Tiny word-wrap for fixed-width chunks of text. */
function wrapText(input: string, maxChars: number): string[] {
  const words = input.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Catalogue of synthetic fax specs — deterministic, anonymous. */
function sampleSpecs(): FaxPdfSpec[] {
  return [
    {
      header: {
        title: "North Cascade Imaging",
        addressLines: ["1240 Evergreen Blvd, Suite 200", "Lakewood, CA 90712"],
        phone: "(555) 010-0100",
        tagline: "Your Partner in Health - For Every Imaging Need",
      },
      patient: {
        name: "SAMPLE, PATIENT A",
        dob: "03/14/1970",
        id: "NCI-1001",
        age: 56,
        sex: "Female",
        examDate: "04/09/2026",
        accession: "NCI5793247",
        requestedBy: "SANDERS, BROOK J., MD",
        requestAddress: ["520 Cypress Ave, Suite 110", "Lakewood, CA 90712"],
      },
      procedure: "CR LUMBAR SPINE 2V/3V",
      comparison: "None.",
      indications: "Chronic low back pain past six months with migrating left hip region aches.",
      findings: [
        {
          heading: "BONES:",
          text: "9 degrees of thoracolumbar dextrocurvature as measured from the superior endplate of T11 to the inferior endplate of L3. Moderate lower lumbar facet joint arthropathy. The vertebral body heights are maintained.",
        },
        {heading: "DISC SPACES:", text: "No significant disc height narrowing or endplate abnormality."},
        {heading: "PARASPINOUS:", text: "No significant abnormality."},
        {heading: "OTHER:", text: "None."},
      ],
      conclusion: [
        "1. 9 degrees of thoracolumbar dextrocurvature.",
        "2. Moderate lower lumbar facet joint arthropathy.",
      ],
      dictatedBy: "Reed, K., M.D.",
      dictatedAt: "04/10/2026 04:01 PM",
      pageCount: 1,
      faxHeaderTime: "04-10-2026 4:06 PM PT",
      faxSid: "",
    },
    {
      header: {
        title: "Harbor Lab Partners",
        addressLines: ["84 Dockside Way", "Seabright, OR 97305"],
        phone: "(555) 010-0225",
        tagline: "Accurate, on-time lab results",
      },
      patient: {
        name: "SAMPLE, PATIENT B",
        dob: "11/22/1982",
        id: "HLP-2204",
        age: 43,
        sex: "Male",
        examDate: "04/07/2026",
        accession: "HLP2204311",
        requestedBy: "MARLOW, PAUL, MD",
        requestAddress: ["19 Overlook Rd", "Seabright, OR 97305"],
      },
      procedure: "CBC W/DIFF, COMPREHENSIVE METABOLIC PANEL",
      comparison: "Prior panel 11/02/2025.",
      indications: "Annual physical follow-up; monitoring fasting glucose.",
      findings: [
        {heading: "HEMATOLOGY:", text: "WBC 6.8, HGB 14.2, HCT 41.9, PLT 252 — all within normal range."},
        {heading: "CHEMISTRY:", text: "Glucose 104 (slightly elevated), BUN 14, Creatinine 0.9, eGFR >60. Sodium 139, Potassium 4.1. Calcium 9.4."},
        {heading: "LIPIDS:", text: "Not part of this order — schedule separately."},
      ],
      conclusion: ["1. No acute abnormalities.", "2. Recommend lifestyle counseling re: fasting glucose trend."],
      dictatedBy: "Garza, D., M.D.",
      dictatedAt: "04/08/2026 09:42 AM",
      pageCount: 2,
      faxHeaderTime: "04-08-2026 10:15 AM PT",
      faxSid: "",
    },
    {
      header: {
        title: "Valley Cardiology Group",
        addressLines: ["330 Heartspring Lane", "Centerville, NV 89406"],
        phone: "(555) 010-0318",
        tagline: "Cardiac care, personalized.",
      },
      patient: {
        name: "SAMPLE, PATIENT C",
        dob: "07/02/1958",
        id: "VCG-6611",
        age: 67,
        sex: "Female",
        examDate: "04/05/2026",
        accession: "VCG6611805",
        requestedBy: "QUINN, MARGARET, MD",
        requestAddress: ["42 West Ridge Dr, Suite 3", "Centerville, NV 89406"],
      },
      procedure: "12-LEAD ECG, EXERCISE STRESS TEST (BRUCE PROTOCOL)",
      comparison: "Prior ECG 02/12/2026.",
      indications: "Exertional dyspnea; evaluate for ischemia.",
      findings: [
        {heading: "RESTING ECG:", text: "Normal sinus rhythm at 72 bpm. No acute ST changes. Left axis deviation, unchanged from prior."},
        {heading: "EXERCISE:", text: "Patient exercised 8 min 30 sec, achieving 9.2 METs. Peak HR 142 (89% predicted). No chest pain. No significant ST depression."},
        {heading: "RECOVERY:", text: "Prompt HR recovery. No arrhythmia."},
      ],
      conclusion: [
        "1. Negative stress test for inducible ischemia at achieved workload.",
        "2. Submaximal effort — consider repeat with target HR if symptoms persist.",
      ],
      dictatedBy: "Alvarez, T., M.D.",
      dictatedAt: "04/06/2026 02:18 PM",
      pageCount: 3,
      faxHeaderTime: "04-06-2026 2:52 PM PT",
      faxSid: "",
    },
  ];
}

function outboundSpecs(): FaxPdfSpec[] {
  return [
    {
      header: {
        title: "Aurelia MD",
        addressLines: ["500 Main Street, Suite 300", "Demo City, CA 90001"],
        phone: "(555) 999-0000",
        tagline: "Patient-centered primary care",
      },
      patient: {
        name: "SAMPLE, PATIENT D",
        dob: "05/30/1991",
        id: "AUR-4402",
        age: 34,
        sex: "Female",
        examDate: "04/20/2026",
        accession: "AUR4402015",
        requestedBy: "AURELIA MD CLINIC",
        requestAddress: ["500 Main Street, Suite 300", "Demo City, CA 90001"],
      },
      procedure: "REFERRAL — DERMATOLOGY",
      comparison: "N/A.",
      indications: "Persistent rash on forearms; suspected contact dermatitis vs early eczema.",
      findings: [
        {heading: "HISTORY:", text: "Patient reports 6 weeks of pruritic erythematous patches, predominantly flexor surfaces."},
        {heading: "TRIED:", text: "Over-the-counter hydrocortisone 1% — partial relief."},
      ],
      conclusion: ["Referring for dermatology evaluation and biopsy if indicated."],
      dictatedBy: "Admin, Aurelia MD",
      dictatedAt: "04/20/2026 11:15 AM",
      pageCount: 1,
      faxHeaderTime: "04-20-2026 11:20 AM PT",
      faxSid: "",
    },
    {
      header: {
        title: "Aurelia MD",
        addressLines: ["500 Main Street, Suite 300", "Demo City, CA 90001"],
        phone: "(555) 999-0000",
        tagline: "Patient-centered primary care",
      },
      patient: {
        name: "SAMPLE, PATIENT E",
        dob: "02/17/1964",
        id: "AUR-4403",
        age: 62,
        sex: "Male",
        examDate: "04/18/2026",
        accession: "AUR4403018",
        requestedBy: "AURELIA MD CLINIC",
        requestAddress: ["500 Main Street, Suite 300", "Demo City, CA 90001"],
      },
      procedure: "PRIOR AUTHORIZATION — BIOLOGIC THERAPY",
      comparison: "Prior PA request 03/02/2026 (denied, awaiting step-therapy documentation).",
      indications: "Moderate-to-severe plaque psoriasis, failed topical + methotrexate trials.",
      findings: [
        {heading: "MEDICATION:", text: "Requesting adalimumab 40 mg SC every 14 days."},
        {heading: "SUPPORT:", text: "Documented failure of methotrexate 15 mg weekly × 12 weeks; intolerable transaminase elevation."},
      ],
      conclusion: ["Please review attached step-therapy documentation and approve."],
      dictatedBy: "Admin, Aurelia MD",
      dictatedAt: "04/18/2026 03:40 PM",
      pageCount: 2,
      faxHeaderTime: "04-18-2026 3:44 PM PT",
      faxSid: "",
    },
  ];
}

type UploadResult = {ok: true} | {ok: false; error: string};

async function uploadPdf(path: string, bytes: Uint8Array): Promise<UploadResult> {
  try {
    const file = admin.storage().bucket().file(path);
    await file.save(Buffer.from(bytes), {
      metadata: {contentType: "application/pdf"},
      resumable: false,
    });
    return {ok: true};
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`[sim-fax] uploadPdf failed for ${path}:`, msg);
    return {ok: false, error: msg};
  }
}

const SAMPLE_SENDERS = [
  "+14155552010",
  "+12125550142",
  "+13105551177",
  "+16175550199",
];

/**
 * Idempotent seeder. Uses deterministic faxSids so the same PDFs land in
 * the same Storage paths on every run — re-seeding replaces content
 * in-place rather than accumulating.
 */
export async function seedFaxes(db: admin.firestore.Firestore): Promise<{
  inbound: number;
  outbound: number;
  pdfsAttached: number;
  pdfsFailed: number;
  firstPdfError?: string;
  bucket?: string;
  stage?: string;
}> {
  // Self-reporting seed: any throw is returned as a diagnostic result
  // instead of bubbling to safeSeed (which would hide the reason).
  let pdfsAttached = 0;
  let pdfsFailed = 0;
  let firstPdfError: string | undefined;
  let bucketName: string | undefined;
  let inboundCount = 0;
  let outboundCount = 0;
  let stage = "start";

  try {
    stage = "wipe";
    const wipe = async (path: string) => {
      const snap = await db.collection(path).limit(500).get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    };
    await wipe(INBOUND);
    await wipe(OUTBOUND);

    const now = Date.now();
    const ts = (ms: number) => admin.firestore.Timestamp.fromMillis(ms);

    stage = "bucket-lookup";
    try {
      bucketName = admin.storage().bucket().name;
    } catch (err: any) {
      firstPdfError = `bucket lookup: ${err?.message || String(err)}`;
    }

    // Inbound — 3 samples with viewable PDFs. Upload is best-effort: if it
    // fails we still write the Firestore row (pdfPath=null) and surface the
    // underlying Storage/IAM error in the seed result so the operator can
    // diagnose without grepping Cloud Logging.
    stage = "inbound-render";
    const inSpecs = sampleSpecs();
    const inboundSamples: InboundFax[] = [];
    for (let i = 0; i < inSpecs.length; i++) {
      const spec = inSpecs[i];
      const faxSid = `SIM-SEED-IN-${i + 1001}`;
      spec.faxSid = faxSid;
      const pdfBytes = await renderFaxPdf(spec);
      const pdfPath = `${INBOUND}/${faxSid}/original.pdf`;
      const uploaded = await uploadPdf(pdfPath, pdfBytes);
      if (uploaded.ok) pdfsAttached++;
      else {
        pdfsFailed++;
        if (!firstPdfError) firstPdfError = uploaded.error;
      }
      inboundSamples.push({
        faxSid,
        from: SAMPLE_SENDERS[i % SAMPLE_SENDERS.length],
        to: SIM_FAX_NUMBER,
        pageCount: spec.pageCount,
        status: i === 0 ? "needs_review" : i === 1 ? "completed" : "processing",
        receivedAt: ts(now - (2 + i * 6) * 3600_000),
        pdfPath: uploaded.ok ? pdfPath : null,
        attempts: 1,
      });
    }
    stage = "inbound-commit";
    const inboundBatch = db.batch();
    inboundSamples.forEach((f) => inboundBatch.set(db.doc(`${INBOUND}/${f.faxSid}`), f));
    await inboundBatch.commit();
    inboundCount = inboundSamples.length;

    // Outbound — 2 samples, also with PDFs (best-effort upload).
    stage = "outbound-render";
    const outSpecs = outboundSpecs();
    const outboundSamples: (OutboundFax & {pdfPath: string | null})[] = [];
    for (let i = 0; i < outSpecs.length; i++) {
      const spec = outSpecs[i];
      const faxSid = `SIM-SEED-OUT-${i + 1}`;
      spec.faxSid = faxSid;
      const pdfBytes = await renderFaxPdf(spec);
      const pdfPath = `${OUTBOUND}/${faxSid}/original.pdf`;
      const uploaded = await uploadPdf(pdfPath, pdfBytes);
      if (uploaded.ok) pdfsAttached++;
      else {
        pdfsFailed++;
        if (!firstPdfError) firstPdfError = uploaded.error;
      }
      outboundSamples.push({
        faxSid,
        from: SIM_FAX_NUMBER,
        to: ["+14155552020", "+12125550250"][i] || "+15555550100",
        subject: spec.procedure,
        pageCount: spec.pageCount,
        fileCount: 1,
        status: "delivered",
        submittedBy: "sim-seed",
        submittedAt: ts(now - (3 + i * 45) * 3600_000),
        completedAt: ts(now - (3 + i * 45) * 3600_000 + 60_000),
        pdfPath: uploaded.ok ? pdfPath : null,
      });
    }
    stage = "outbound-commit";
    const outboundBatch = db.batch();
    outboundSamples.forEach((f) => outboundBatch.set(db.doc(`${OUTBOUND}/${f.faxSid}`), f));
    await outboundBatch.commit();
    outboundCount = outboundSamples.length;
    stage = "done";
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`[sim-fax] seedFaxes failed at stage=${stage}:`, msg);
    if (!firstPdfError) firstPdfError = `${stage}: ${msg}`;
  }

  return {
    inbound: inboundCount,
    outbound: outboundCount,
    pdfsAttached,
    pdfsFailed,
    firstPdfError,
    bucket: bucketName,
    stage,
  };
}
