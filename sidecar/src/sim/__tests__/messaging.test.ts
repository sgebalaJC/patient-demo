/**
 * Tests for sim/messaging.ts — SMS outbound send, inbound inject, list.
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
  simSmsSend,
  simSmsInjectInbound,
  simSmsListInbound,
  simSmsListOutbound,
  SIM_SMS_NUMBER,
} = await import("../messaging.js");

describe("sim/messaging", () => {
  beforeEach(() => {
    resetStore();
  });

  test("send creates an outbound sms doc and returns sid", async () => {
    const res = await simSmsSend(
      jsonRequest({ to: "+14155552222", body: "Hi there", kind: "agent" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("delivered");
    expect(body.sid).toMatch(/^SIM-SMS-/);

    const stored = readDoc(`simulation/sms/outbound/${body.sid}`) as any;
    expect(stored).toBeTruthy();
    expect(stored.to).toBe("+14155552222");
    expect(stored.body).toBe("Hi there");
    expect(stored.kind).toBe("agent");
    expect(stored.from).toBe(SIM_SMS_NUMBER);
  });

  test("send returns 400 when to is missing", async () => {
    const res = await simSmsSend(jsonRequest({ body: "hello" }));
    expect(res.status).toBe(400);
  });

  test("send returns 400 when body is missing", async () => {
    const res = await simSmsSend(jsonRequest({ to: "+14155550000" }));
    expect(res.status).toBe(400);
  });

  test("injectInbound creates an inbound sms doc", async () => {
    const res = await simSmsInjectInbound(
      jsonRequest({ from: "+14155550199", body: "reply text" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("received");
    expect(body.sid).toMatch(/^SIM-SMS-IN-/);

    const stored = readDoc(`simulation/sms/inbound/${body.sid}`) as any;
    expect(stored.body).toBe("reply text");
    expect(stored.from).toBe("+14155550199");
    expect(stored.to).toBe(SIM_SMS_NUMBER);
  });

  test("list inbound+outbound returns seeded rows ordered newest-first", async () => {
    const older = Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const newer = Timestamp.fromDate(new Date("2026-02-01T00:00:00Z"));
    seedDoc("simulation/sms/outbound/o-old", { sid: "o-old", sentAt: older });
    seedDoc("simulation/sms/outbound/o-new", { sid: "o-new", sentAt: newer });
    seedDoc("simulation/sms/inbound/i-1", { sid: "i-1", receivedAt: Timestamp.now() });

    const out = await simSmsListOutbound();
    const outBody = await out.json();
    expect(outBody.results).toHaveLength(2);
    expect(outBody.results[0].sid).toBe("o-new");

    const inb = await simSmsListInbound();
    const inBody = await inb.json();
    expect(inBody.results).toHaveLength(1);
    expect(inBody.results[0].sid).toBe("i-1");
  });
});
