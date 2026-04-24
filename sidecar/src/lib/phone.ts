/**
 * Sidecar phone normalization — mirrors `functions/src/lib/phone.ts` and
 * `web/src/lib/phone.ts`. All three MUST produce the same canonical form
 * so a number written by one is readable by the others.
 *
 * Sidecar can't import from the functions package (separately deployed),
 * so this is a deliberate copy. Keep changes synchronized across all
 * three files.
 */

/**
 * Lenient E.164 normalizer used by the Twilio send path. Accepts free-text
 * input (`(442) 500-4657`, `+1 442 500 4657`, `4425004657`) and returns
 * `+1XXXXXXXXXX`. Returns empty string on anything unrecognizable — the
 * caller decides whether that's an error for their flow.
 */
export function toE164Lenient(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return "";
}
