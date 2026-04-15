/**
 * DrChrono integration — admin-facing OAuth flow + credential storage.
 *
 * Design:
 * - Admin enters DrChrono OAuth client id/secret in the UI. Both are
 *   persisted to `integrations/drchrono` (admin-only via firestore.rules;
 *   writes here all go through Admin SDK, bypassing rules).
 * - `drchronoAuthorize` returns the OAuth authorize URL + the redirect URI
 *   the admin must register in DrChrono's developer console.
 * - DrChrono redirects to `drchronoCallback` with `?code=...`; we exchange
 *   for tokens and store them in the same doc.
 * - `drchronoSetEnabled` toggles the `enabled` flag without touching tokens.
 * - The sidecar reads the same doc, refreshes tokens as needed, and proxies
 *   API calls to DrChrono when `enabled === true`.
 */

import * as admin from "firebase-admin";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {SignJWT, jwtVerify} from "jose";

const DRCHRONO_AUTH_URL = "https://drchrono.com/o/authorize/";
const DRCHRONO_TOKEN_URL = "https://drchrono.com/o/token/";
const CONFIG_DOC = "integrations/drchrono";
const DEFAULT_SCOPE = "user:read patients:read patients:write calendar:read clinical:read clinical:write";

/** Signed-state secret for the OAuth round-trip. Reuses the same key the
 *  Google Workspace flow uses for its state JWT — it's an HS256 signing key,
 *  not encryption material, and rotating both flows together is the norm. */
function stateSecret(): Uint8Array {
  const key = process.env.GOOGLE_WORKSPACE_ENCRYPTION_KEY;
  if (!key) throw new HttpsError("failed-precondition", "OAuth state secret not configured");
  return new TextEncoder().encode(key);
}

function db() {
  return admin.firestore();
}

/** The redirect URI DrChrono must call back to. Derived from the project id
 *  so each fork gets its own — admin pastes this into DrChrono's app config.
 *  Region is pinned to match setGlobalOptions() in index.ts. */
const FUNCTIONS_REGION = "us-west1";

function getRedirectUri(): string {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) throw new HttpsError("internal", "GCLOUD_PROJECT not set");
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/drchronoCallback`;
}

async function requireAdmin(auth: { uid: string } | undefined): Promise<string> {
  if (!auth) throw new HttpsError("unauthenticated", "Authentication required");
  const snap = await db().collection("users").doc(auth.uid).get();
  if (!snap.exists || snap.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  return auth.uid;
}

// ─── Save credentials (admin-entered client id/secret) ──────────────

export const drchronoSaveCredentials = onCall({}, async (request) => {
  const uid = await requireAdmin(request.auth);
  const clientId = (request.data?.clientId as string || "").trim();
  const clientSecret = (request.data?.clientSecret as string || "").trim();
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
    || existing.data()?.clientSecret !== clientSecret;

  const base = {
    provider: "drchrono",
    clientId,
    clientSecret,
    redirectUri: getRedirectUri(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    connectedBy: uid,
  };

  if (existing.exists && !credsChanged) {
    await ref.set(base, {merge: true});
  } else {
    // New creds → clear any stale tokens, force re-authorization.
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

  logger.info("[drchrono] credentials saved", {uid});
  return {ok: true, redirectUri: getRedirectUri()};
});

// ─── Authorize (return OAuth URL) ───────────────────────────────────

export const drchronoAuthorize = onCall({}, async (request) => {
  const uid = await requireAdmin(request.auth);
  const snap = await db().doc(CONFIG_DOC).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Save DrChrono credentials first");
  }
  const data = snap.data()!;
  if (!data.clientId) {
    throw new HttpsError("failed-precondition", "clientId missing");
  }

  // Signed state JWT (10 min expiry) so the callback can prove this round-trip
  // was initiated by an authenticated admin. Without this, an attacker can
  // feed an attacker-controlled `?code=` to drchronoCallback directly and
  // hijack the connected DrChrono tenant. Mirrors googleWorkspaceAuthorize.
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
    url: `${DRCHRONO_AUTH_URL}?${params}`,
    redirectUri: data.redirectUri || getRedirectUri(),
  };
});

// ─── OAuth callback ─────────────────────────────────────────────────

export const drchronoCallback = onRequest({cors: true}, async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const oauthError = req.query.error as string | undefined;
  const frontend = process.env.FRONTEND_URL || "http://localhost:3001";
  const back = `${frontend}/admin/agent?tab=integrations`;

  if (oauthError) {
    res.redirect(`${back}&drchrono_error=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code || !state) {
    res.redirect(`${back}&drchrono_error=missing_code`);
    return;
  }

  // Verify the state JWT signed by drchronoAuthorize. Rejects unsolicited
  // callbacks where an attacker supplied their own `?code=` to overwrite
  // the stored DrChrono tokens.
  try {
    const {payload} = await jwtVerify(state, stateSecret());
    if (!payload.userId) throw new Error("Missing userId");
  } catch (err: any) {
    logger.warn("[drchrono] rejected callback with invalid state", {message: err.message});
    res.redirect(`${back}&drchrono_error=invalid_state`);
    return;
  }

  try {
    const ref = db().doc(CONFIG_DOC);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("DrChrono credentials not configured");
    const {clientId, clientSecret, redirectUri} = snap.data() as Record<string, string>;
    if (!clientId || !clientSecret) throw new Error("clientId/clientSecret missing");

    const tokenRes = await fetch(DRCHRONO_TOKEN_URL, {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri || getRedirectUri(),
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
      refresh_token: string;
      expires_in: number;
      scope?: string;
    };
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + tok.expires_in * 1000,
    );

    await ref.set({
      status: "active",
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      tokenExpiresAt: expiresAt,
      scope: tok.scope || DEFAULT_SCOPE,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    logger.info("[drchrono] OAuth connected");
    res.redirect(`${back}&drchrono_status=connected`);
  } catch (err: any) {
    logger.error("[drchrono] OAuth callback error:", err.message);
    res.redirect(`${back}&drchrono_error=${encodeURIComponent(err.message).slice(0, 200)}`);
  }
});

// ─── Enable / disable toggle ────────────────────────────────────────

export const drchronoSetEnabled = onCall({}, async (request) => {
  await requireAdmin(request.auth);
  const enabled = Boolean(request.data?.enabled);
  await db().doc(CONFIG_DOC).set({
    enabled,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, enabled};
});
