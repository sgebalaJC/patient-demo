/**
 * Shared auth preamble for callable Cloud Functions.
 *
 * All admin-scoped callables follow the same 4-line ritual:
 *   1. Require request.auth
 *   2. (Optional) rate-limit the actor
 *   3. Assert caller is admin (or super-admin by email)
 *
 * `requireAdmin` collapses that into a single call. Errors are plain
 * `Error` (not HttpsError) to match the `{success, error}` envelope
 * pattern used throughout functions/src/index.ts — changing to
 * HttpsError would be a client-visible contract change.
 */

import { assertAdmin, isSuperAdminEmail } from "../superAdmins.js";
import { checkRateLimit } from "./rate-limit.js";

export type CallableAuth = {
  uid: string;
  token?: { email?: string };
};

export type CallableRequest = {
  auth?: CallableAuth;
};

export type RequireAdminOptions = {
  /** Rate-limit key (e.g. 'updateUser'). Omit to skip rate-limiting. */
  rateLimitKey?: string;
  /** Max requests in the window. Default 20. */
  maxRequests?: number;
  /** Window length in minutes. Default 10. */
  windowMinutes?: number;
};

/**
 * Validate auth, rate-limit the actor, and assert admin role. Returns the
 * resolved auth context so callers don't need to narrow again.
 */
export async function requireAdmin(
  request: CallableRequest,
  opts: RequireAdminOptions = {},
): Promise<CallableAuth> {
  const context = request.auth;
  if (!context) throw new Error("Authentication required");
  if (opts.rateLimitKey) {
    await checkRateLimit(
      context.uid,
      opts.rateLimitKey,
      opts.maxRequests ?? 20,
      opts.windowMinutes ?? 10,
    );
  }
  await assertAdmin(context);
  return context;
}

/**
 * Super-admin variant (email allowlist). Used for platform-level controls
 * like integration credentials and client-error inspection.
 */
export function requireSuperAdmin(request: CallableRequest): CallableAuth {
  const context = request.auth;
  if (!context) throw new Error("Authentication required");
  if (!isSuperAdminEmail(context.token?.email)) {
    throw new Error("Super admin access required");
  }
  return context;
}

/**
 * Require an authenticated caller but not admin. Covers the
 * `if (!request.auth) throw` preamble for patient-scoped callables.
 */
export function requireAuth(request: CallableRequest): CallableAuth {
  const context = request.auth;
  if (!context) throw new Error("Authentication required");
  return context;
}
