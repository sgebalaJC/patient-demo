/**
 * Athenahealth integration — admin-facing OAuth flow + credential storage.
 *
 * Same shape as the DrChrono integration (see drchrono.ts). Differences:
 * - Athena issues separate credentials for the "preview1" sandbox vs the
 *   "v1" production tenant; admins pick one at credential-save time.
 * - Every non-OAuth API call is scoped to a practice (tenant) id — stored
 *   on the integration doc as `practiceId` and included in proxy paths by
 *   the sidecar.
 * - Token refresh uses Basic auth (client_id:client_secret), not body creds.
 */

import * as admin from "firebase-admin";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {SignJWT, jwtVerify} from "jose";
import {assertAdmin} from "./superAdmins.js";

const ATHENA_AUTH_URL_PROD = "https://api.athenahealth.com/oauth2/v1/authorize";
const ATHENA_TOKEN_URL_PROD = "https://api.athenahealth.com/oauth2/v1/token";
const ATHENA_AUTH_URL_PREVIEW = "https://api.preview.platform.athenahealth.com/oauth2/v1/authorize";
const ATHENA_TOKEN_URL_PREVIEW = "https://api.preview.platform.athenahealth.com/oauth2/v1/token";
const CONFIG_DOC = "integrations/athena";
const DEFAULT_SCOPE = "athena/service/Athenanet.MDP.* system/Patient.read system/Appointment.read";

function authUrl(preview: boolean) {
  return preview ? ATHENA_AUTH_URL_PREVIEW : ATHENA_AUTH_URL_PROD;
}
function tokenUrl(preview: boolean) {
  return preview ? ATHENA_TOKEN_URL_PREVIEW : ATHENA_TOKEN_URL_PROD;
}

function stateSecret(): Uint8Array {
  const key = process.env.GOOGLE_WORKSPACE_ENCRYPTION_KEY;
  if (!key) throw new HttpsError("failed-precondition", "OAuth state secret not configured");
  return new TextEncoder().encode(key);
}

function db() {
  return admin.firestore();
}

const FUNCTIONS_REGION = "us-west1";

function getRedirectUri(): string {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) throw new HttpsError("internal", "GCLOUD_PROJECT not set");
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/athenaCallback`;
}

async function requireAdmin(auth: { uid: string; token?: { email?: string } } | undefined): Promise<string> {
  await assertAdmin(auth);
  return auth!.uid;
}

// ─── Save credentials ───────────────────────────────────────────────

export const athenaSaveCredentials = onCall({}, async (request) => {
  const uid = await requireAdmin(request.auth);
  const clientId = (request.data?.clientId as string || "").trim();
  const clientSecret = (request.data?.clientSecret as string || "").trim();
  const practiceId = (request.data?.practiceId as string || "").trim();
  const preview = Boolean(request.data?.preview);
  if (!clientId || !clientSecret) {
    throw new HttpsError("invalid-argument", "clientId and clientSecret required");
  }
  if (!practiceId || !/^[0-9]+$/.test(practiceId)) {
    throw new HttpsError("invalid-argument", "practiceId must be a numeric tenant id");
  }
  if (clientId.length > 500 || clientSecret.length > 500) {
    throw new HttpsError("invalid-argument", "credentials too long");
  }

  const ref = db().doc(CONFIG_DOC);
  const existing = await ref.get();
  const credsChanged = !existing.exists
    || existing.data()?.clientId !== clientId
    || existing.data()?.clientSecret !== clientSecret
    || existing.data()?.preview !== preview;

  const base = {
    provider: "athena",
    clientId,
    clientSecret,
    practiceId,
    preview,
    redirectUri: getRedirectUri(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    connectedBy: uid,
  };

  if (existing.exists && !credsChanged) {
    await ref.set(base, {merge: true});
  } else {
    await ref.set({
      ...base,
      status: "not-authorized",
      enabled: existing.data()?.enabled ?? false,
      accessToken: admin.firestore.FieldValue.delete(),
      refreshToken: admin.firestore.FieldValue.delete(),
      tokenExpiresAt: admin.firestore.FieldValue.delete(),
      scope: admin.firestore.FieldValue.delete(),
      connectedAt: admin.firestore.FieldValue.delete(),
    }, {merge: true});
  }

  logger.info("[athena] credentials saved", {uid});
  return {ok: true, redirectUri: getRedirectUri()};
});

// ─── Authorize ──────────────────────────────────────────────────────

export const athenaAuthorize = onCall({}, async (request) => {
  const uid = await requireAdmin(request.auth);
  const snap = await db().doc(CONFIG_DOC).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Save Athena credentials first");
  }
  const data = snap.data()!;
  if (!data.clientId) {
    throw new HttpsError("failed-precondition", "clientId missing");
  }

  const state = await new SignJWT({userId: uid})
    .setProtectedHeader({alg: "HS256"})
    .setExpirationTime("10m")
    .sign(stateSecret());

  const params = new URLSearchParams({
    redirect_uri: data.redirectUri || getRedirectUri(),
    response_type: "code",
    client_id: data.clientId as string,
    scope: DEFAULT_SCOPE,
    state,
  });
  return {
    url: `${authUrl(Boolean(data.preview))}?${params}`,
    redirectUri: data.redirectUri || getRedirectUri(),
  };
});

// ─── OAuth callback ─────────────────────────────────────────────────

export const athenaCallback = onRequest({cors: true}, async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const oauthError = req.query.error as string | undefined;
  const frontend = process.env.FRONTEND_URL || "http://localhost:3001";
  const back = `${frontend}/admin/agent?tab=integrations`;

  if (oauthError) {
    res.redirect(`${back}&athena_error=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code || !state) {
    res.redirect(`${back}&athena_error=missing_code`);
    return;
  }

  try {
    const {payload} = await jwtVerify(state, stateSecret());
    if (!payload.userId) throw new Error("Missing userId");
  } catch (err: any) {
    logger.warn("[athena] rejected callback with invalid state", {message: err.message});
    res.redirect(`${back}&athena_error=invalid_state`);
    return;
  }

  try {
    const ref = db().doc(CONFIG_DOC);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Athena credentials not configured");
    const cfg = snap.data() as Record<string, unknown>;
    const clientId = cfg.clientId as string | undefined;
    const clientSecret = cfg.clientSecret as string | undefined;
    const redirectUri = (cfg.redirectUri as string) || getRedirectUri();
    const preview = Boolean(cfg.preview);
    if (!clientId || !clientSecret) throw new Error("clientId/clientSecret missing");

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const tokenRes = await fetch(tokenUrl(preview), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} ${text.slice(0, 300)}`);
    }
    const tok = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + tok.expires_in * 1000,
    );

    await ref.set({
      status: "active",
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? null,
      tokenExpiresAt: expiresAt,
      scope: tok.scope || DEFAULT_SCOPE,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    logger.info("[athena] OAuth connected");
    res.redirect(`${back}&athena_status=connected`);
  } catch (err: any) {
    logger.error("[athena] OAuth callback error:", err.message);
    res.redirect(`${back}&athena_error=${encodeURIComponent(err.message).slice(0, 200)}`);
  }
});

// ─── Enable / disable toggle ────────────────────────────────────────

export const athenaSetEnabled = onCall({}, async (request) => {
  await requireAdmin(request.auth);
  const enabled = Boolean(request.data?.enabled);
  await db().doc(CONFIG_DOC).set({
    enabled,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, enabled};
});

// ─── Access-token helper for server-side callers ─────────────────────

export async function getAthenaAccessToken(): Promise<string> {
  const ref = db().doc(CONFIG_DOC);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Athena not connected");
  const data = snap.data() as {
    accessToken?: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
    tokenExpiresAt?: admin.firestore.Timestamp;
    enabled?: boolean;
    preview?: boolean;
  };
  if (!data.accessToken) throw new Error("Athena access token missing");
  if (data.enabled === false) throw new Error("Athena integration disabled");

  const expMs = data.tokenExpiresAt ? data.tokenExpiresAt.toMillis() : 0;
  const refreshNeeded = expMs - Date.now() < 5 * 60 * 1000;
  if (!refreshNeeded) return data.accessToken;

  if (!data.refreshToken || !data.clientId || !data.clientSecret) {
    throw new Error("Athena refresh credentials missing");
  }

  const basic = Buffer.from(`${data.clientId}:${data.clientSecret}`).toString("base64");
  const tokenRes = await fetch(tokenUrl(Boolean(data.preview)), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: data.refreshToken,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Athena refresh failed: ${tokenRes.status} ${text.slice(0, 200)}`);
  }
  const tok = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  await ref.set({
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? data.refreshToken,
    tokenExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + tok.expires_in * 1000),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return tok.access_token;
}
