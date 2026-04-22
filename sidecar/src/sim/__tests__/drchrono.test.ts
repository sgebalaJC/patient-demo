/**
 * Tests for sim/drchrono.ts — smoke coverage over the biggest sim module.
 * Focuses on one read, one write, one 404 per the test plan, plus a few
 * extra hits on the patient-lookup aggregator because it encodes real
 * business logic.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import {
  installFakeFirebase,
  resetStore,
  seedDoc,
  seedDrchronoPatient,
  readDoc,
  jsonRequest,
} from "./_helpers.js";

installFakeFirebase();

const { simDrChrono } = await import("../drchrono.js");

describe("sim/drchrono", () => {
  beforeEach(() => {
    resetStore();
  });

  test("GET patients — returns a results array shaped like DrChrono", async () => {
    seedDrchronoPatient(1, { first_name: "Ada", last_name: "Lovelace" });
    seedDrchronoPatient(2, { first_name: "Alan", last_name: "Turing" });

    const res = await simDrChrono("GET", "patients", new URLSearchParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(2);
  });

  test("GET patients — first_name prefix filter", async () => {
    seedDrchronoPatient(1, { first_name: "Ada" });
    seedDrchronoPatient(2, { first_name: "Alan" });
    seedDrchronoPatient(3, { first_name: "Grace" });

    const res = await simDrChrono(
      "GET",
      "patients",
      new URLSearchParams({ first_name: "A" }),
    );
    const body = await res.json();
    expect(body.results).toHaveLength(2);
  });

  test("GET patients/:id — 200 when found, 404 when not", async () => {
    seedDrchronoPatient(42);
    const hit = await simDrChrono("GET", "patients/42", new URLSearchParams());
    expect(hit.status).toBe(200);
    expect((await hit.json()).id).toBe(42);

    const miss = await simDrChrono("GET", "patients/999", new URLSearchParams());
    expect(miss.status).toBe(404);
    expect((await miss.json()).detail).toBe("Not found.");
  });

  test("POST patients — creates a new patient record and returns 201", async () => {
    seedDrchronoPatient(1);
    const res = await simDrChrono(
      "POST",
      "patients",
      new URLSearchParams(),
      jsonRequest({ first_name: "New", last_name: "Body", email: "n@x.test" }, "POST"),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThanOrEqual(9001);
    expect(body.first_name).toBe("New");
    expect(readDoc(`simulation/drchrono/patients/${body.id}`)).toBeTruthy();
  });

  test("PATCH patients/:id — updates only allowed fields", async () => {
    seedDrchronoPatient(7, { first_name: "Old", last_name: "Name" });
    const res = await simDrChrono(
      "PATCH",
      "patients/7",
      new URLSearchParams(),
      jsonRequest({ first_name: "New", ssn: "should-be-ignored" }, "PATCH"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.first_name).toBe("New");
    const stored = readDoc("simulation/drchrono/patients/7") as any;
    expect(stored.first_name).toBe("New");
    expect(stored.ssn).toBeUndefined();
  });

  test("POST appointments — requires a patient field", async () => {
    const res = await simDrChrono(
      "POST",
      "appointments",
      new URLSearchParams(),
      jsonRequest({}, "POST"),
    );
    expect(res.status).toBe(400);
  });

  test("GET patient-lookup — no-match when store empty", async () => {
    const res = await simDrChrono(
      "GET",
      "patient-lookup",
      new URLSearchParams({ firstName: "ghost" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("no-match");
    expect(body.matched).toBe(false);
  });

  test("GET patient-lookup — single match by email", async () => {
    seedDrchronoPatient(1, { email: "ada@example.com" });
    seedDrchronoPatient(2, { email: "alan@example.com" });
    const res = await simDrChrono(
      "GET",
      "patient-lookup",
      new URLSearchParams({ email: "ada@example.com" }),
    );
    const body = await res.json();
    expect(body.status).toBe("matched");
    expect(body.matched).toBe(true);
    expect(body.patient.drchronoId).toBe(1);
  });

  test("GET patient-lookup — skipped-multi when >1 candidate", async () => {
    seedDrchronoPatient(1, { first_name: "Ada" });
    seedDrchronoPatient(2, { first_name: "Ada" });
    const res = await simDrChrono(
      "GET",
      "patient-lookup",
      new URLSearchParams({ firstName: "Ada" }),
    );
    const body = await res.json();
    expect(body.status).toBe("skipped-multi");
    expect(body.candidatesCount).toBe(2);
  });

  test("POST documents — attaches document, returns id >= 8001", async () => {
    const res = await simDrChrono(
      "POST",
      "documents",
      new URLSearchParams(),
      jsonRequest({ patient: 1, description: "fax attached" }, "POST"),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThanOrEqual(8001);
    expect(body.patient).toBe(1);
  });

  test("POST clinical_notes — happy path", async () => {
    const res = await simDrChrono(
      "POST",
      "clinical_notes",
      new URLSearchParams(),
      jsonRequest({ patient: 1, note_body: "SOAP body" }, "POST"),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThanOrEqual(6001);
    expect(body.locked).toBe(false);
  });

  test("GET appointments — filters by patient", async () => {
    seedDoc("simulation/drchrono/appointments/1", { id: 1, patient: 10 });
    seedDoc("simulation/drchrono/appointments/2", { id: 2, patient: 20 });
    const res = await simDrChrono(
      "GET",
      "appointments",
      new URLSearchParams({ patient: "10" }),
    );
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe(1);
  });

  test("unknown path falls through to 501", async () => {
    const res = await simDrChrono("GET", "unknown/thing", new URLSearchParams());
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toMatch(/does not implement/);
  });
});
