/**
 * Server-side field validation — loud errors, no silent truncation.
 *
 * Matches web/src/lib/validation.ts `assertMaxLength` / `MAX_FIELD_CHARS`.
 * Both sides read from /fork.config.ts so the ceiling stays in sync.
 */

import { HttpsError } from "firebase-functions/v2/https";
import { FORK_CONFIG } from "../_fork.config.js";

/**
 * Global ceiling for any free-text field written by a callable. Callables
 * with a larger field-specific cap (e.g. message content) should pass an
 * explicit `max`; everything else defaults to this value.
 */
export const MAX_FIELD_CHARS = FORK_CONFIG.limits.maxFieldChars;

/**
 * Throws `HttpsError('invalid-argument', ...)` if `value` exceeds `max`.
 * Skips null/undefined so callers don't need to branch. Use at the top
 * of a callable after destructuring the request payload:
 *
 *   assertMaxLength('firstName', firstName);
 *   assertMaxLength('notes', notes, 2000);
 */
export function assertMaxLength(
  field: string,
  value: string | null | undefined,
  max: number = MAX_FIELD_CHARS,
): void {
  if (value == null) return;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} must be a string.`);
  }
  if (value.length > max) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be ${max} characters or fewer (got ${value.length}).`,
    );
  }
}
