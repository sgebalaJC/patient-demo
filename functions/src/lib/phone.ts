/**
 * Server-side phone normalization. Mirrors `web/src/lib/phone.ts` —
 * both sides MUST produce the same canonical form.
 *
 * Canonical stored form on `users.phoneNumber` is 10 digits (e.g. `4425004657`).
 * External APIs (Twilio, Firebase Auth) take E.164 (`+1XXXXXXXXXX`).
 */

/**
 * Canonical 10-digit US form for Firestore storage. Accepts free-text
 * input (`(442) 500-4657`, `+1 442 500 4657`, etc). Throws on anything
 * that doesn't reduce to 10 digits.
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  const trimmed = (phoneNumber || "").trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  throw new Error(
    `Invalid US phone number: ${JSON.stringify(trimmed)}. Expected 10 digits.`,
  );
}

/** Convert a canonical 10-digit phone to E.164 (`+1XXXXXXXXXX`). */
export function toE164(phone10: string): string {
  const digits = (phone10 || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw new Error(
    `Invalid US phone number for E.164: ${JSON.stringify(phone10)}`,
  );
}
