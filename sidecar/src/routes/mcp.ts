/**
 * MCP (Model Context Protocol) server for the patient-sidecar.
 *
 * Exposes a curated subset of admin-api operations as typed tools so the
 * openclaw agent (Aurelia) can call them directly via MCP instead of
 * shelling out to the bash CLI. The same operations remain available via
 * the HTTP `/admin-api/*` routes for the web admin UI — this transport is
 * additive, not a replacement.
 *
 * Why MCP and not just keep the CLI:
 *   - One transport for both bare-host and containerized openclaw. Demo
 *     runs openclaw in Docker, showmd runs it bare-host; the CLI required
 *     PATH wiring, env propagation, and `docker cp`-into-container glue
 *     for each style. MCP is just an HTTP call to localhost — works
 *     identically everywhere.
 *   - Typed schemas reject malformed calls before execution. The agent
 *     doesn't burn tokens on shell-quoting retries.
 *   - In-process MCP client = no bash/curl spawn overhead per call.
 *
 * Protocol: MCP 2024-11-05 over JSON-RPC 2.0 over plain HTTP POST. The
 * sidecar already gates `/mcp` with the same Bearer-token auth as
 * everything under `admin` scope, so transport security comes for free.
 *
 * Tool dispatch: each tool builds a (method, path, body, authorize)
 * tuple and we call `handleAdminApi` directly with a synthesized
 * Request. No HTTP indirection — the existing route logic is the same
 * code the web UI hits.
 *
 * Security posture (defense in depth):
 *   1. Bearer auth — dispatcher gates with the same SIDECAR_API_KEY as
 *      every other admin route. Unauth → 401 before this handler runs.
 *   2. Content-type pin — body must be application/json; refuses other
 *      types so a CSRF-style POST from a browser can't reach JSON-RPC.
 *   3. Argument validation — each tool args object is type-checked
 *      against an explicit allowlist; build() never inlines unsanitized
 *      user input into a path, only known scalar fields.
 *   4. ID-shape gate — IDs in path positions must match a strict regex
 *      (alphanumerics + a few separators). Rejects `..`, `/`, query
 *      injection, control characters.
 *   5. Escape-hatch fence — `admin_api_raw` enforces the path prefix
 *      `/admin-api/`, blocks `..`, refuses authorize=true (destructive
 *      ops MUST go through curated tools so they're explicit and
 *      auditable), and refuses DELETE entirely.
 *   6. Audit log — every tool call writes a single-line stderr record
 *      with tool name + authorize flag + status, so unusual agent
 *      behavior is visible in journalctl.
 */

import { handleAdminApi } from "./admin-api.js";

const MCP_VERSION = "2024-11-05";

/** Tight allowlist for IDs we splice into URL paths. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function safeId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new Error(`Invalid ${field} (must match ${ID_RE})`);
  }
  return value;
}
function asString(value: unknown, field: string, max = 4000): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (value.length > max) throw new Error(`${field} exceeds max length ${max}`);
  return value;
}
function asEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}
function asNumber(value: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  if (opts.min !== undefined && n < opts.min) throw new Error(`${field} must be ≥ ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new Error(`${field} must be ≤ ${opts.max}`);
  return n;
}

interface BuiltCall {
  method: string;
  /** Full path starting with `/admin-api`. */
  path: string;
  body?: unknown;
  /** Adds `X-Operator-Authorized: true`, required by destructive admin-api routes. */
  authorize?: boolean;
}

type Args = Record<string, unknown>;
type Schema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

interface Tool {
  name: string;
  description: string;
  inputSchema: Schema;
  build: (args: Args) => BuiltCall;
}

function qs(pairs: Array<[string, unknown]>): string {
  const parts: string[] = [];
  for (const [k, v] of pairs) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

const TOOLS: Tool[] = [
  // ── Patients ───────────────────────────────────────────────────────
  {
    name: "patients_list",
    description: "List patient profiles. Supports search by name/email and status filter.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Substring match against name/email" },
        status: { type: "string", enum: ["active", "inactive"] },
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
    build: (a) => ({
      method: "GET",
      path: `/admin-api/patients${qs([
        ["search", a.search === undefined ? undefined : asString(a.search, "search", 200)],
        ["status", a.status === undefined ? undefined : asEnum(a.status, "status", ["active", "inactive"] as const)],
        ["limit", a.limit === undefined ? undefined : asNumber(a.limit, "limit", { min: 1, max: 500 })],
      ])}`,
    }),
  },
  {
    name: "patients_get",
    description: "Get a single patient profile by ID.",
    inputSchema: {
      type: "object",
      properties: { patientId: { type: "string" } },
      required: ["patientId"],
    },
    build: (a) => ({ method: "GET", path: `/admin-api/patients/${safeId(a.patientId, "patientId")}` }),
  },

  // ── Appointments ───────────────────────────────────────────────────
  {
    name: "appointments_upcoming",
    description: "List upcoming appointments across all patients.",
    inputSchema: { type: "object", properties: {} },
    build: () => ({ method: "GET", path: "/admin-api/appointments/upcoming" }),
  },
  {
    name: "appointments_list_for_patient",
    description: "List appointments for a specific patient (past and upcoming).",
    inputSchema: {
      type: "object",
      properties: { patientId: { type: "string" } },
      required: ["patientId"],
    },
    build: (a) => ({ method: "GET", path: `/admin-api/appointments/patient/${safeId(a.patientId, "patientId")}` }),
  },
  {
    name: "appointments_get",
    description: "Get a single appointment by ID.",
    inputSchema: {
      type: "object",
      properties: { appointmentId: { type: "string" } },
      required: ["appointmentId"],
    },
    build: (a) => ({ method: "GET", path: `/admin-api/appointments/${safeId(a.appointmentId, "appointmentId")}` }),
  },
  {
    name: "appointments_cancel",
    description:
      "Cancel an appointment. DESTRUCTIVE — confirm with the operator before calling.",
    inputSchema: {
      type: "object",
      properties: {
        appointmentId: { type: "string" },
        reason: { type: "string", description: "Cancellation reason for audit trail" },
      },
      required: ["appointmentId"],
    },
    build: (a) => ({
      method: "PATCH",
      path: `/admin-api/appointments/${safeId(a.appointmentId, "appointmentId")}`,
      body: {
        status: "cancelled",
        cancellationReason: a.reason === undefined ? undefined : asString(a.reason, "reason", 500),
      },
      authorize: true,
    }),
  },

  // ── Refills ────────────────────────────────────────────────────────
  {
    name: "refills_list",
    description: "List prescription refill requests, optionally filtered by status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "approved", "denied", "completed"] },
        limit: { type: "number" },
      },
    },
    build: (a) => ({
      method: "GET",
      path: `/admin-api/refills${qs([
        ["status", a.status === undefined ? undefined : asEnum(a.status, "status", ["pending", "approved", "denied", "completed"] as const)],
        ["limit", a.limit === undefined ? undefined : asNumber(a.limit, "limit", { min: 1, max: 500 })],
      ])}`,
    }),
  },
  {
    name: "refills_for_patient",
    description: "List refills for a specific patient.",
    inputSchema: {
      type: "object",
      properties: { patientId: { type: "string" } },
      required: ["patientId"],
    },
    build: (a) => ({ method: "GET", path: `/admin-api/refills/patient/${safeId(a.patientId, "patientId")}` }),
  },
  {
    name: "refills_update",
    description: "Approve, deny, or complete a refill request. Pin reasoning in doctorNotes.",
    inputSchema: {
      type: "object",
      properties: {
        refillId: { type: "string" },
        status: { type: "string", enum: ["approved", "denied", "completed"] },
        doctorNotes: { type: "string", description: "Reasoning, dosage adjustments, etc." },
      },
      required: ["refillId", "status"],
    },
    build: (a) => ({
      method: "PATCH",
      path: `/admin-api/refills/${safeId(a.refillId, "refillId")}`,
      body: {
        status: asEnum(a.status, "status", ["approved", "denied", "completed"] as const),
        doctorNotes: a.doctorNotes === undefined ? undefined : asString(a.doctorNotes, "doctorNotes", 4000),
      },
    }),
  },

  // ── Messages ───────────────────────────────────────────────────────
  {
    name: "messages_list",
    description: "List message threads. Filter all|unread|priority.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["all", "unread", "priority"] },
        limit: { type: "number" },
      },
    },
    build: (a) => ({
      method: "GET",
      path: `/admin-api/messages${qs([
        ["filter", a.filter === undefined ? undefined : asEnum(a.filter, "filter", ["all", "unread", "priority"] as const)],
        ["limit", a.limit === undefined ? undefined : asNumber(a.limit, "limit", { min: 1, max: 500 })],
      ])}`,
    }),
  },
  {
    name: "messages_get_thread",
    description: "Get one message thread with all its messages.",
    inputSchema: {
      type: "object",
      properties: { threadId: { type: "string" } },
      required: ["threadId"],
    },
    build: (a) => ({ method: "GET", path: `/admin-api/messages/${safeId(a.threadId, "threadId")}` }),
  },
  {
    name: "messages_reply",
    description: "Send a reply on an existing message thread.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string" },
        content: { type: "string" },
      },
      required: ["threadId", "content"],
    },
    build: (a) => ({
      method: "POST",
      path: `/admin-api/messages/${safeId(a.threadId, "threadId")}/reply`,
      body: { content: asString(a.content, "content", 8000) },
    }),
  },

  // ── Documents ──────────────────────────────────────────────────────
  {
    name: "documents_list_for_patient",
    description: "List uploaded documents for a patient. Optional `type` filter.",
    inputSchema: {
      type: "object",
      properties: {
        patientId: { type: "string" },
        type: { type: "string", description: "e.g. driver_license, insurance_card" },
      },
      required: ["patientId"],
    },
    build: (a) => ({
      method: "GET",
      path: `/admin-api/documents/patient/${safeId(a.patientId, "patientId")}${
        a.type === undefined ? "" : `?type=${encodeURIComponent(asString(a.type, "type", 100))}`
      }`,
    }),
  },
  {
    name: "documents_status_for_patient",
    description: "Required-document completion check for a patient.",
    inputSchema: {
      type: "object",
      properties: { patientId: { type: "string" } },
      required: ["patientId"],
    },
    build: (a) => ({ method: "GET", path: `/admin-api/documents/patient/${safeId(a.patientId, "patientId")}/status` }),
  },

  // ── Intake forms ───────────────────────────────────────────────────
  {
    name: "intake_forms_list",
    description: "List intake forms, optionally filtered by status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        limit: { type: "number" },
      },
    },
    build: (a) => ({
      method: "GET",
      path: `/admin-api/intake-forms${qs([
        ["status", a.status === undefined ? undefined : asString(a.status, "status", 50)],
        ["limit", a.limit === undefined ? undefined : asNumber(a.limit, "limit", { min: 1, max: 500 })],
      ])}`,
    }),
  },
  {
    name: "intake_form_for_patient",
    description: "Get a patient's intake form.",
    inputSchema: {
      type: "object",
      properties: { patientId: { type: "string" } },
      required: ["patientId"],
    },
    build: (a) => ({ method: "GET", path: `/admin-api/intake-forms/patient/${safeId(a.patientId, "patientId")}` }),
  },

  // ── Specialist requests ────────────────────────────────────────────
  {
    name: "specialist_requests_list",
    description: "List specialist referral requests.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
    build: (a) => ({
      method: "GET",
      path: `/admin-api/specialist-requests${qs([
        ["limit", a.limit === undefined ? undefined : asNumber(a.limit, "limit", { min: 1, max: 500 })],
      ])}`,
    }),
  },

  // ── Escape hatch ───────────────────────────────────────────────────
  //
  // For routes that aren't curated above, fall through to a generic call.
  // Curated tools are preferred — typed schemas catch most mistakes —
  // but we don't want the agent stuck when the caller asks for something
  // legitimate that's not in the curated set yet.
  //
  // Fences:
  //   - Path MUST start with `/admin-api/`. Anything else (e.g. `/files`,
  //     `/restart`) is denied — those aren't in scope for the agent.
  //   - No `..`, no fragments, no protocol-relative paths.
  //   - DELETE is denied — every destructive flow we expose has its own
  //     explicit curated tool. If the agent needs DELETE, add the curated
  //     tool, don't backdoor through here.
  //   - `authorize: true` is denied. Destructive ops MUST go through a
  //     curated tool so the call shape and operator-confirmation language
  //     in the tool description are explicit; the escape hatch must not
  //     silently elevate.
  {
    name: "admin_api_raw",
    description:
      "Generic admin-api read passthrough. Use ONLY when no curated tool fits — prefer the typed tools above. Path must start with /admin-api. Methods limited to GET/POST/PATCH (DELETE goes through curated tools). authorize:true is rejected — destructive ops MUST use a curated tool.",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PATCH"] },
        path: { type: "string", description: "Full admin-api path, e.g. /admin-api/specialist-requests/abc123" },
        body: { description: "JSON request body (omit for GET)" },
      },
      required: ["method", "path"],
    },
    build: (a) => {
      const method = asEnum(a.method, "method", ["GET", "POST", "PATCH"] as const);
      const path = asString(a.path, "path", 1000);
      if (!path.startsWith("/admin-api/")) {
        throw new Error("path must start with /admin-api/");
      }
      if (path.includes("..") || path.includes("//") || path.includes("\0")) {
        throw new Error("path contains forbidden segments");
      }
      if ("authorize" in a) {
        throw new Error("authorize:true is not allowed via admin_api_raw — use the matching curated tool");
      }
      return { method, path, body: a.body };
    },
  },
];

interface JsonRpcResult {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

function ok(id: unknown, result: unknown): Response {
  const body: JsonRpcResult = { jsonrpc: "2.0", id, result };
  return Response.json(body);
}

function rpcError(id: unknown, code: number, message: string): Response {
  const body: JsonRpcResult = { jsonrpc: "2.0", id, error: { code, message } };
  return Response.json(body);
}

export async function handleMcp(request: Request): Promise<Response> {
  // Content-type pin — refuses form-urlencoded / multipart so a stray
  // CSRF-style POST from a browser context can't reach JSON-RPC. Even
  // though the Bearer gate already protects us, this closes one class of
  // confused-deputy issue.
  const ctype = (request.headers.get("content-type") || "").toLowerCase();
  if (!ctype.startsWith("application/json")) {
    return rpcError(null, -32600, "Content-Type must be application/json");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error: body must be JSON");
  }
  if (!payload || typeof payload !== "object") {
    return rpcError(null, -32600, "Invalid Request");
  }

  const { jsonrpc, id, method, params } = payload as {
    jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown>;
  };
  if (jsonrpc !== "2.0") return rpcError(id, -32600, "Invalid Request");

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: MCP_VERSION,
        serverInfo: { name: "patient-sidecar", version: "1.1.0" },
        capabilities: { tools: {} },
      });

    case "notifications/initialized":
      // No-op acknowledgement; some clients send this after `initialize`.
      return new Response(null, { status: 204 });

    case "tools/list":
      return ok(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const name = (params as { name?: string } | undefined)?.name;
      const args = ((params as { arguments?: Args } | undefined)?.arguments ?? {}) as Args;
      if (!name) return rpcError(id, -32602, "Missing tool name");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);

      let built: BuiltCall;
      try {
        built = tool.build(args);
      } catch (err) {
        return rpcError(id, -32602, `Bad arguments for ${name}: ${(err as Error).message}`);
      }

      // Synthesize an admin-api Request and dispatch directly. We intentionally
      // bypass the public HTTP loopback — same code path, fewer hops.
      const headers = new Headers({
        "Content-Type": "application/json",
        "X-User-Uid": "ai-agent",
        "X-User-Role": "admin",
        "X-User-Name": "Assistant",
      });
      if (built.authorize) headers.set("X-Operator-Authorized", "true");

      const init: RequestInit = { method: built.method, headers };
      if (built.method !== "GET" && built.body !== undefined) {
        init.body = JSON.stringify(built.body);
      }
      // The host part is irrelevant — handleAdminApi reads `path` and
      // `searchParams` only. Use a stable internal hostname for clarity in logs.
      const url = new URL(`http://sidecar.internal${built.path}`);
      const synthRequest = new Request(url.toString(), init);

      let respText: string;
      let isError = false;
      let status = 0;
      try {
        const resp = await handleAdminApi(built.method, url.pathname, url, synthRequest);
        respText = await resp.text();
        status = resp.status;
        isError = status >= 400;
      } catch (err) {
        respText = JSON.stringify({ error: (err as Error).message });
        isError = true;
      }

      // One-line audit log to stderr — picked up by journalctl on the
      // sidecar host. Captures the call shape and outcome without
      // logging request bodies (could contain PHI). Critical for spotting
      // unusual agent behavior (especially authorize:true volume spikes).
      console.error(
        `[mcp] tool=${name} method=${built.method} authorize=${!!built.authorize} status=${status}${
          isError ? " error" : ""
        }`,
      );

      return ok(id, {
        content: [{ type: "text", text: respText }],
        isError,
      });
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
