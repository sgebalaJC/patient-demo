import type { UserRole } from '../types';

/**
 * Super-admin email allowlist.
 *
 * Sync points — this list is duplicated in:
 *   - functions/src/superAdmins.ts (server-side gating)
 *   - firestore.rules              (isSuperAdmin())
 *   - storage.rules                (isSuperAdmin())
 */
export const SUPER_ADMIN_EMAILS = ['stanislaw.gebala@gmail.com'];

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return !!email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}

export function isAdminRole(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}
