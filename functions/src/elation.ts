/**
 * Elation Health integration — admin-facing OAuth flow + credential storage.
 *
 * Same shape as drchrono.ts / athena.ts. Elation specifics:
 * - Sandbox vs prod hosts differ; admins pick at credential-save time.
 * - OAuth authorization code flow.
 */

import * as admin from "firebase-admin";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {SignJWT, jwtVerify} from "jose";
import {assertAdmin} from "./superAdmins.js";

const ELATION_AUTH_URL_PROD = "https://app.elationemr.com/oauth2/authorize/";
const ELATION_TOKEN_URL_PROD = "https://app.elationemr.com/api/2.0/oauth2/token/";
const ELATION_AUTH_URL_SANDBOX = "https://sandbox.elationemr.com/oauth2/authorize/";
const ELATION_TOKEN_URL_SANDBOX = "https://sandbox.elationemr.com/api/2.0/oauth2/token/";
const CONFIG_DOC = "integrations/elation";
const DEFAULT_SCOPE = "all";

function authUrl(sandbox: boolean) {
  return sandbox ? ELATION_AUTH_URL_SANDBOX : ELATION_AUTH_URL_PROD;
}
function tokenUrl(sandbox: boolean) {
  return sandbox ? ELATION_TOKEN_URL_SANDBOX : ELATION_TOKEN_URL_PROD;
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
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/elationCallback`;
}

async function requireAdmin(auth: { uid: string; token?: { email?: string } } | undefined): Promise<string> {
  await assertAdmin(auth);
  return auth!.uid;
}

// ─── Save credentials ───────────────────────────────────────────────

export const elationSaveCredentials = onCall({}, async (request) => {
  const uid = await requireAdmin(request.auth);
  const clientId = (request.data?.clientId as string || "").trim();
  const clientSecret = (request.data?.clientSecret as string || "").trim();
  const sandbox = Boolean(request.data?.sandbox);
  if (!clientId || !clientSecret) {
    throw new HttpsError("invalid-argument", "clientId and clientSecret required");
  }
  if (clientId.length > 500 || clientSecret.length > 500) {
    throw new HttpsError("invalid-argument", "credentials too long");
  }

  const ref = db().doc(CONFIG_DOC);
  const existing = await ref.get();
  const credsChanged = !existing.exists
    || existing.data()?.clientId !== clientId
    || existing.data()?.clientSecret !== clientSecret
    || existing.data()?.sandbox !== sandbox;

  const base = {
    provider: "elation",
    clientId,
    clientSecret,
    sandbox,
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

  logger.info("[elation] credentials saved", {uid});
  return {ok: true, redirectUri: getRedirectUri()};
});

// ─── Authorize ──────────────────────────────────────────────────────

export const elationAuthorize = onCall({}, async (request) => {
  const uid = await requireAdmin(request.auth);
  const snap = await db().doc(CONFIG_DOC).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Save Elation credentials first");
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
    url: `${authUrl(Boolean(data.sandbox))}?${params}`,
    redirectUri: data.redirectUri || getRedirectUri(),
  };
});

// ─── OAuth callback ─────────────────────────────────────────────────

export const elationCallback = onRequest({cors: true}, async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const oauthError = req.query.error as string | undefined;
  const frontend = process.env.FRONTEND_URL || "http://localhost:3001";
  const back = `${frontend}/admin/agent?tab=integrations`;

  if (oauthError) {
    res.redirect(`${back}&elation_error=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code || !state) {
    res.redirect(`${back}&elation_error=missing_code`);
    return;
  }

  try {
    const {payload} = await jwtVerify(state, stateSecret());
    if (!payload.userId) throw new Error("Missing userId");
  } catch (err: any) {
    logger.warn("[elation] rejected callback with invalid state", {message: err.message});
    res.redirect(`${back}&elation_error=invalid_state`);
    return;
  }

  try {
    const ref = db().doc(CONFIG_DOC);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Elation credentials not configured");
    const cfg = snap.data() as Record<string, unknown>;
    const clientId = cfg.clientId as string | undefined;
    const clientSecret = cfg.clientSecret as string | undefined;
    const redirectUri = (cfg.redirectUri as string) || getRedirectUri();
    const sandbox = Boolean(cfg.sandbox);
    if (!clientId || !clientSecret) throw new Error("clientId/clientSecret missing");

    const tokenRes = await fetch(tokenUrl(sandbox), {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
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

    logger.info("[elation] OAuth connected");
    res.redirect(`${back}&elation_status=connected`);
  } catch (err: any) {
    logger.error("[elation] OAuth callback error:", err.message);
    res.redirect(`${back}&elation_error=${encodeURIComponent(err.message).slice(0, 200)}`);
  }
});

// ─── Enable / disable toggle ────────────────────────────────────────

export const elationSetEnabled = onCall({}, async (request) => {
  await requireAdmin(request.auth);
  const enabled = Boolean(request.data?.enabled);
  await db().doc(CONFIG_DOC).set({
    enabled,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, enabled};
});

// ─── Access-token helper ────────────────────────────────────────────

export async function getElationAccessToken(): Promise<string> {
  const ref = db().doc(CONFIG_DOC);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Elation not connected");
  const data = snap.data() as {
    accessToken?: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
    tokenExpiresAt?: admin.firestore.Timestamp;
    enabled?: boolean;
    sandbox?: boolean;
  };
  if (!data.accessToken) throw new Error("Elation access token missing");
  if (data.enabled === false) throw new Error("Elation integration disabled");

  const expMs = data.tokenExpiresAt ? data.tokenExpiresAt.toMillis() : 0;
  const refreshNeeded = expMs - Date.now() < 5 * 60 * 1000;
  if (!refreshNeeded) return data.accessToken;

  if (!data.refreshToken || !data.clientId || !data.clientSecret) {
    throw new Error("Elation refresh credentials missing");
  }

  const tokenRes = await fetch(tokenUrl(Boolean(data.sandbox)), {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: data.refreshToken,
      client_id: data.clientId,
      client_secret: data.clientSecret,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Elation refresh failed: ${tokenRes.status} ${text.slice(0, 200)}`);
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
