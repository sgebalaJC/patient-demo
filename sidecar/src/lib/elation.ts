/**
 * Elation Health API client — runs on the sidecar, called via /admin-api/elation/*.
 * Mirrors sidecar/src/lib/drchrono.ts; sandbox vs prod base selected per config.
 */

import { getDb } from "./firebase.js";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

const ELATION_API_PROD = "https://app.elationemr.com/api/2.0";
const ELATION_API_SANDBOX = "https://sandbox.elationemr.com/api/2.0";
const ELATION_TOKEN_URL_PROD = "https://app.elationemr.com/api/2.0/oauth2/token/";
const ELATION_TOKEN_URL_SANDBOX = "https://sandbox.elationemr.com/api/2.0/oauth2/token/";
const CONFIG_DOC = "integrations/elation";

interface ElationConfig {
  enabled?: boolean;
  status?: string;
  clientId?: string;
  clientSecret?: string;
  sandbox?: boolean;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Timestamp;
  scope?: string;
}

function apiBase(cfg: ElationConfig) {
  return cfg.sandbox ? ELATION_API_SANDBOX : ELATION_API_PROD;
}
function tokenUrl(cfg: ElationConfig) {
  return cfg.sandbox ? ELATION_TOKEN_URL_SANDBOX : ELATION_TOKEN_URL_PROD;
}

async function loadConfig(): Promise<ElationConfig> {
  const snap = await getDb().doc(CONFIG_DOC).get();
  if (!snap.exists) throw new Error("Elation not configured");
  return snap.data() as ElationConfig;
}

export async function assertElationReady(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.enabled) throw new Error("Elation integration is disabled");
  if (!cfg.accessToken) {
    throw new Error("Elation not authorized — complete the OAuth flow in the admin UI");
  }
}

// ─── Token management ───────────────────────────────────────────────

export async function getElationAccessToken(): Promise<string> {
  const cfg = await loadConfig();
  if (!cfg.enabled) throw new Error("Elation integration is disabled");
  if (!cfg.accessToken) throw new Error("Elation not authorized");

  const expiresAtMs = cfg.tokenExpiresAt ? cfg.tokenExpiresAt.toMillis() : 0;
  if (Date.now() > expiresAtMs - 5 * 60 * 1000) {
    return refreshAccessToken(cfg);
  }
  return cfg.accessToken;
}

async function refreshAccessToken(cfg: ElationConfig): Promise<string> {
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new Error("Elation refresh prerequisites missing");
  }
  const res = await fetch(tokenUrl(cfg), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Elation token refresh failed: ${res.status} ${text.slice(0, 200)}`);
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

export async function proxyElation(
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
  const url = `${apiBase(cfg)}/${path}${qs ? "?" + qs : ""}`;

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
    const token = await getElationAccessToken();
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
  return Response.json({error: "Elation rate-limited after retries"}, {status: 503});
}
