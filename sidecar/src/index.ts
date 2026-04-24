/**
 * Patient Portal Sidecar API
 *
 * Lightweight management API running on the OpenClaw host.
 * Provides chat proxy, workspace file ops, process management, config, and backup/restore.
 *
 * Auth: Bearer token from SIDECAR_API_KEY env var, optionally with user context headers
 * Port: 8081 (configurable via PORT env)
 *
 * Routing: table-driven. Each Route in ROUTES below declares its path
 * matcher, method, and visibility (public / admin-only / authed-any).
 * The dispatcher walks ROUTES top-to-bottom; first match wins. Auth +
 * admin gating is enforced centrally by the dispatcher, not per-handler.
 */

import { validateAuth, type AuthResult } from "./lib/auth.js";
import { handleChat } from "./routes/chat.js";
import { inboundSmsWebhook } from "./real/messaging.js";
import { readFile, writeFileTo, deleteFilePath, listFiles } from "./routes/files.js";
import { handleStatus, handleRestart } from "./routes/container.js";
import { handleStats } from "./routes/stats.js";
import { readConfig, patchConfig } from "./routes/config.js";
import { handleCreate, handleList, handleRestore, handleDelete, handleDownload } from "./routes/backup.js";
import { handleListSkills, handleReadSkill } from "./routes/skills.js";
import { handleAdminApi } from "./routes/admin-api.js";
import { handleSnapshot } from "./routes/snapshot.js";
import {
  handleCronList, handleCronAdd, handleCronDelete, handleCronRun, handleCronRuns,
} from "./routes/cron.js";
import { startHealthMonitor } from "./lib/health-monitor.js";

const PORT = parseInt(process.env.PORT || "8081");

// Bun's default idleTimeout is 10s, which cuts off long-running routes:
// /backup/create tars the whole workspace, DrChrono file uploads stream
// large PDFs, and some EHR API responses are genuinely slow. 255s is the
// max Bun accepts — anything longer requires setting to 0 (disabled).
const IDLE_TIMEOUT_SECONDS = 255;

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://patient.example.com",
];

// Simple rate limiter: 100 requests per minute per IP
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(ip, { count: 1, resetAt: now + 60000 });
    return false;
  }
  entry.count++;
  return entry.count > 100;
}

// Clean up rate limiter every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimiter) {
    if (now > entry.resetAt) rateLimiter.delete(ip);
  }
}, 300000);

function getClientIp(request: Request, server: { requestIP(req: Request): { address: string } | null }): string {
  return server.requestIP(request)?.address || "unknown";
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Uid, X-User-Role, X-User-Name",
    "Access-Control-Max-Age": "86400",
  };
}

// ─── Route table ──────────────────────────────────────────────────────
// Each Route declares how a request is matched and who may call it.
// - `match: string`             → exact path
// - `match: { prefix: string }` → `path.startsWith(prefix)`
// - `match: RegExp`             → regex; capture groups become `params`
// - `method: string[]`          → allowed methods (omit for any)
// - `scope: "public"`           → no auth required (health, webhooks)
// - `scope: "admin"`            → authed + user-context must be admin
// - `scope: "any"`              → authed, any role (patients can hit /chat)

type MatchSpec = string | { prefix: string } | RegExp;
type Scope = "public" | "admin" | "any";
type HandlerCtx = {
  request: Request;
  url: URL;
  path: string;
  method: string;
  auth: AuthResult | null;
  /** Regex capture groups when `match` is a RegExp. */
  params: string[];
};
type Handler = (ctx: HandlerCtx) => Response | Promise<Response>;

interface Route {
  match: MatchSpec;
  method?: string[];
  scope: Scope;
  handler: Handler;
}

function matches(spec: MatchSpec, path: string): RegExpExecArray | string[] | null {
  if (typeof spec === "string") return path === spec ? [] : null;
  if (spec instanceof RegExp) return spec.exec(path);
  return path.startsWith(spec.prefix) ? [] : null;
}

const ROUTES: Route[] = [
  // ── Public ─────────────────────────────────────────────────────────
  {
    match: "/healthz", method: ["GET"], scope: "public",
    handler: () => Response.json({ ok: true, service: "patient-sidecar", version: "1.1.0" }),
  },
  {
    // Twilio inbound webhook is HMAC-verified inside the handler, no CORS.
    match: "/webhooks/twilio/inbound-sms", scope: "public",
    handler: ({ request }) => inboundSmsWebhook(request),
  },

  // ── Chat (any authed role, incl. patients) ─────────────────────────
  {
    match: "/chat", method: ["POST"], scope: "any",
    handler: ({ request, auth }) => handleChat(request, auth!.user),
  },

  // ── Files (admin) ──────────────────────────────────────────────────
  {
    match: { prefix: "/files" }, scope: "admin",
    handler: async ({ request, url, path, method }) => {
      const filePath = decodeURIComponent(path.replace("/files/", "").replace("/files", ""));
      if (method === "GET" && !filePath) {
        const pattern = url.searchParams.get("pattern") || "";
        return listFiles(pattern);
      }
      if (method === "GET" && filePath) return readFile(filePath);
      if (method === "PUT" && filePath) return writeFileTo(filePath, request);
      if (method === "DELETE" && filePath) return deleteFilePath(filePath);
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  },

  // ── Skills (admin) ─────────────────────────────────────────────────
  { match: "/skills", method: ["GET"], scope: "admin", handler: () => handleListSkills() },
  {
    match: /^\/skills\/([\w-]+)$/, method: ["GET"], scope: "admin",
    handler: ({ params }) => handleReadSkill(params[0]),
  },

  // ── Status / Restart / Stats / Config (admin) ──────────────────────
  { match: "/status", method: ["GET"], scope: "admin", handler: () => handleStatus() },
  { match: "/restart", method: ["POST"], scope: "admin", handler: () => handleRestart() },
  { match: "/stats", method: ["GET"], scope: "admin", handler: () => handleStats() },
  { match: "/config", method: ["GET"], scope: "admin", handler: () => readConfig() },
  { match: "/config", method: ["PATCH"], scope: "admin", handler: ({ request }) => patchConfig(request) },

  // ── Backup (admin) ─────────────────────────────────────────────────
  { match: "/backup/create", method: ["POST"], scope: "admin", handler: () => handleCreate() },
  { match: "/backup/list", method: ["GET"], scope: "admin", handler: () => handleList() },
  { match: "/backup/restore", method: ["POST"], scope: "admin", handler: ({ request }) => handleRestore(request) },
  {
    match: /^\/backup\/([^/]+)\/download$/, method: ["GET"], scope: "admin",
    handler: ({ params }) => handleDownload(params[0]),
  },
  {
    match: /^\/backup\/([^/]+)$/, method: ["DELETE"], scope: "admin",
    handler: ({ params }) => handleDelete(params[0]),
  },

  // ── Cron (admin) ───────────────────────────────────────────────────
  { match: "/cron", method: ["GET"], scope: "admin", handler: () => handleCronList() },
  { match: "/cron", method: ["POST"], scope: "admin", handler: ({ request }) => handleCronAdd(request) },
  {
    match: /^\/cron\/([\w-]+)$/, method: ["DELETE"], scope: "admin",
    handler: ({ params }) => handleCronDelete(params[0]),
  },
  {
    match: /^\/cron\/([\w-]+)\/run$/, method: ["POST"], scope: "admin",
    handler: ({ params }) => handleCronRun(params[0]),
  },
  {
    match: /^\/cron\/([\w-]+)\/runs$/, method: ["GET"], scope: "admin",
    handler: ({ params }) => handleCronRuns(params[0]),
  },

  // ── Snapshot (admin) ───────────────────────────────────────────────
  { match: "/snapshot/openclaw", method: ["GET"], scope: "admin", handler: () => handleSnapshot() },

  // ── Admin API proxy (admin) ────────────────────────────────────────
  {
    match: { prefix: "/admin-api" }, scope: "admin",
    handler: ({ request, url, path, method }) => handleAdminApi(method, path, url, request),
  },
];

function findRoute(path: string, method: string): { route: Route; params: string[] } | null {
  for (const route of ROUTES) {
    const m = matches(route.match, path);
    if (!m) continue;
    if (route.method && !route.method.includes(method)) continue;
    const params = Array.isArray(m) ? Array.from(m).slice(1) : [];
    return { route, params };
  }
  return null;
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  async fetch(request, server) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get("origin");

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const respond = (res: Response): Response => {
      const headers = corsHeaders(origin);
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    };

    const hit = findRoute(path, method);
    if (!hit) return respond(Response.json({ error: "Not found" }, { status: 404 }));

    const { route, params } = hit;

    // Public routes skip rate limit + auth entirely (Twilio, healthz).
    // Twilio inbound-sms intentionally bypasses CORS too — it's called
    // server-to-server, not from a browser.
    if (route.scope === "public") {
      try {
        const res = await route.handler({ request, url, path, method, auth: null, params });
        return path === "/webhooks/twilio/inbound-sms" ? res : respond(res);
      } catch (err) {
        console.error(`[sidecar] ${method} ${path} error:`, err);
        return respond(Response.json({ error: "Internal error" }, { status: 500 }));
      }
    }

    // Rate-limit non-public routes.
    const clientIp = getClientIp(request, server);
    if (checkRateLimit(clientIp)) {
      return respond(Response.json({ error: "Rate limited" }, { status: 429 }));
    }

    // Auth required for everything below.
    const auth = validateAuth(request);
    if (!auth) return respond(Response.json({ error: "Unauthorized" }, { status: 401 }));

    // Admin gate — user-context callers must have role=admin. Direct api-key
    // callers (no user context) are internal/backup/scheduled and are
    // allowed. Previously assistants could reach admin routes because the
    // old check only rejected patients — see git blame for context.
    if (route.scope === "admin" && auth.mode === "user-context" && auth.user?.role !== "admin") {
      return respond(Response.json({ error: "Admin access required" }, { status: 403 }));
    }

    try {
      return respond(await route.handler({ request, url, path, method, auth, params }));
    } catch (err) {
      console.error(`[sidecar] ${method} ${path} error:`, err);
      return respond(Response.json({ error: "Internal error" }, { status: 500 }));
    }
  },
});

console.log(`[patient-sidecar] listening on port ${PORT}`);

startHealthMonitor();
