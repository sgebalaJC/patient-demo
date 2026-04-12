/**
 * Google Workspace OAuth helpers.
 * Handles OAuth URL generation, code exchange, token refresh, and scope detection.
 */

import {decrypt} from "./encryption.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

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

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, or GOOGLE_OAUTH_REDIRECT_URI");
  }
  return {clientId, clientSecret, redirectUri};
}

/** Build a Google OAuth URL for the requested services. */
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

/** Exchange an authorization code for tokens and profile. */
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

  // Get email from profile
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {Authorization: `Bearer ${accessToken}`},
  });
  const profile = await profileRes.json();
  const email = profile.email as string;

  return {accessToken, refreshToken, email, expiresAt, grantedScopes};
}

/** Refresh an access token from encrypted credentials. */
export async function refreshAccessToken(encryptedCredentials: string): Promise<{
  accessToken: string;
  expiresAt: number;
}> {
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
  return {
    accessToken: data.access_token as string,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
  };
}

/** Determine which services are enabled from granted scopes. */
export function detectServices(grantedScopes: string[]): GoogleService[] {
  const services: GoogleService[] = [];
  for (const [service, scopes] of Object.entries(SERVICE_SCOPES)) {
    if (scopes.some((s) => grantedScopes.includes(s))) {
      services.push(service as GoogleService);
    }
  }
  return services;
}
