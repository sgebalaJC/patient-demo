import crypto from "crypto";

const API_KEY = process.env.SIDECAR_API_KEY;
if (!API_KEY) {
  throw new Error("[auth] SIDECAR_API_KEY is not set — refusing to start");
}

/** Constant-time string comparison. Prevents timing attacks on key length and content. */
function timingSafeEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/** User context passed from the Cloud Function proxy. */
export interface UserContext {
  uid: string;
  role: "admin" | "patient" | "assistant";
  name: string;
}

/**
 * Auth result — either API key auth (internal/backup calls) or
 * user context auth (proxied from Cloud Function).
 */
export interface AuthResult {
  mode: "api-key" | "user-context";
  user?: UserContext;
}

/**
 * Validate request auth. Supports two modes:
 * 1. Static API key (Bearer token) — for internal, backup, and scheduled calls
 * 2. User context headers (X-User-*) — for proxied requests from Cloud Function
 *
 * The Cloud Function proxy verifies the Firebase token and passes validated
 * user context as trusted headers alongside the API key.
 */
export function validateAuth(request: Request): AuthResult | null {
  if (!API_KEY) return null; // unreachable — startup throws, but satisfies TS narrowing

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  if (!timingSafeEqual(header.slice(7), API_KEY)) return null;

  // API key is valid — check if user context headers are also present
  const uid = request.headers.get("x-user-uid");
  const role = request.headers.get("x-user-role") as UserContext["role"] | null;
  const name = request.headers.get("x-user-name");

  if (uid && role && name) {
    return {
      mode: "user-context",
      user: { uid, role, name },
    };
  }

  return { mode: "api-key" };
}
