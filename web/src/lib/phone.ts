/**
 * Phone normalization — US-only. Canonical stored format is 10 digits
 * (no `+1`, no punctuation): `"4425004657"`. External APIs that require
 * E.164 (SignalWire, Firebase Auth) wrap with `toE164(...)` at the boundary.
 *
 * Used by every client path that writes `phoneNumber` to Firestore:
 *  - Admin UserForm edit flow
 *  - createUserDocument on first email/Google sign-in
 *  - Profile phone edit
 *  - Bootstrap admin form
 *
 * Mirrors functions/src/index.ts — the two implementations MUST produce
 * identical output for identical input.
 *
 * Input examples and their outputs:
 *   "4425004657"        → "4425004657"
 *   "(442) 500-4657"    → "4425004657"
 *   "+1 (442) 500-4657" → "4425004657"
 *   "14425004657"       → "4425004657"
 *   ""                  → ""  (empty stays empty)
 *   "+33123456789"      → throws InvalidPhoneError (non-US)
 */

export class InvalidPhoneError extends Error {
  constructor(input: string) {
    super(`Invalid US phone number: ${JSON.stringify(input)}. Expected 10 digits.`);
    this.name = 'InvalidPhoneError';
  }
}

/**
 * Strip to digits and validate as a US 10-digit number. Empty input
 * returns empty string. Anything that doesn't reduce to exactly 10 digits
 * (or 11 starting with 1) throws `InvalidPhoneError` — callers must catch
 * and surface a field error to the user.
 */
export function normalizePhoneNumber(phoneNumber: string | null | undefined): string {
  if (phoneNumber === null || phoneNumber === undefined) return '';
  const trimmed = String(phoneNumber).trim();
  if (!trimmed) return '';

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  throw new InvalidPhoneError(trimmed);
}

/**
 * Format a canonical 10-digit phone for display.
 *
 * Input:  "4425004657"
 * Output: "(442) 500-4657"
 *
 * Also accepts `+1XXXXXXXXXX` / `1XXXXXXXXXX` so rows read straight from
 * SignalWire webhook payloads (sms-inbound `from`, sms-outbound `to`) render
 * without a second normalize step. Unrecognized shapes return as-is.
 */
export function formatPhoneDisplay(phoneNumber: string | null | undefined): string {
  if (!phoneNumber) return '';

  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    const local = digits.slice(1);
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return phoneNumber;
}

/**
 * Strip non-digit characters from a phone string. Use for partial / progressive
 * input where `normalizePhoneNumber` would throw (e.g. typing-in-progress
 * search boxes, raw form values that haven't been validated yet).
 */
export function getPhoneDigits(phone: string | null | undefined): string {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

/**
 * Convert a canonical 10-digit phone to E.164 (`+1XXXXXXXXXX`) for
 * external APIs (SignalWire, Firebase Auth). Throws on invalid input.
 */
export function toE164(phone10: string): string {
  const digits = phone10.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  throw new InvalidPhoneError(phone10);
}
