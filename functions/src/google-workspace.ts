/**
 * Google Workspace integration — unified auth for two exclusive modes.
 *
 *   mode A  'service-account' — domain-wide delegation: JWT signed with a
 *                                service-account JSON key (stored in Secret
 *                                Manager), impersonates a Workspace subject
 *                                email. Agent operates AS that subject.
 *
 *   mode B  'oauth'           — three-legged Google OAuth. Admin clicks
 *                                "Connect", grants consent; we store the
 *                                encrypted refresh token in the Firestore
 *                                integration doc. Agent operates AS that
 *                                specific authorized email.
 *
 * Mode is picked at setup time via the admin Integrations tab and stored on
 * `integrations/google-workspace` as `authMode`. Exclusivity is enforced by
 * the callables that write the doc.
 *
 * `calendarId` lives on the integration doc too — reminders + agent calendar
 * actions all read it from there. Service-account mode impersonates the
 * subject, so the subject must have access to the calendar. OAuth mode
 * operates as the authorized email, so that email must have access. Both
 * callables verify read access at save time and refuse to save otherwise.
 */

import * as admin from "firebase-admin";
import {decrypt} from "./encryption.js";
import {getGoogleServiceAccountKey} from "./lib/secret-manager.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Scopes per service — requested incrementally as services are enabled. */
export const SERVICE_SCOPES: Record<string, string[]> = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  calendar: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  drive: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
};

const BASE_SCOPES = ["openid", "email"];

export type GoogleService = "gmail" | "calendar" | "drive";
export type GoogleAuthMode = "service-account" | "oauth";

export interface GoogleWorkspaceIntegration {
  provider: "google-workspace";
  status: "active";
  authMode: GoogleAuthMode;
  calendarId: string;
  enabledServices: GoogleService[];
  grantedScopes: string[];
  // service-account only
  saClientEmail?: string;
  subject?: string;
  // oauth only
  email?: string;
  refreshTokenCipher?: string;
}

// ── OAuth URL + code exchange (mode B setup) ───────────────────────────

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, or GOOGLE_OAUTH_REDIRECT_URI");
  }
  return {clientId, clientSecret, redirectUri};
}

export function getGoogleAuthUrl(state: string, services: GoogleService[]): string {
  const {clientId, redirectUri} = getOAuthConfig();
  const scopes = [
    ...BASE_SCOPES,
    ...services.flatMap((s) => SERVICE_SCOPES[s] ?? []),
  ];
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    enable_granular_consent: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  email: string;
  expiresAt: number;
  grantedScopes: string[];
}> {
  const {clientId, clientSecret, redirectUri} = getOAuthConfig();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const data = await res.json();
  const accessToken = data.access_token as string;
  const refreshToken = data.refresh_token as string;
  const expiresAt = Date.now() + (data.expires_in as number) * 1000;
  const grantedScopes = ((data.scope as string) || "").split(" ");

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {Authorization: `Bearer ${accessToken}`},
  });
  const profile = await profileRes.json();
  const email = profile.email as string;

  return {accessToken, refreshToken, email, expiresAt, grantedScopes};
}

async function refreshOAuthAccessToken(encryptedCredentials: string): Promise<string> {
  const decrypted = decrypt(encryptedCredentials);
  const {refreshToken} = JSON.parse(decrypted) as {refreshToken: string};
  const {clientId, clientSecret} = getOAuthConfig();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    console.error(`[google] Token refresh failed (${res.status}): ${errorBody}`);
    throw new Error("Token refresh failed");
  }
  const data = await res.json();
  return data.access_token as string;
}

export function detectServices(grantedScopes: string[]): GoogleService[] {
  const services: GoogleService[] = [];
  for (const [service, scopes] of Object.entries(SERVICE_SCOPES)) {
    if (scopes.some((s) => grantedScopes.includes(s))) {
      services.push(service as GoogleService);
    }
  }
  return services;
}

// ── Service-account JWT grant (mode A) ─────────────────────────────────

/**
 * Mint a short-lived access token using domain-wide delegation. The JWT
 * `sub` is the subject to impersonate; the key signs with the service
 * account's private key. Google returns an OAuth access token scoped to
 * the impersonated user.
 *
 * Uses `jose` (already a functions dep for the OAuth state JWT).
 */
export async function getServiceAccountAccessToken(
  subject: string,
  scopes: string[],
): Promise<string> {
  const keyJson = await getGoogleServiceAccountKey();
  if (!keyJson) {
    throw new Error("Google service-account key not found in Secret Manager");
  }
  const {importPKCS8, SignJWT} = await import("jose");
  const key = JSON.parse(keyJson) as {client_email: string; private_key: string};
  const privateKey = await importPKCS8(key.private_key, "RS256");

  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({scope: scopes.join(" ")})
    .setProtectedHeader({alg: "RS256"})
    .setIssuer(key.client_email)
    .setSubject(subject)
    .setAudience(GOOGLE_TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Service-account token exchange failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

export function allScopesForServices(services: GoogleService[]): string[] {
  return [...BASE_SCOPES, ...services.flatMap((s) => SERVICE_SCOPES[s] ?? [])];
}

// ── Integration doc + unified access-token resolution ──────────────────

const INTEGRATION_DOC = "integrations/google-workspace";

export async function loadIntegration(): Promise<GoogleWorkspaceIntegration | null> {
  const snap = await admin.firestore().doc(INTEGRATION_DOC).get();
  if (!snap.exists) return null;
  return snap.data() as GoogleWorkspaceIntegration;
}

/**
 * Resolve a bearer access token for either mode. Used by the proxy and by
 * the appointment-sync module. Throws if the integration doesn't exist,
 * isn't active, or the token grant fails.
 *
 * `identity` is the email the resulting token operates as — either the
 * OAuth-authorized user or the service-account subject. Handy for logs.
 */
export async function resolveAccessToken(
  integration: GoogleWorkspaceIntegration,
): Promise<{accessToken: string; identity: string}> {
  if (integration.authMode === "oauth") {
    if (!integration.refreshTokenCipher || !integration.email) {
      throw new Error("OAuth integration is missing refresh token or email");
    }
    const accessToken = await refreshOAuthAccessToken(integration.refreshTokenCipher);
    return {accessToken, identity: integration.email};
  }
  if (integration.authMode === "service-account") {
    if (!integration.subject) throw new Error("Service-account integration is missing subject");
    const scopes = allScopesForServices(integration.enabledServices);
    const accessToken = await getServiceAccountAccessToken(integration.subject, scopes);
    return {accessToken, identity: integration.subject};
  }
  throw new Error(`Unknown authMode: ${(integration as {authMode: string}).authMode}`);
}

/**
 * Verify that the authenticated principal can read the given calendar.
 * Throws a clear error otherwise so the UI can tell the admin "the
 * calendar isn't shared with this account". Checked at save time for
 * both modes — we refuse to persist a broken integration.
 */
export async function verifyCalendarAccess(
  accessToken: string,
  calendarId: string,
): Promise<void> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}?fields=id`,
    {headers: {Authorization: `Bearer ${accessToken}`}},
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Calendar ${JSON.stringify(calendarId)} is not accessible (${res.status}). ` +
      "Share the calendar with the connected account and try again. " +
      (text.slice(0, 200)),
    );
  }
}
