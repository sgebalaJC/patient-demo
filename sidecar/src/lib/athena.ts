/**
 * Athenahealth API client — runs on the sidecar, called via /admin-api/athena/*.
 *
 * Mirror of drchrono.ts with three per-vendor differences:
 * - Preview vs prod API base selected from the config doc.
 * - Non-OAuth calls are scoped to a practice (tenant) id — prepended to the
 *   caller-supplied path so agents don't need to know it.
 * - Token refresh uses Basic auth (client_id:client_secret) — same as the
 *   auth-code exchange in athena.ts on the Functions side.
 */

import { getDb } from "./firebase.js";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

const ATHENA_API_PROD = "https://api.athenahealth.com/v1";
const ATHENA_API_PREVIEW = "https://api.preview.platform.athenahealth.com/v1";
const ATHENA_TOKEN_URL_PROD = "https://api.athenahealth.com/oauth2/v1/token";
const ATHENA_TOKEN_URL_PREVIEW = "https://api.preview.platform.athenahealth.com/oauth2/v1/token";
const CONFIG_DOC = "integrations/athena";

interface AthenaConfig {
  enabled?: boolean;
  status?: string;
  clientId?: string;
  clientSecret?: string;
  practiceId?: string;
  preview?: boolean;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Timestamp;
  scope?: string;
}

function apiBase(cfg: AthenaConfig): string {
  return cfg.preview ? ATHENA_API_PREVIEW : ATHENA_API_PROD;
}

function tokenUrl(cfg: AthenaConfig): string {
  return cfg.preview ? ATHENA_TOKEN_URL_PREVIEW : ATHENA_TOKEN_URL_PROD;
}

async function loadConfig(): Promise<AthenaConfig> {
  const snap = await getDb().doc(CONFIG_DOC).get();
  if (!snap.exists) throw new Error("Athena not configured");
  return snap.data() as AthenaConfig;
}

export async function assertAthenaReady(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.enabled) throw new Error("Athena integration is disabled");
  if (!cfg.accessToken) {
    throw new Error("Athena not authorized — complete the OAuth flow in the admin UI");
  }
  if (!cfg.practiceId) {
    throw new Error("Athena practiceId missing — re-save credentials in the admin UI");
  }
}

// ─── Token management ───────────────────────────────────────────────

export async function getAthenaAccessToken(): Promise<string> {
  const cfg = await loadConfig();
  if (!cfg.enabled) throw new Error("Athena integration is disabled");
  if (!cfg.accessToken) throw new Error("Athena not authorized");

  const expiresAtMs = cfg.tokenExpiresAt ? cfg.tokenExpiresAt.toMillis() : 0;
  if (Date.now() > expiresAtMs - 5 * 60 * 1000) {
    return refreshAccessToken(cfg);
  }
  return cfg.accessToken;
}

async function refreshAccessToken(cfg: AthenaConfig): Promise<string> {
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new Error("Athena refresh prerequisites missing");
  }
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch(tokenUrl(cfg), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Athena token refresh failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  const expiresAt = Timestamp.fromMillis(Date.now() + data.expires_in * 1000);
  await getDb().doc(CONFIG_DOC).update({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? cfg.refreshToken,
    tokenExpiresAt: expiresAt,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return data.access_token;
}

// ─── Generic proxy with 429 backoff ─────────────────────────────────

const PROXY_TIMEOUT_MS = 60_000;
const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024;

/** Proxy an arbitrary Athena REST call. Path is the portion after the
 *  practice id — e.g. "patients", "appointments/booked". The practice id
 *  is injected from config so callers never see it. */
export async function proxyAthena(
  method: string,
  path: string,
  searchParams: URLSearchParams,
  request: Request,
): Promise<Response> {
  if (!/^[a-zA-Z0-9_\-/]+$/.test(path) || path.includes("..")) {
    return Response.json({error: "Invalid path"}, {status: 400});
  }

  const cfg = await loadConfig();
  const qs = searchParams.toString();
  const url = `${apiBase(cfg)}/${cfg.practiceId}/${path}${qs ? "?" + qs : ""}`;

  let bodyBuffer: ArrayBuffer | string | undefined;
  const upperMethod = method.toUpperCase();
  if (upperMethod !== "GET" && upperMethod !== "DELETE" && upperMethod !== "HEAD") {
    const ct = request.headers.get("content-type") || "application/json";
    if (ct.includes("json")) {
      const text = await request.text();
      if (text.length > MAX_PROXY_BODY_BYTES) {
        return Response.json({error: "Request body too large"}, {status: 413});
      }
      bodyBuffer = text;
    } else {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > MAX_PROXY_BODY_BYTES) {
        return Response.json({error: "Request body too large"}, {status: 413});
      }
      bodyBuffer = buf;
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = await getAthenaAccessToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
    try {
      const init: RequestInit = {
        method: upperMethod,
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
        redirect: "error",
      };
      if (bodyBuffer !== undefined) {
        const ct = request.headers.get("content-type") || "application/json";
        (init.headers as Record<string, string>)["Content-Type"] = ct;
        init.body = bodyBuffer as any;
      }
      const res = await fetch(url, init);
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }
      const resCT = res.headers.get("content-type") || "application/json";
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { "Content-Type": resCT },
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return Response.json({error: "Athena rate-limited after retries"}, {status: 503});
}
