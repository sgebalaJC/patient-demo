/**
 * DrChrono API client — runs on the sidecar, called via /admin-api/drchrono/*.
 *
 * Credentials come from the `integrations/drchrono` Firestore doc, written by
 * Cloud Functions (drchronoSaveCredentials + drchronoCallback). Tokens are
 * auto-refreshed when within 5 minutes of expiry.
 *
 * Security posture (ported from upstream showmd hardening):
 * - Access gated by `integrations/drchrono.enabled === true`
 * - Admin-only route (sidecar enforces via isAdminOnlyRoute)
 * - 429 rate-limit retry with Retry-After respect
 * - No PII logged (UIDs/roles only)
 */

import { getDb } from "./firebase.js";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

const DRCHRONO_API = "https://app.drchrono.com/api";
const DRCHRONO_TOKEN_URL = "https://drchrono.com/o/token/";
const CONFIG_DOC = "integrations/drchrono";

interface DrChronoConfig {
  enabled?: boolean;
  status?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Timestamp;
  scope?: string;
}

async function loadConfig(): Promise<DrChronoConfig> {
  const snap = await getDb().doc(CONFIG_DOC).get();
  if (!snap.exists) throw new Error("DrChrono not configured");
  return snap.data() as DrChronoConfig;
}

/** Cheap gate for routes: verifies the integration is connected + enabled. */
export async function assertDrChronoReady(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.enabled) throw new Error("DrChrono integration is disabled");
  if (!cfg.accessToken || !cfg.refreshToken) {
    throw new Error("DrChrono not authorized — complete the OAuth flow in the admin UI");
  }
}

// ─── Token management ───────────────────────────────────────────────

export async function getDrChronoAccessToken(): Promise<string> {
  const cfg = await loadConfig();
  if (!cfg.enabled) throw new Error("DrChrono integration is disabled");
  if (!cfg.accessToken || !cfg.refreshToken) throw new Error("DrChrono not authorized");

  const expiresAtMs = cfg.tokenExpiresAt ? cfg.tokenExpiresAt.toMillis() : 0;
  if (Date.now() > expiresAtMs - 5 * 60 * 1000) {
    return refreshAccessToken(cfg);
  }
  return cfg.accessToken;
}

async function refreshAccessToken(cfg: DrChronoConfig): Promise<string> {
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new Error("DrChrono refresh prerequisites missing");
  }
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch(DRCHRONO_TOKEN_URL, {
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
    throw new Error(`DrChrono token refresh failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const expiresAt = Timestamp.fromMillis(Date.now() + data.expires_in * 1000);
  await getDb().doc(CONFIG_DOC).update({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenExpiresAt: expiresAt,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return data.access_token;
}

// ─── Generic proxy with 429 backoff ─────────────────────────────────

const PROXY_TIMEOUT_MS = 60_000;
const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024;

/** Proxy an arbitrary DrChrono REST call. Path is after /api/ — e.g.
 *  "patients", "documents/12345". Query params are forwarded verbatim. */
export async function proxyDrChrono(
  method: string,
  path: string,
  searchParams: URLSearchParams,
  request: Request,
): Promise<Response> {
  // Path sanitization: allow only segments of [a-zA-Z0-9_-] separated by "/".
  // This blocks "..", absolute overrides, and scheme smuggling.
  if (!/^[a-zA-Z0-9_\-/]+$/.test(path) || path.includes("..")) {
    return Response.json({error: "Invalid path"}, {status: 400});
  }

  const qs = searchParams.toString();
  const url = `${DRCHRONO_API}/${path}${qs ? "?" + qs : ""}`;

  // Buffer and size-cap the request body before sending to DrChrono.
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
    const token = await getDrChronoAccessToken();
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
  return Response.json({error: "DrChrono rate-limited after retries"}, {status: 503});
}
