/**
 * Shared helpers for rendering user-shaped data. Every "FirstName LastName"
 * concat in the app has a slightly different fallback shape — some want
 * email, some want "Admin"/"Patient"/"Unknown", some want a custom string.
 * Centralizing the concat + trim + fallback chain here avoids the five
 * existing spellings drifting further apart.
 */

interface NameFields {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

/**
 * Build a display name from first + last, falling back down the chain:
 *   "{first} {last}" → email → fallback.
 * Handles undefined / null / empty fields safely.
 */
export function formatDisplayName(
  user: NameFields | null | undefined,
  fallback = 'Unknown',
): string {
  if (!user) return fallback;
  const name = [user.firstName, user.lastName]
    .filter((p) => p && String(p).trim().length > 0)
    .join(' ')
    .trim();
  if (name) return name;
  const email = (user.email || '').trim();
  if (email) return email;
  return fallback;
}
