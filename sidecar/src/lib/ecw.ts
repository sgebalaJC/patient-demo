/**
 * eClinicalWorks (SMART-on-FHIR) API client — runs on the sidecar,
 * called via /admin-api/ecw/*.
 *
 * FHIR base + auth/token URLs are admin-entered per practice (unlike
 * DrChrono/Athena/Elation which have fixed vendor hosts). The sidecar
 * refreshes tokens and proxies FHIR calls; content-type is preserved so
 * `application/fhir+json` flows through unchanged.
 */

import { getDb } from "./firebase.js";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

const CONFIG_DOC = "integrations/ecw";

interface EcwConfig {
  enabled?: boolean;
  status?: string;
  clientId?: string;
  clientSecret?: string;
  fhirBase?: string;
  authUrl?: string;
  tokenUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Timestamp;
  scope?: string;
  grantedScope?: string;
}

async function loadConfig(): Promise<EcwConfig> {
  const snap = await getDb().doc(CONFIG_DOC).get();
  if (!snap.exists) throw new Error("eCW not configured");
  return snap.data() as EcwConfig;
}

export async function assertEcwReady(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.enabled) throw new Error("eCW integration is disabled");
  if (!cfg.accessToken) {
    throw new Error("eCW not authorized — complete the OAuth flow in the admin UI");
  }
  if (!cfg.fhirBase) {
    throw new Error("eCW fhirBase missing — re-save credentials in the admin UI");
  }
}

// ─── Token management ───────────────────────────────────────────────

export async function getEcwAccessToken(): Promise<string> {
  const cfg = await loadConfig();
  if (!cfg.enabled) throw new Error("eCW integration is disabled");
  if (!cfg.accessToken) throw new Error("eCW not authorized");

  const expiresAtMs = cfg.tokenExpiresAt ? cfg.tokenExpiresAt.toMillis() : 0;
  if (Date.now() > expiresAtMs - 5 * 60 * 1000) {
    return refreshAccessToken(cfg);
  }
  return cfg.accessToken;
}

async function refreshAccessToken(cfg: EcwConfig): Promise<string> {
  if (!cfg.clientId || !cfg.refreshToken || !cfg.tokenUrl) {
    throw new Error("eCW refresh prerequisites missing");
  }
  const headers: Record<string, string> = {"Content-Type": "application/x-www-form-urlencoded"};
  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: cfg.refreshToken,
  };
  if (cfg.clientSecret) {
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  } else {
    body.client_id = cfg.clientId;
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eCW token refresh failed: ${res.status} ${text.slice(0, 200)}`);
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

// ─── Generic FHIR proxy with 429 backoff ────────────────────────────

const PROXY_TIMEOUT_MS = 60_000;
const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024;

export async function proxyEcw(
  method: string,
  path: string,
  searchParams: URLSearchParams,
  request: Request,
): Promise<Response> {
  // FHIR paths use PascalCase resource names (e.g. "Patient/123"), so we
  // allow the same charset as the other proxies — no "$" or ":" for now.
  if (!/^[a-zA-Z0-9_\-/]+$/.test(path) || path.includes("..")) {
    return Response.json({error: "Invalid path"}, {status: 400});
  }

  const cfg = await loadConfig();
  if (!cfg.fhirBase) {
    return Response.json({error: "fhirBase not configured"}, {status: 500});
  }
  const qs = searchParams.toString();
  const url = `${cfg.fhirBase.replace(/\/+$/, "")}/${path}${qs ? "?" + qs : ""}`;

  let bodyBuffer: ArrayBuffer | string | undefined;
  const upperMethod = method.toUpperCase();
  if (upperMethod !== "GET" && upperMethod !== "DELETE" && upperMethod !== "HEAD") {
    const ct = request.headers.get("content-type") || "application/fhir+json";
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
    const token = await getEcwAccessToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
    try {
      const init: RequestInit = {
        method: upperMethod,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/fhir+json",
        },
        signal: ctrl.signal,
        redirect: "error",
      };
      if (bodyBuffer !== undefined) {
        const ct = request.headers.get("content-type") || "application/fhir+json";
        (init.headers as Record<string, string>)["Content-Type"] = ct;
        init.body = bodyBuffer as any;
      }
      const res = await fetch(url, init);
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }
      const resCT = res.headers.get("content-type") || "application/fhir+json";
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { "Content-Type": resCT },
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return Response.json({error: "eCW rate-limited after retries"}, {status: 503});
}
