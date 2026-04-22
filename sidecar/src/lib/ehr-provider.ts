/**
 * EHR provider factory — collapses the shared shape across DrChrono /
 * Athena / Elation / eClinicalWorks into a single construction point.
 *
 * Responsibilities of the factory:
 * - Load config from Firestore
 * - Enforce enabled + authorized preconditions
 * - Refresh access tokens within a 5-minute expiry buffer
 * - Proxy arbitrary REST calls with path sanitization, size caps, 429 retry
 *
 * Per-vendor spec supplies: API base, token URL, token-refresh auth style,
 * optional extra readiness checks (practice id, fhir base), optional path
 * builder (for vendors that need a fixed prefix), optional accept header
 * (eCW returns application/fhir+json).
 */

import { getDb } from "./firebase.js";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

export interface BaseEhrConfig {
  enabled?: boolean;
  status?: string;
  clientId?: string;
  /** Populated by the factory at load time by merging the private subdoc. */
  clientSecret?: string;
  /** Populated by the factory at load time by merging the private subdoc. */
  accessToken?: string;
  /** Populated by the factory at load time by merging the private subdoc. */
  refreshToken?: string;
  /** Populated by the factory at load time by merging the private subdoc. */
  tokenExpiresAt?: Timestamp;
  scope?: string;
}

interface PrivateCredentials {
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Timestamp;
}

export interface TokenRefreshAuth {
  /** Headers to merge on the refresh request (e.g. Basic auth). */
  headers: Record<string, string>;
  /** Extra body params (e.g. client_id / client_secret for body-auth flows). */
  bodyExtras: Record<string, string>;
}

export interface EhrProviderSpec<C extends BaseEhrConfig> {
  /** Used in error messages, e.g. "DrChrono not configured". */
  providerName: string;
  /** Firestore doc path, e.g. "integrations/drchrono". */
  configDoc: string;
  /** The API base that the proxy concatenates `path` onto. */
  resolveApiBase: (cfg: C) => string;
  /** OAuth token endpoint used for refresh. */
  resolveTokenUrl: (cfg: C) => string;
  /** How the refresh request authenticates the client. */
  tokenRefreshAuth: (cfg: C) => TokenRefreshAuth;
  /** Additional invariants beyond enabled + accessToken. Throw on failure. */
  extraReadyChecks?: (cfg: C) => void;
  /** Override URL construction entirely (e.g. Athena prepends practiceId). */
  buildUrl?: (cfg: C, path: string, qs: string) => string;
  /** Accept header. Default "application/json"; eCW sets "application/fhir+json". */
  acceptHeader?: string;
}

export interface EhrProvider<C extends BaseEhrConfig> {
  loadConfig: () => Promise<C>;
  assertReady: () => Promise<void>;
  getAccessToken: () => Promise<string>;
  proxy: (method: string, path: string, searchParams: URLSearchParams, request: Request) => Promise<Response>;
}

const PROXY_TIMEOUT_MS = 60_000;
const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024;

export function makeEhrProvider<C extends BaseEhrConfig>(spec: EhrProviderSpec<C>): EhrProvider<C> {
  const accept = spec.acceptHeader ?? "application/json";
  const privateCredsPath = `${spec.configDoc}/private/credentials`;

  async function loadConfig(): Promise<C> {
    const db = getDb();
    const [publicSnap, privateSnap] = await Promise.all([
      db.doc(spec.configDoc).get(),
      db.doc(privateCredsPath).get(),
    ]);
    if (!publicSnap.exists) throw new Error(`${spec.providerName} not configured`);
    const pub = publicSnap.data() as Record<string, unknown>;
    const priv = (privateSnap.exists ? (privateSnap.data() as PrivateCredentials) : {}) ?? {};
    return { ...pub, ...priv } as C;
  }

  async function assertReady(): Promise<void> {
    const cfg = await loadConfig();
    if (!cfg.enabled) throw new Error(`${spec.providerName} integration is disabled`);
    if (!cfg.accessToken) {
      throw new Error(`${spec.providerName} not authorized — complete the OAuth flow in the admin UI`);
    }
    spec.extraReadyChecks?.(cfg);
  }

  async function getAccessToken(): Promise<string> {
    const cfg = await loadConfig();
    if (!cfg.enabled) throw new Error(`${spec.providerName} integration is disabled`);
    if (!cfg.accessToken) throw new Error(`${spec.providerName} not authorized`);

    const expiresAtMs = cfg.tokenExpiresAt ? cfg.tokenExpiresAt.toMillis() : 0;
    if (Date.now() > expiresAtMs - 5 * 60 * 1000) {
      return refreshAccessToken(cfg);
    }
    return cfg.accessToken;
  }

  async function refreshAccessToken(cfg: C): Promise<string> {
    if (!cfg.refreshToken) throw new Error(`${spec.providerName} refresh prerequisites missing`);
    const { headers, bodyExtras } = spec.tokenRefreshAuth(cfg);
    const res = await fetch(spec.resolveTokenUrl(cfg), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cfg.refreshToken,
        ...bodyExtras,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${spec.providerName} token refresh failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    const expiresAt = Timestamp.fromMillis(Date.now() + data.expires_in * 1000);
    const db = getDb();
    // Write refreshed tokens to the private subdoc — secrets never touch the
    // public doc, where even super-admins read from the browser.
    await db.doc(privateCredsPath).set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? cfg.refreshToken,
      tokenExpiresAt: expiresAt,
    }, { merge: true });
    await db.doc(spec.configDoc).set({
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return data.access_token;
  }

  async function proxy(
    method: string,
    path: string,
    searchParams: URLSearchParams,
    request: Request,
  ): Promise<Response> {
    if (!/^[a-zA-Z0-9_\-/]+$/.test(path) || path.includes("..")) {
      return Response.json({ error: "Invalid path" }, { status: 400 });
    }

    const cfg = await loadConfig();
    const qs = searchParams.toString();
    const url = spec.buildUrl
      ? spec.buildUrl(cfg, path, qs)
      : `${spec.resolveApiBase(cfg)}/${path}${qs ? "?" + qs : ""}`;

    let bodyBuffer: ArrayBuffer | string | undefined;
    const upperMethod = method.toUpperCase();
    if (upperMethod !== "GET" && upperMethod !== "DELETE" && upperMethod !== "HEAD") {
      const ct = request.headers.get("content-type") || accept;
      if (ct.includes("json")) {
        const text = await request.text();
        if (text.length > MAX_PROXY_BODY_BYTES) {
          return Response.json({ error: "Request body too large" }, { status: 413 });
        }
        bodyBuffer = text;
      } else {
        const buf = await request.arrayBuffer();
        if (buf.byteLength > MAX_PROXY_BODY_BYTES) {
          return Response.json({ error: "Request body too large" }, { status: 413 });
        }
        bodyBuffer = buf;
      }
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const token = await getAccessToken();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
      try {
        const init: RequestInit = {
          method: upperMethod,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: accept,
          },
          signal: ctrl.signal,
          redirect: "error",
        };
        if (bodyBuffer !== undefined) {
          const ct = request.headers.get("content-type") || accept;
          (init.headers as Record<string, string>)["Content-Type"] = ct;
          init.body = bodyBuffer as any;
        }
        const res = await fetch(url, init);
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("Retry-After")) || 2 ** attempt;
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }
        const resCT = res.headers.get("content-type") || accept;
        const body = await res.text();
        return new Response(body, {
          status: res.status,
          headers: { "Content-Type": resCT },
        });
      } finally {
        clearTimeout(timer);
      }
    }
    return Response.json({ error: `${spec.providerName} rate-limited after retries` }, { status: 503 });
  }

  return { loadConfig, assertReady, getAccessToken, proxy };
}
