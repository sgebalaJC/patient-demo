/**
 * Tests for sim/faxes.ts — inbound/outbound list, inject, patch, send.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { Timestamp } from "firebase-admin/firestore";
import {
  installFakeFirebase,
  resetStore,
  seedDoc,
  readDoc,
  jsonRequest,
} from "./_helpers.js";

installFakeFirebase();

const {
  simFaxGetOurNumber,
  simFaxListInbound,
  simFaxListOutbound,
  simFaxGet,
  simFaxPatch,
  simFaxInjectInbound,
  simFaxSend,
  simFaxToDrChrono,
  SIM_FAX_NUMBER,
} = await import("../faxes.js");

describe("sim/faxes", () => {
  beforeEach(() => {
    resetStore();
  });

  test("getOurNumber returns the reserved SIM fax number", async () => {
    const res = await simFaxGetOurNumber();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ number: SIM_FAX_NUMBER });
  });

  test("listInbound returns empty array when nothing seeded", async () => {
    const res = await simFaxListInbound();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
  });

  test("listInbound returns seeded rows, newest-first", async () => {
    const older = Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const newer = Timestamp.fromDate(new Date("2026-02-01T00:00:00Z"));
    seedDoc("simulation/faxes/inbound/f-old", { faxSid: "f-old", receivedAt: older, status: "needs_review" });
    seedDoc("simulation/faxes/inbound/f-new", { faxSid: "f-new", receivedAt: newer, status: "needs_review" });
    const res = await simFaxListInbound();
    const body = await res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results[0].faxSid).toBe("f-new");
    expect(body.results[1].faxSid).toBe("f-old");
  });

  test("listOutbound returns seeded outbound rows", async () => {
    seedDoc("simulation/faxes/outbound/out-1", {
      faxSid: "out-1",
      status: "delivered",
      submittedAt: Timestamp.now(),
    });
    const res = await simFaxListOutbound();
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].faxSid).toBe("out-1");
  });

  test("get returns 404 for unknown sid, 200 for seeded sid", async () => {
    const missing = await simFaxGet("does-not-exist");
    expect(missing.status).toBe(404);

    seedDoc("simulation/faxes/inbound/f-1", { faxSid: "f-1", status: "needs_review" });
    const found = await simFaxGet("f-1");
    expect(found.status).toBe(200);
    expect((await found.json()).faxSid).toBe("f-1");
  });

  test("injectInbound creates a new inbound doc with status=needs_review", async () => {
    const res = await simFaxInjectInbound(jsonRequest({ from: "+14155550199", pages: 3 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.faxSid).toMatch(/^SIM-/);
    expect(body.status).toBe("needs_review");

    const stored = readDoc(`simulation/faxes/inbound/${body.faxSid}`);
    expect(stored).toBeTruthy();
    expect((stored as any).from).toBe("+14155550199");
    expect((stored as any).pageCount).toBe(3);
    expect((stored as any).to).toBe(SIM_FAX_NUMBER);
  });

  test("patch updates allowed status field and rejects unknown faxes", async () => {
    seedDoc("simulation/faxes/inbound/f-patch", {
      faxSid: "f-patch",
      status: "needs_review",
      from: "+14155550111",
    });
    const res = await simFaxPatch("f-patch", jsonRequest({ status: "attached", ignored: "x" }, "PATCH"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("attached");
    // The unknown key must not leak into the write.
    expect((body as any).ignored).toBeUndefined();
    expect((readDoc("simulation/faxes/inbound/f-patch") as any).status).toBe("attached");
  });

  test("patch returns 404 for missing fax", async () => {
    const res = await simFaxPatch("missing", jsonRequest({ status: "attached" }, "PATCH"));
    expect(res.status).toBe(404);
  });

  test("send creates outbound doc and returns faxSid", async () => {
    const res = await simFaxSend(
      jsonRequest({ to: "+14155552222", subject: "hello", fileCount: 2 }),
      "admin-uid-1",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("queued");
    expect(body.faxSid).toMatch(/^SIM-OUT-/);

    const stored = readDoc(`simulation/faxes/outbound/${body.faxSid}`);
    expect(stored).toBeTruthy();
    expect((stored as any).to).toBe("+14155552222");
    expect((stored as any).submittedBy).toBe("admin-uid-1");
    expect((stored as any).status).toBe("queued");
  });

  test("send returns 400 when to is missing", async () => {
    const res = await simFaxSend(jsonRequest({}), "admin-uid-1");
    expect(res.status).toBe(400);
  });

  test("toDrChrono attaches a document id to the matched fax", async () => {
    seedDoc("simulation/faxes/inbound/f-attach", {
      faxSid: "f-attach",
      status: "needs_review",
    });
    const res = await simFaxToDrChrono(
      jsonRequest({ faxSid: "f-attach", patient: 1234 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.patient).toBe(1234);
    expect(typeof body.drchronoDocumentId).toBe("number");
    const stored = readDoc("simulation/faxes/inbound/f-attach") as any;
    expect(stored.matchedPatient.drchronoId).toBe(1234);
  });
});
