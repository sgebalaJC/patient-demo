/**
 * Firestore-backed rate limiter + best-effort client IP extractor, shared
 * by the callables in `functions/src/index.ts`.
 */

import * as admin from "firebase-admin";

/**
 * Simple rate limiter using Firestore.
 * Tracks calls per `uid + action` within a time window.
 * Throws a plain Error (message shown to the caller) once the window is exceeded.
 */
export async function checkRateLimit(
  uid: string,
  action: string,
  maxCalls: number,
  windowMinutes: number,
): Promise<void> {
  const db = admin.firestore();
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const rateLimitRef = db.collection("rate-limits").doc(`${uid}_${action}`);

  const doc = await rateLimitRef.get();
  if (doc.exists) {
    const data = doc.data()!;
    const windowStart = data.windowStart?.toMillis?.() || data.windowStart || 0;
    const count = data.count || 0;

    if (now - windowStart < windowMs) {
      if (count >= maxCalls) {
        throw new Error("Rate limit exceeded. Please wait before trying again.");
      }
      await rateLimitRef.update({count: count + 1});
      return;
    }
  }

  await rateLimitRef.set({
    windowStart: admin.firestore.Timestamp.fromMillis(now),
    count: 1,
  });
}

/**
 * Best-effort client IP from an onCall v2 request. Trusts the first
 * x-forwarded-for entry (Cloud Run sets this from the load balancer), and
 * falls back to the socket's remoteAddress. Returns "unknown" if neither is
 * present so we still bucket abuse attempts from unidentifiable callers.
 */
export function clientIp(
  req: { rawRequest?: { headers?: any; ip?: string; socket?: any } } | undefined,
): string {
  const raw = req?.rawRequest;
  const xff = raw?.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return raw?.ip || raw?.socket?.remoteAddress || "unknown";
}
