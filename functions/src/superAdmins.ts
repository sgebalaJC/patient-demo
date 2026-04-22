/**
 * Super-admin email allowlist.
 *
 * Sync points — this list is duplicated in:
 *   - web/src/lib/roles.ts (client-side gating)
 *   - firestore.rules    (isSuperAdmin())
 *   - storage.rules       (isSuperAdmin())
 */
import * as admin from "firebase-admin";

export const SUPER_ADMIN_EMAILS = ['stanislaw.gebala@gmail.com'];

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return !!email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * Assert caller is admin or super admin. Throws if not.
 * Super admins have no Firestore user doc — identified by email only.
 */
export async function assertAdmin(
  auth: { uid: string; token?: { email?: string } } | undefined,
): Promise<void> {
  if (!auth) throw new Error('Authentication required');
  if (isSuperAdminEmail(auth.token?.email)) return;
  const doc = await admin.firestore().collection('users').doc(auth.uid).get();
  const data = doc.data();
  if (!doc.exists || data?.role !== 'admin' || data?.isActive === false) {
    throw new Error('Admin privileges required');
  }
}

/**
 * Assert caller is a super admin (email allowlist). Throws otherwise.
 * Used for platform-level controls (integration credentials, client errors)
 * that should not be accessible to practice admins.
 */
export function assertSuperAdmin(
  auth: { uid: string; token?: { email?: string } } | undefined,
): void {
  if (!auth) throw new Error('Authentication required');
  if (!isSuperAdminEmail(auth.token?.email)) {
    throw new Error('Super admin privileges required');
  }
}
