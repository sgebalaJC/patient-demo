/**
 * Tests for sim/workspace.ts — Gmail + Calendar happy paths.
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

const { simWorkspace } = await import("../workspace.js");

describe("sim/workspace", () => {
  beforeEach(() => {
    resetStore();
  });

  test("POST gmail/send — creates an email doc and returns messageId", async () => {
    const res = await simWorkspace(
      "POST",
      "gmail/send",
      new URLSearchParams(),
      jsonRequest({ to: "test@example.com", subject: "Hello", body: "Hi" }, "POST"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.messageId).toMatch(/^SIM-MAIL-/);
    const stored = readDoc(`simulation/workspace/emails/${body.messageId}`) as any;
    expect(stored.to).toBe("test@example.com");
    expect(stored.subject).toBe("Hello");
  });

  test("POST gmail/send — 400 when to/subject missing", async () => {
    const res = await simWorkspace(
      "POST",
      "gmail/send",
      new URLSearchParams(),
      jsonRequest({ body: "body only" }, "POST"),
    );
    expect(res.status).toBe(400);
  });

  test("GET gmail/messages — lists sent emails newest-first", async () => {
    const older = Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const newer = Timestamp.fromDate(new Date("2026-02-01T00:00:00Z"));
    seedDoc("simulation/workspace/emails/m1", { messageId: "m1", sentAt: older });
    seedDoc("simulation/workspace/emails/m2", { messageId: "m2", sentAt: newer });
    const res = await simWorkspace("GET", "gmail/messages", new URLSearchParams());
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].messageId).toBe("m2");
  });

  test("POST calendar/events — creates an event doc", async () => {
    const res = await simWorkspace(
      "POST",
      "calendar/events",
      new URLSearchParams(),
      jsonRequest(
        {
          summary: "Checkup",
          start: "2026-05-01T10:00:00Z",
          end: "2026-05-01T10:30:00Z",
          attendees: ["a@b.test"],
        },
        "POST",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^SIM-EVT-/);
    const stored = readDoc(`simulation/workspace/events/${body.id}`) as any;
    expect(stored.summary).toBe("Checkup");
    expect(stored.attendees).toEqual(["a@b.test"]);
  });

  test("POST calendar/events — 400 when required fields missing", async () => {
    const res = await simWorkspace(
      "POST",
      "calendar/events",
      new URLSearchParams(),
      jsonRequest({ summary: "no dates" }, "POST"),
    );
    expect(res.status).toBe(400);
  });

  test("unknown path falls through to 501", async () => {
    const res = await simWorkspace("GET", "drive/files", new URLSearchParams());
    expect(res.status).toBe(501);
  });
});
