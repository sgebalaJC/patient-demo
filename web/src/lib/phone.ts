/**
 * Phone number normalization — single source of truth for the client.
 *
 * Must match the server-side `formatPhoneNumber` in functions/src/index.ts
 * exactly so that the same input produces the same stored value regardless
 * of which path writes it.
 *
 * Used by every client path that writes `phoneNumber` to Firestore:
 *  - Admin UserForm edit flow (direct Firestore write)
 *  - createUserDocument on first email/Google sign-in
 *  - Profile phone edit (when not going through verification)
 *  - Bootstrap admin form (via the Cloud Function, but we still normalize
 *    locally for UI consistency)
 *
 * Input examples and their outputs:
 *   "14425004657"      → "+14425004657"
 *   "4425004657"       → "+14425004657"
 *   "(442) 500-4657"   → "+14425004657"
 *   "+1 (442) 500-4657"→ "+14425004657"
 *   "+14425004657"     → "+14425004657"  (already canonical)
 *   ""                 → ""  (empty stays empty)
 *
 * For non-US numbers (not 10 or 11 digits, or not starting with 1 when 11
 * digits), prepends `+` to the digits without assuming a country code.
 */
export function normalizePhoneNumber(phoneNumber: string | null | undefined): string {
  if (!phoneNumber) return '';

  const trimmed = phoneNumber.trim();
  if (!trimmed) return '';

  // Remove all non-digits
  const digits = trimmed.replace(/\D/g, '');

  // 10 digits → assume US, add +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // 11 digits starting with 1 → already US with country code, just add +
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // Already started with + in original → preserve as-is, re-joined with digits
  if (trimmed.startsWith('+')) {
    return `+${digits}`;
  }

  // Fallback: prepend +
  return `+${digits}`;
}

/**
 * Format a stored phone number for display.
 *
 * Input (canonical):  "+14425004657"
 * Output:             "(442) 500-4657"
 *
 * Non-US numbers are returned as-is. Empty/null returns empty string.
 */
export function formatPhoneDisplay(phoneNumber: string | null | undefined): string {
  if (!phoneNumber) return '';

  const digits = phoneNumber.replace(/\D/g, '');

  // US number with country code: 1 + 10 digits
  if (digits.length === 11 && digits.startsWith('1')) {
    const local = digits.slice(1);
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }

  // 10-digit US number without country code
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // Non-US or unknown format: return as-is
  return phoneNumber;
}
