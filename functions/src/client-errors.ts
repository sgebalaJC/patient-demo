/**
 * Client-side error telemetry sink.
 *
 * The web app calls `logClientError` from:
 *  - `logger.error` (wrapped in `web/src/lib/client-errors.ts`)
 *  - `window.onerror` / `unhandledrejection` global handlers
 *
 * We scrub obvious PII before writing to Cloud Logging so nothing
 * HIPAA-sensitive lands in logs (per project rule: log UIDs + roles only).
 * `logger.error` here routes to `stderr`; Cloud Run captures it and
 * surfaces under the function's log stream in GCP Logs Explorer.
 */

import * as admin from "firebase-admin";
import {onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

const MAX_MESSAGE = 4000;
const MAX_STACK = 8000;
const MAX_ROUTE = 500;
const MAX_UA = 500;

const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
// Matches 10+ digit phone-like runs: +1 555-555-5555, (555) 555-5555, etc.
const PHONE_RE = /(?:\+?\d[\d .\-()]{8,}\d)/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

function scrub(s: unknown, max: number): string {
  if (s == null) return "";
  return String(s)
    .slice(0, max)
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[phone]")
    .replace(SSN_RE, "[ssn]");
}

export const logClientError = onCall({cors: true}, async (request) => {
  const data = (request.data ?? {}) as {
    level?: string;
    message?: unknown;
    stack?: unknown;
    route?: unknown;
    userAgent?: unknown;
    context?: unknown;
  };

  const level = data.level === "warn" ? "warn" : "error";
  const entry = {
    uid: request.auth?.uid ?? null,
    role: (request.auth?.token as {role?: string} | undefined)?.role ?? null,
    route: scrub(data.route, MAX_ROUTE),
    userAgent: scrub(data.userAgent, MAX_UA),
    message: scrub(data.message, MAX_MESSAGE),
    stack: scrub(data.stack, MAX_STACK),
    context: data.context != null
      ? scrub(JSON.stringify(data.context), MAX_MESSAGE)
      : "",
  };

  if (level === "warn") logger.warn("[client-error]", entry);
  else logger.error("[client-error]", entry);

  // Persist for the /admin/client-errors live feed. Best-effort — if the
  // write fails we still returned via Cloud Logging.
  try {
    await admin.firestore().collection("client-errors").add({
      ...entry,
      level,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err: any) {
    logger.warn("[client-error] firestore write failed", {message: err?.message});
  }

  return {ok: true};
});
