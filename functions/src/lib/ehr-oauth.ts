/**
 * EHR OAuth factory — admin-facing OAuth flow + credential storage.
 *
 * Collapses the shared shape across all EHR integrations (DrChrono /
 * Athena / Elation / eClinicalWorks). Per-vendor specs supply only the
 * URLs, scope defaults, extra-field validation, token-auth mode, and
 * post-authorize response shape.
 *
 * Super-admin gating: every callable here enforces `assertSuperAdmin`.
 * Integrations hold platform-level credentials and must not be editable by
 * practice admins. Firestore writes go through Admin SDK (bypassing
 * rules), so the only surface is these callables + direct Firestore
 * reads — both are gated.
 */

import * as admin from "firebase-admin";
import {onCall, onRequest, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {SignJWT, jwtVerify} from "jose";
import {assertSuperAdmin} from "../superAdmins.js";
import {
  getEhrClientSecret,
  setEhrClientSecret,
  deleteEhrClientSecret,
} from "./secret-manager.js";
import {syncIntegrationSkill, SIDECAR_URL_SECRET, SIDECAR_API_KEY_SECRET} from "./sidecar.js";

const FUNCTIONS_REGION = "us-west1";

function stateSecret(): Uint8Array {
  const key = process.env.GOOGLE_WORKSPACE_ENCRYPTION_KEY;
  if (!key) throw new HttpsError("failed-precondition", "OAuth state secret not configured");
  return new TextEncoder().encode(key);
}

function db() {
  return admin.firestore();
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export interface TokenExchangeAuth {
  headers: Record<string, string>;
  bodyExtras: Record<string, string>;
}

export interface EhrOAuthSpec {
  /** Machine-readable provider id (e.g. "drchrono"). */
  provider: string;
  /** Firestore doc path, e.g. "integrations/drchrono". */
  configDoc: string;
  /** Exported Cloud Function name for the OAuth callback (e.g. "drchronoCallback"). */
  callbackName: string;
  /** Default OAuth scope if one isn't explicitly stored on the integration. */
  defaultScope: string;

  /** OAuth authorize endpoint. May depend on config (sandbox/preview). */
  resolveAuthUrl: (cfg: any) => string;
  /** OAuth token endpoint. May depend on config. */
  resolveTokenUrl: (cfg: any) => string;

  /**
   * How the token exchange (auth code → token) and refresh authenticate
   * the client. Default is body creds (client_id/client_secret in form body).
   */
  tokenExchangeAuth?: (cfg: any) => TokenExchangeAuth;

  /**
   * Validate and normalize extra vendor-specific fields at save-credentials
   * time (e.g. Athena practiceId, eCW fhirBase/authUrl/tokenUrl). Throws
   * HttpsError on invalid input. Returns fields to merge into the doc.
   */
  validateExtraFields?: (data: any) => Record<string, unknown>;

  /** Extra keys (beyond clientId/clientSecret) that invalidate tokens when changed. */
  credsChangeKeys?: string[];

  /** Extra query params on the authorize URL (e.g. SMART `aud=<fhirBase>`). */
  extraAuthorizeParams?: (cfg: any) => Record<string, string>;

  /**
   * Merge extra fields into the post-callback write. Default is
   * `{ scope: tok.scope || defaultScope }`. eCW overrides to store
   * `grantedScope` separately from the configured `scope`.
   */
  resolvePostAuthFields?: (tok: OAuthTokenResponse, defaultScope: string) => Record<string, unknown>;
}

export interface EhrOAuth {
  saveCredentials: ReturnType<typeof onCall>;
  authorize: ReturnType<typeof onCall>;
  callback: ReturnType<typeof onRequest>;
  setEnabled: ReturnType<typeof onCall>;
  disconnect: ReturnType<typeof onCall>;
  /** Server-side helper — reads the access token, refreshing if near expiry. */
  getAccessToken: () => Promise<string>;
}

function defaultTokenExchangeAuth(cfg: any): TokenExchangeAuth {
  return {
    headers: {},
    bodyExtras: {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    },
  };
}

function defaultPostAuthFields(
  tok: OAuthTokenResponse,
  defaultScope: string,
): Record<string, unknown> {
  return { scope: tok.scope || defaultScope };
}

function getRedirectUri(callbackName: string): string {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) throw new HttpsError("internal", "GCLOUD_PROJECT not set");
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/${callbackName}`;
}

/**
 * Secrets subcollection path: `integrations/{provider}/private/credentials`.
 * Firestore rules deny ALL client access — only Admin SDK (bypassing rules)
 * can read or write. Super-admin's browser never fetches this doc, so a
 * compromised session can't exfiltrate tokens.
 */
function privateCredsRef(configDoc: string) {
  return admin.firestore().doc(`${configDoc}/private/credentials`);
}

/**
 * Private subdoc now holds TOKENS only. `clientSecret` has moved to
 * GCP Secret Manager — see ./secret-manager.ts.
 */
interface PrivateCredentials {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: admin.firestore.Timestamp;
}

async function loadPrivateCreds(configDoc: string): Promise<PrivateCredentials> {
  const snap = await privateCredsRef(configDoc).get();
  return (snap.exists ? (snap.data() as PrivateCredentials) : {}) ?? {};
}

export function makeEhrOAuth(spec: EhrOAuthSpec): EhrOAuth {
  const tokenExchangeAuth = spec.tokenExchangeAuth ?? defaultTokenExchangeAuth;
  const postAuthFields = spec.resolvePostAuthFields ?? defaultPostAuthFields;
  const credsChangeKeys = spec.credsChangeKeys ?? [];

  function redirectUri(): string {
    return getRedirectUri(spec.callbackName);
  }

  // ─── saveCredentials ───────────────────────────────────────────────
  const saveCredentials = onCall({}, async (request: CallableRequest<any>) => {
    assertSuperAdmin(request.auth);
    const uid = request.auth!.uid;

    const clientId = (request.data?.clientId as string || "").trim();
    const clientSecret = (request.data?.clientSecret as string || "").trim();
    if (!clientId) {
      throw new HttpsError("invalid-argument", "clientId required");
    }
    if (clientId.length > 500 || clientSecret.length > 500) {
      throw new HttpsError("invalid-argument", "credentials too long");
    }
    const extra = spec.validateExtraFields ? spec.validateExtraFields(request.data) : {};

    const ref = db().doc(spec.configDoc);
    const existing = await ref.get();
    const existingData = existing.data() ?? {};
    // Fetch the currently-stored clientSecret from SM so we can detect
    // "unchanged" and skip burning a Secret Manager version (they count
    // against the 10k-per-secret limit).
    const existingSecret = await getEhrClientSecret(spec.provider);

    let credsChanged = !existing.exists
      || existingData.clientId !== clientId
      || existingSecret !== clientSecret;
    for (const key of credsChangeKeys) {
      if (existingData[key] !== (extra as any)[key]) credsChanged = true;
    }

    // Public doc: client id + non-secret config. No tokens, no clientSecret.
    const publicBase: Record<string, unknown> = {
      provider: spec.provider,
      clientId,
      ...extra,
      redirectUri: redirectUri(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      connectedBy: uid,
    };

    if (existing.exists && !credsChanged) {
      await ref.set(publicBase, { merge: true });
    } else {
      await ref.set({
        ...publicBase,
        status: "not-authorized",
        enabled: existingData.enabled ?? false,
        scope: admin.firestore.FieldValue.delete(),
        grantedScope: admin.firestore.FieldValue.delete(),
        connectedAt: admin.firestore.FieldValue.delete(),
      }, { merge: true });
      // Clear stale tokens; credentials changed or are brand new.
      await privateCredsRef(spec.configDoc).set({});
      // Write the (possibly new) clientSecret to Secret Manager.
      if (clientSecret) {
        await setEhrClientSecret(spec.provider, clientSecret);
      }
    }

    logger.info(`[${spec.provider}] credentials saved`, { uid });
    return { ok: true, redirectUri: redirectUri() };
  });

  // ─── authorize ─────────────────────────────────────────────────────
  const authorize = onCall({}, async (request: CallableRequest<any>) => {
    assertSuperAdmin(request.auth);
    const uid = request.auth!.uid;

    const snap = await db().doc(spec.configDoc).get();
    if (!snap.exists) {
      throw new HttpsError("failed-precondition", `Save ${spec.provider} credentials first`);
    }
    const cfg = snap.data()!;
    if (!cfg.clientId) throw new HttpsError("failed-precondition", "clientId missing");

    const state = await new SignJWT({ userId: uid })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("10m")
      .sign(stateSecret());

    const params = new URLSearchParams({
      redirect_uri: cfg.redirectUri || redirectUri(),
      response_type: "code",
      client_id: cfg.clientId as string,
      scope: (cfg.scope as string) || spec.defaultScope,
      state,
      ...(spec.extraAuthorizeParams?.(cfg) ?? {}),
    });
    return {
      url: `${spec.resolveAuthUrl(cfg)}?${params}`,
      redirectUri: cfg.redirectUri || redirectUri(),
    };
  });

  // ─── callback (OAuth redirect target) ─────────────────────────────
  const callback = onRequest({ cors: true }, async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const oauthError = req.query.error as string | undefined;
    const frontend = process.env.FRONTEND_URL || "http://localhost:3001";
    const back = `${frontend}/admin/agent?tab=integrations`;
    const errKey = `${spec.provider}_error`;
    const statusKey = `${spec.provider}_status`;

    if (oauthError) {
      res.redirect(`${back}&${errKey}=${encodeURIComponent(oauthError)}`);
      return;
    }
    if (!code || !state) {
      res.redirect(`${back}&${errKey}=missing_code`);
      return;
    }

    try {
      const { payload } = await jwtVerify(state, stateSecret());
      if (!payload.userId) throw new Error("Missing userId");
    } catch (err: any) {
      logger.warn(`[${spec.provider}] rejected callback with invalid state`, { message: err.message });
      res.redirect(`${back}&${errKey}=invalid_state`);
      return;
    }

    try {
      const ref = db().doc(spec.configDoc);
      const snap = await ref.get();
      if (!snap.exists) throw new Error(`${spec.provider} credentials not configured`);
      const cfg = snap.data()!;
      const clientId = cfg.clientId as string | undefined;
      const redirectUriStored = (cfg.redirectUri as string) || redirectUri();
      const tokenUrl = spec.resolveTokenUrl(cfg);
      if (!clientId) throw new Error("clientId missing");
      const clientSecret = await getEhrClientSecret(spec.provider);

      const { headers, bodyExtras } = tokenExchangeAuth({ ...cfg, clientSecret });
      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUriStored,
          ...bodyExtras,
        }),
      });
      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        throw new Error(`Token exchange failed: ${tokenRes.status} ${text.slice(0, 300)}`);
      }
      const tok = await tokenRes.json() as OAuthTokenResponse;
      const expiresAt = admin.firestore.Timestamp.fromMillis(
        Date.now() + tok.expires_in * 1000,
      );

      // Public doc: status + non-secret post-auth fields.
      await ref.set({
        status: "active",
        ...postAuthFields(tok, spec.defaultScope),
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Private doc: tokens only.
      await privateCredsRef(spec.configDoc).set({
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? null,
        tokenExpiresAt: expiresAt,
      }, { merge: true });

      logger.info(`[${spec.provider}] OAuth connected`);
      res.redirect(`${back}&${statusKey}=connected`);
    } catch (err: any) {
      logger.error(`[${spec.provider}] OAuth callback error:`, err.message);
      res.redirect(`${back}&${errKey}=${encodeURIComponent(err.message).slice(0, 200)}`);
    }
  });

  // ─── setEnabled ────────────────────────────────────────────────────
  const setEnabled = onCall(
    {secrets: [SIDECAR_URL_SECRET, SIDECAR_API_KEY_SECRET]},
    async (request: CallableRequest<any>) => {
      assertSuperAdmin(request.auth);
      const enabled = Boolean(request.data?.enabled);
      await db().doc(spec.configDoc).set({
        enabled,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await syncIntegrationSkill(spec.provider, enabled);
      return { ok: true, enabled };
    },
  );

  // ─── disconnect ────────────────────────────────────────────────────
  // Removes the public doc, the private token subdoc, and the Secret
  // Manager clientSecret. Replaces the old browser-side
  // `deleteDoc(integrations/{id})` path — that left the private subdoc
  // and SM secret orphaned.
  const disconnect = onCall(
    {secrets: [SIDECAR_URL_SECRET, SIDECAR_API_KEY_SECRET]},
    async (request: CallableRequest<any>) => {
      assertSuperAdmin(request.auth);
      const ref = db().doc(spec.configDoc);
      await Promise.all([
        privateCredsRef(spec.configDoc).delete().catch(() => {}),
        deleteEhrClientSecret(spec.provider).catch((err) => {
          logger.warn(`[${spec.provider}] failed to delete SM secret`, { message: err.message });
        }),
      ]);
      await ref.delete().catch(() => {});
      await syncIntegrationSkill(spec.provider, false);
      logger.info(`[${spec.provider}] disconnected`, { uid: request.auth!.uid });
      return { ok: true };
    },
  );

  // ─── getAccessToken (server-side helper) ───────────────────────────
  async function getAccessToken(): Promise<string> {
    const ref = db().doc(spec.configDoc);
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`${spec.provider} not connected`);
    const cfg = snap.data() as any;
    if (cfg.enabled === false) throw new Error(`${spec.provider} integration disabled`);

    const priv = await loadPrivateCreds(spec.configDoc);
    if (!priv.accessToken) throw new Error(`${spec.provider} access token missing`);

    const expMs = priv.tokenExpiresAt ? priv.tokenExpiresAt.toMillis() : 0;
    if (expMs - Date.now() >= 5 * 60 * 1000) return priv.accessToken;

    if (!priv.refreshToken) throw new Error(`${spec.provider} refresh credentials missing`);
    const clientSecret = await getEhrClientSecret(spec.provider);
    const merged = { ...cfg, clientSecret };
    const { headers, bodyExtras } = tokenExchangeAuth(merged);
    const tokenUrl = spec.resolveTokenUrl(merged);
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: priv.refreshToken,
        ...bodyExtras,
      }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`${spec.provider} refresh failed: ${tokenRes.status} ${text.slice(0, 200)}`);
    }
    const tok = await tokenRes.json() as OAuthTokenResponse;
    await privateCredsRef(spec.configDoc).set({
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? priv.refreshToken,
      tokenExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + tok.expires_in * 1000),
    }, { merge: true });
    await ref.set({
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return tok.access_token;
  }

  return { saveCredentials, authorize, callback, setEnabled, disconnect, getAccessToken };
}
