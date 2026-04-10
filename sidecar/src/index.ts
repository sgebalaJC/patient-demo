/**
 * Patient Portal Sidecar API
 *
 * Lightweight management API running on the Vultr VPS alongside OpenClaw.
 * Provides chat proxy, workspace file ops, process management, config, and backup/restore.
 *
 * Auth: Bearer token from SIDECAR_API_KEY env var, optionally with user context headers
 * Port: 8081 (configurable via PORT env)
 */

import { validateAuth, type AuthResult } from "./lib/auth.js";
import { handleChat } from "./routes/chat.js";
import { readFile, writeFileTo, deleteFilePath, listFiles } from "./routes/files.js";
import { handleStatus, handleRestart } from "./routes/container.js";
import { handleStats } from "./routes/stats.js";
import { readConfig, patchConfig } from "./routes/config.js";
import { handleCreate, handleList, handleRestore, handleDelete, handleDownload } from "./routes/backup.js";
import { handleListSkills, handleInstallSkill, handleUninstallSkill } from "./routes/skills.js";

const PORT = parseInt(process.env.PORT || "8081");

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

/** Admin-only routes — patients can only access /chat */
const ADMIN_ONLY_PREFIXES = ["/files", "/status", "/restart", "/stats", "/config", "/backup", "/cron"];

function isAdminOnlyRoute(path: string): boolean {
  return ADMIN_ONLY_PREFIXES.some(prefix => path.startsWith(prefix));
}

const server = Bun.serve({
  port: PORT,
  async fetch(request, server) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get("origin");

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Helper to attach CORS headers to all responses
    const respond = (res: Response): Response => {
      const headers = corsHeaders(origin);
      for (const [k, v] of Object.entries(headers)) {
        res.headers.set(k, v);
      }
      return res;
    };

    // Health check — no auth required
    if (path === "/healthz" && method === "GET") {
      return respond(Response.json({ ok: true, service: "patient-sidecar", version: "1.1.0" }));
    }

    // Rate limit
    const clientIp = getClientIp(request, server);
    if (checkRateLimit(clientIp)) {
      return respond(Response.json({ error: "Rate limited" }, { status: 429 }));
    }

    // Auth check for all other endpoints
    const authResult = validateAuth(request);
    if (!authResult) {
      return respond(Response.json({ error: "Unauthorized" }, { status: 401 }));
    }

    // Enforce admin-only routes
    if (isAdminOnlyRoute(path)) {
      if (authResult.mode === "user-context" && authResult.user?.role === "patient") {
        return respond(Response.json({ error: "Admin access required" }, { status: 403 }));
      }
    }

    try {
      // ── Chat ────────────────────────────────────
      if (path === "/chat" && method === "POST") {
        return respond(await handleChat(request, authResult.user));
      }

      // ── Files ───────────────────────────────────
      if (path.startsWith("/files")) {
        const filePath = decodeURIComponent(path.replace("/files/", "").replace("/files", ""));

        if (method === "GET" && !filePath) {
          const pattern = url.searchParams.get("pattern") || "";
          return respond(listFiles(pattern));
        }
        if (method === "GET" && filePath) return respond(readFile(filePath));
        if (method === "PUT" && filePath) return respond(await writeFileTo(filePath, request));
        if (method === "DELETE" && filePath) return respond(deleteFilePath(filePath));
      }

      // ── Skills ───────────────────────────────────
      if (path === "/skills" && method === "GET") {
        try {
          const { execSync } = await import("child_process");
          const out = execSync("/usr/bin/openclaw skills list --json", {
            timeout: 15000,
            encoding: "utf-8",
            env: { ...process.env, HOME: "/root" },
            stdio: ["pipe", "pipe", "pipe"],
          });
          // The output may contain warnings before/after the JSON — extract just the JSON object
          const jsonStart = out.indexOf("{");
          const jsonEnd = out.lastIndexOf("}");
          const json = (jsonStart >= 0 && jsonEnd > jsonStart)
            ? out.slice(jsonStart, jsonEnd + 1)
            : out;
          return respond(new Response(json, {
            headers: { "Content-Type": "application/json" },
          }));
        } catch (err) {
          console.error("[skills] failed:", err);
          return respond(Response.json({ skills: [], error: String(err) }));
        }
      }

      // ── Status / Restart ────────────────────────
      if (path === "/status" && method === "GET") return respond(await handleStatus());
      if (path === "/restart" && method === "POST") return respond(await handleRestart());

      // ── Stats ───────────────────────────────────
      if (path === "/stats" && method === "GET") return respond(await handleStats());

      // ── Config ──────────────────────────────────
      if (path === "/config" && method === "GET") return respond(readConfig());
      if (path === "/config" && method === "PATCH") return respond(await patchConfig(request));

      // ── Backup ──────────────────────────────────
      if (path === "/backup/create" && method === "POST") return respond(await handleCreate());
      if (path === "/backup/list" && method === "GET") return respond(handleList());
      if (path === "/backup/restore" && method === "POST") return respond(await handleRestore(request));
      if (path.startsWith("/backup/") && path.endsWith("/download") && method === "GET") {
        const name = path.replace("/backup/", "").replace("/download", "");
        return respond(handleDownload(name));
      }
      if (path.startsWith("/backup/") && method === "DELETE") {
        const name = path.replace("/backup/", "");
        return respond(handleDelete(name));
      }

      // ── Skills ─────────────────────────────────
      if (path === "/skills" && method === "GET") return respond(handleListSkills());
      if (path.match(/^\/skills\/[\w-]+\/install$/) && method === "POST") {
        const id = path.split("/")[2];
        return respond(handleInstallSkill(id));
      }
      if (path.match(/^\/skills\/[\w-]+\/uninstall$/) && method === "POST") {
        const id = path.split("/")[2];
        return respond(handleUninstallSkill(id));
      }

      // ── Cron ──────────────────────────────────
      if (path === "/cron" && method === "GET") {
        try {
          const { execSync } = await import("child_process");
          const out = execSync("/usr/bin/openclaw cron list --json", {
            timeout: 15000, encoding: "utf-8",
            env: { ...process.env, HOME: "/root" },
            stdio: ["pipe", "pipe", "pipe"],
          });
          const jsonStart = out.indexOf("[");
          const jsonEnd = out.lastIndexOf("]");
          const json = (jsonStart >= 0 && jsonEnd > jsonStart)
            ? out.slice(jsonStart, jsonEnd + 1) : "[]";
          return respond(new Response(json, { headers: { "Content-Type": "application/json" } }));
        } catch (err) {
          console.error("[cron] list failed:", err);
          return respond(Response.json([]));
        }
      }

      if (path === "/cron" && method === "POST") {
        try {
          const body = await request.json() as Record<string, any>;
          const { execSync } = await import("child_process");
          const args = ["/usr/bin/openclaw", "cron", "add"];
          if (body.name) args.push("--name", body.name);
          if (body.cron) args.push("--cron", body.cron);
          if (body.at) args.push("--at", body.at);
          if (body.tz) args.push("--tz", body.tz);
          if (body.message) args.push("--message", body.message);
          if (body.session) args.push("--session", body.session);
          if (body.announce) args.push("--announce");
          const out = execSync(args.join(" "), {
            timeout: 15000, encoding: "utf-8",
            env: { ...process.env, HOME: "/root" },
            stdio: ["pipe", "pipe", "pipe"],
          });
          return respond(Response.json({ ok: true, output: out.trim() }));
        } catch (err: any) {
          console.error("[cron] add failed:", err);
          return respond(Response.json({ error: err.message }, { status: 500 }));
        }
      }

      if (path.match(/^\/cron\/[\w-]+$/) && method === "DELETE") {
        try {
          const jobId = path.split("/")[2];
          const { execSync } = await import("child_process");
          execSync(`/usr/bin/openclaw cron delete ${jobId}`, {
            timeout: 15000, encoding: "utf-8",
            env: { ...process.env, HOME: "/root" },
            stdio: ["pipe", "pipe", "pipe"],
          });
          return respond(Response.json({ ok: true }));
        } catch (err: any) {
          console.error("[cron] delete failed:", err);
          return respond(Response.json({ error: err.message }, { status: 500 }));
        }
      }

      if (path.match(/^\/cron\/[\w-]+\/run$/) && method === "POST") {
        try {
          const jobId = path.split("/")[2];
          const { execSync } = await import("child_process");
          const out = execSync(`/usr/bin/openclaw cron run ${jobId}`, {
            timeout: 180000, encoding: "utf-8",
            env: { ...process.env, HOME: "/root" },
            stdio: ["pipe", "pipe", "pipe"],
          });
          return respond(Response.json({ ok: true, output: out.trim() }));
        } catch (err: any) {
          console.error("[cron] run failed:", err);
          return respond(Response.json({ error: err.message }, { status: 500 }));
        }
      }

      if (path.match(/^\/cron\/[\w-]+\/runs$/) && method === "GET") {
        try {
          const jobId = path.split("/")[2];
          const { execSync } = await import("child_process");
          const out = execSync(`/usr/bin/openclaw cron runs --id ${jobId} --json`, {
            timeout: 15000, encoding: "utf-8",
            env: { ...process.env, HOME: "/root" },
            stdio: ["pipe", "pipe", "pipe"],
          });
          const jsonStart = out.indexOf("[");
          const jsonEnd = out.lastIndexOf("]");
          const json = (jsonStart >= 0 && jsonEnd > jsonStart)
            ? out.slice(jsonStart, jsonEnd + 1) : "[]";
          return respond(new Response(json, { headers: { "Content-Type": "application/json" } }));
        } catch (err) {
          console.error("[cron] runs failed:", err);
          return respond(Response.json([]));
        }
      }

      return respond(Response.json({ error: "Not found" }, { status: 404 }));
    } catch (err) {
      console.error(`[sidecar] ${method} ${path} error:`, err);
      return respond(Response.json({ error: "Internal error" }, { status: 500 }));
    }
  },
});

console.log(`[patient-sidecar] listening on port ${PORT}`);
