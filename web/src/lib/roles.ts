import type { UserRole } from '../types';

export const SUPER_ADMIN_EMAILS = ['stanislaw.gebala@gmail.com'];

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return !!email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}

export function isAdminRole(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export function isSuperAdminRole(role: UserRole | undefined): boolean {
  return role === 'super_admin';
}
