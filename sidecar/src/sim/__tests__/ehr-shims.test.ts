/**
 * Consolidated smoke tests for the thin EHR shims — athena, cerner, ecw,
 * elation, epic, greenway, nextgen, pfusion, tebra.
 *
 * Each shim re-reads the shared `simulation/drchrono/patients` pool and
 * re-shapes it. One read per shim is enough — the logic is almost
 * identical and the filter logic is already well-covered by drchrono.test.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import {
  installFakeFirebase,
  resetStore,
  seedDrchronoPatient,
} from "./_helpers.js";

installFakeFirebase();

const { simAthena } = await import("../athena.js");
const { simCerner } = await import("../cerner.js");
const { simEcw } = await import("../ecw.js");
const { simElation } = await import("../elation.js");
const { simEpic } = await import("../epic.js");
const { simGreenway } = await import("../greenway.js");
const { simNextGen } = await import("../nextgen.js");
const { simPfusion } = await import("../pfusion.js");
const { simTebra } = await import("../tebra.js");

describe("EHR shims", () => {
  beforeEach(() => {
    resetStore();
    seedDrchronoPatient(1, {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      cell_phone: "+14155550100",
      gender: "female",
      is_active: true,
    });
  });

  test("athena — GET patients returns athena-shaped rows", async () => {
    const res = await simAthena("GET", "patients", new URLSearchParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.patients).toHaveLength(1);
    const p = body.patients[0];
    expect(p.patientid).toBe("1");
    expect(p.firstname).toBe("Ada");
    expect(p.mobilephone).toBe("14155550100"); // non-digits stripped
    expect(p.practiceid).toBe("1");
  });

  test("cerner — GET Patient returns FHIR bundle", async () => {
    const res = await simCerner("GET", "Patient", new URLSearchParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resourceType).toBe("Bundle");
    expect(body.type).toBe("searchset");
    expect(body.total).toBe(1);
    expect(body.entry[0].resource.resourceType).toBe("Patient");
    expect(body.entry[0].resource.id).toBe("1");
  });

  test("cerner — GET Patient/:id returns 404 OperationOutcome", async () => {
    const res = await simCerner("GET", "Patient/999", new URLSearchParams());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.resourceType).toBe("OperationOutcome");
  });

  test("ecw — GET Patient returns FHIR bundle", async () => {
    const res = await simEcw("GET", "Patient", new URLSearchParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resourceType).toBe("Bundle");
    expect(body.entry).toHaveLength(1);
  });

  test("elation — GET patients returns elation-shape", async () => {
    const res = await simElation("GET", "patients", new URLSearchParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].emails).toEqual([{ email: "ada@example.com" }]);
    expect(body.results[0].phones[0].phone_type).toBe("Mobile");
  });

  test("epic — GET Patient returns FHIR bundle", async () => {
    const res = await simEpic("GET", "Patient", new URLSearchParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resourceType).toBe("Bundle");
    expect(body.entry[0].resource.gender).toBe("female");
  });

  test("greenway — GET patients returns Intergy-style rows", async () => {
    const res = await simGreenway("GET", "patients", new URLSearchParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.TotalCount).toBe(1);
    expect(body.Patients[0].FirstName).toBe("Ada");
    expect(body.Patients[0].Gender).toBe("F");
    expect(body.Patients[0].Status).toBe("Active");
  });

  test("nextgen — GET patients returns nextgen-shape", async () => {
    const res = await simNextGen("GET", "patients", new URLSearchParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalCount).toBe(1);
    expect(body.items[0].personId).toBe("1");
    expect(body.items[0].active).toBe(true);
  });

  test("pfusion — GET patients returns profile-wrapped rows", async () => {
    const res = await simPfusion("GET", "patients", new URLSearchParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalCount).toBe(1);
    expect(body.patients[0].patientId).toBe("1");
    expect(body.patients[0].profile.firstName).toBe("Ada");
    expect(body.patients[0].contact.email).toBe("ada@example.com");
  });

  test("tebra — GET patients returns Tebra-shape", async () => {
    const res = await simTebra("GET", "patients", new URLSearchParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.TotalCount).toBe(1);
    expect(body.Patients[0].PatientID).toBe(1);
    expect(body.Patients[0].IsActive).toBe(true);
    expect(body.Patients[0].Gender).toBe("Female");
  });

  test("unknown paths return 501 across shims", async () => {
    for (const [name, fn] of [
      ["athena", simAthena],
      ["elation", simElation],
      ["greenway", simGreenway],
      ["nextgen", simNextGen],
      ["pfusion", simPfusion],
      ["tebra", simTebra],
    ] as const) {
      const res = await fn("GET", "something/weird", new URLSearchParams());
      expect(res.status).toBe(501);
      const body = await res.json();
      expect(body.error).toContain("does not implement");
      // `name` is referenced only so the array destructure isn't unused —
      // it tags the failing shim when this loop fails.
      expect(typeof name).toBe("string");
    }
  });
});
