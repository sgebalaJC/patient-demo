/**
 * eClinicalWorks integration — admin-facing SMART-on-FHIR OAuth + credential
 * storage.
 *
 * eCW differs from DrChrono/Athena/Elation because:
 * - Every practice has its own FHIR base URL. We don't hard-code it; admin
 *   pastes it (e.g. "https://fhir4.eclinicalworks.com/fhir/r4/<practice-id>").
 * - Auth + token endpoints come from the practice's FHIR
 *   `.well-known/smart-configuration`. To keep this simple, admin pastes
 *   them directly — we don't fetch the discovery doc from Functions.
 * - Scopes follow SMART v2 ("system/Patient.read", etc). Default is broad
 *   read-only; admin can override.
 */

import * as admin from "firebase-admin";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {SignJWT, jwtVerify} from "jose";
import {assertAdmin} from "./superAdmins.js";

const CONFIG_DOC = "integrations/ecw";
const DEFAULT_SCOPE = "launch/patient openid fhirUser system/Patient.read system/Appointment.read system/Encounter.read";

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
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/ecwCallback`;
}

async function requireAdmin(auth: { uid: string; token?: { email?: string } } | undefined): Promise<string> {
  await assertAdmin(auth);
  return auth!.uid;
}

function isHttpsUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

// ─── Save credentials ───────────────────────────────────────────────

export const ecwSaveCredentials = onCall({}, async (request) => {
  const uid = await requireAdmin(request.auth);
  const clientId = (request.data?.clientId as string || "").trim();
  const clientSecret = (request.data?.clientSecret as string || "").trim();
  const fhirBase = (request.data?.fhirBase as string || "").trim().replace(/\/+$/, "");
  const authUrl = (request.data?.authUrl as string || "").trim();
  const tokenUrl = (request.data?.tokenUrl as string || "").trim();
  const scope = (request.data?.scope as string || "").trim() || DEFAULT_SCOPE;

  if (!clientId) throw new HttpsError("invalid-argument", "clientId required");
  if (!fhirBase || !isHttpsUrl(fhirBase)) {
    throw new HttpsError("invalid-argument", "fhirBase must be an https URL");
  }
  if (!authUrl || !isHttpsUrl(authUrl)) {
    throw new HttpsError("invalid-argument", "authUrl must be an https URL");
  }
  if (!tokenUrl || !isHttpsUrl(tokenUrl)) {
    throw new HttpsError("invalid-argument", "tokenUrl must be an https URL");
  }
  if (clientId.length > 500 || clientSecret.length > 500) {
    throw new HttpsError("invalid-argument", "credentials too long");
  }

  const ref = db().doc(CONFIG_DOC);
  const existing = await ref.get();
  const credsChanged = !existing.exists
    || existing.data()?.clientId !== clientId
    || existing.data()?.clientSecret !== clientSecret
    || existing.data()?.fhirBase !== fhirBase
    || existing.data()?.authUrl !== authUrl
    || existing.data()?.tokenUrl !== tokenUrl;

  const base = {
    provider: "ecw",
    clientId,
    clientSecret,
    fhirBase,
    authUrl,
    tokenUrl,
    scope,
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
      connectedAt: admin.firestore.FieldValue.delete(),
    }, {merge: true});
  }

  logger.info("[ecw] credentials saved", {uid});
  return {ok: true, redirectUri: getRedirectUri()};
});

// ─── Authorize ──────────────────────────────────────────────────────

export const ecwAuthorize = onCall({}, async (request) => {
  const uid = await requireAdmin(request.auth);
  const snap = await db().doc(CONFIG_DOC).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Save eCW credentials first");
  }
  const data = snap.data()!;
  if (!data.clientId || !data.authUrl) {
    throw new HttpsError("failed-precondition", "clientId or authUrl missing");
  }

  const state = await new SignJWT({userId: uid})
    .setProtectedHeader({alg: "HS256"})
    .setExpirationTime("10m")
    .sign(stateSecret());

  const params = new URLSearchParams({
    redirect_uri: data.redirectUri || getRedirectUri(),
    response_type: "code",
    client_id: data.clientId as string,
    scope: data.scope || DEFAULT_SCOPE,
    state,
    // SMART-on-FHIR "aud" parameter — the FHIR server the token is for.
    aud: data.fhirBase as string,
  });
  return {
    url: `${data.authUrl}?${params}`,
    redirectUri: data.redirectUri || getRedirectUri(),
  };
});

// ─── OAuth callback ─────────────────────────────────────────────────

export const ecwCallback = onRequest({cors: true}, async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const oauthError = req.query.error as string | undefined;
  const frontend = process.env.FRONTEND_URL || "http://localhost:3001";
  const back = `${frontend}/admin/agent?tab=integrations`;

  if (oauthError) {
    res.redirect(`${back}&ecw_error=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code || !state) {
    res.redirect(`${back}&ecw_error=missing_code`);
    return;
  }

  try {
    const {payload} = await jwtVerify(state, stateSecret());
    if (!payload.userId) throw new Error("Missing userId");
  } catch (err: any) {
    logger.warn("[ecw] rejected callback with invalid state", {message: err.message});
    res.redirect(`${back}&ecw_error=invalid_state`);
    return;
  }

  try {
    const ref = db().doc(CONFIG_DOC);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("eCW credentials not configured");
    const cfg = snap.data() as Record<string, unknown>;
    const clientId = cfg.clientId as string | undefined;
    const clientSecret = cfg.clientSecret as string | undefined;
    const tokenUrl = cfg.tokenUrl as string | undefined;
    const redirectUri = (cfg.redirectUri as string) || getRedirectUri();
    if (!clientId || !tokenUrl) throw new Error("clientId/tokenUrl missing");

    // SMART v2 token exchange. Confidential clients (clientSecret present)
    // send Basic auth; public clients send client_id in the body.
    const headers: Record<string, string> = {"Content-Type": "application/x-www-form-urlencoded"};
    const body: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    };
    if (clientSecret) {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    } else {
      body.client_id = clientId;
    }

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers,
      body: new URLSearchParams(body),
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
      ...(tok.scope ? {grantedScope: tok.scope} : {}),
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    logger.info("[ecw] OAuth connected");
    res.redirect(`${back}&ecw_status=connected`);
  } catch (err: any) {
    logger.error("[ecw] OAuth callback error:", err.message);
    res.redirect(`${back}&ecw_error=${encodeURIComponent(err.message).slice(0, 200)}`);
  }
});

// ─── Enable / disable toggle ────────────────────────────────────────

export const ecwSetEnabled = onCall({}, async (request) => {
  await requireAdmin(request.auth);
  const enabled = Boolean(request.data?.enabled);
  await db().doc(CONFIG_DOC).set({
    enabled,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, enabled};
});

// ─── Access-token helper ────────────────────────────────────────────

export async function getEcwAccessToken(): Promise<string> {
  const ref = db().doc(CONFIG_DOC);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("eCW not connected");
  const data = snap.data() as {
    accessToken?: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
    tokenUrl?: string;
    tokenExpiresAt?: admin.firestore.Timestamp;
    enabled?: boolean;
  };
  if (!data.accessToken) throw new Error("eCW access token missing");
  if (data.enabled === false) throw new Error("eCW integration disabled");

  const expMs = data.tokenExpiresAt ? data.tokenExpiresAt.toMillis() : 0;
  const refreshNeeded = expMs - Date.now() < 5 * 60 * 1000;
  if (!refreshNeeded) return data.accessToken;

  if (!data.refreshToken || !data.clientId || !data.tokenUrl) {
    throw new Error("eCW refresh credentials missing");
  }

  const headers: Record<string, string> = {"Content-Type": "application/x-www-form-urlencoded"};
  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: data.refreshToken,
  };
  if (data.clientSecret) {
    const basic = Buffer.from(`${data.clientId}:${data.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  } else {
    body.client_id = data.clientId;
  }

  const tokenRes = await fetch(data.tokenUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams(body),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`eCW refresh failed: ${tokenRes.status} ${text.slice(0, 200)}`);
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
