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

// ---------------------------------------------------------------------------
// Legacy field-limit helpers used by the callables in functions/src/index.ts.
// Mirrors web/src/lib/validation.ts so client + server reject identically.
// ---------------------------------------------------------------------------

export const FIELD_LIMITS = {
  firstName: {min: 2, max: 100},
  lastName: {min: 2, max: 100},
  email: {max: 254},
  phoneNumber: {max: 20},
  password: {min: 8, max: 128},
  role: {max: 20},
} as const;

export const VALID_ROLES = ["patient", "admin"] as const;

/**
 * Trim + length-check a string field. Throws a plain Error (not HttpsError)
 * because callers may handle the message in ways that expect plain errors.
 * Prefer `assertMaxLength` inside new callables.
 */
export function validateStringField(
  value: unknown,
  fieldName: string,
  limits: { min?: number; max?: number },
): string {
  if (typeof value !== "string") throw new Error(`${fieldName} must be a string`);
  const trimmed = value.trim();
  if (limits.min && trimmed.length < limits.min) {
    throw new Error(`${fieldName} must be at least ${limits.min} characters`);
  }
  if (limits.max && trimmed.length > limits.max) {
    throw new Error(`${fieldName} must be less than ${limits.max} characters`);
  }
  return trimmed;
}
