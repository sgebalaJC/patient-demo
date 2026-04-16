export const SUPER_ADMIN_EMAILS = ['stanislaw.gebala@gmail.com'];

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return !!email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}
