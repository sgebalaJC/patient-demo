import { NotificationType, UserRole } from '../types';
import { isAdminRole } from './roles';

/**
 * Resolves a notification type + meta into a route path.
 * Each notification type has its own link composition logic.
 * Links are role-aware — admin and patient see different destinations.
 */

type LinkResolver = (meta: Record<string, string>, role: UserRole) => string | null;

const linkResolvers: Record<NotificationType, LinkResolver> = {
  appointment_booked: (_meta, role) =>
    isAdminRole(role) ? '/admin/appointments' : '/appointments',
  appointment_cancelled: (_meta, role) =>
    isAdminRole(role) ? '/admin/appointments' : '/appointments',
  appointment_confirmed: () => '/appointments',
  new_message: (meta) =>
    meta.threadId ? `/messages?thread=${meta.threadId}` : '/messages',
  new_patient: () => '/admin/users',
  refill_request: (_meta, role) =>
    isAdminRole(role) ? '/admin/refills' : '/refills',
  specialist_request: (_meta, role) =>
    isAdminRole(role) ? '/admin/specialist-requests' : '/appointments',
  system: () => null,
};

export function getNotificationLink(
  type: NotificationType,
  meta: Record<string, string>,
  role: UserRole = 'admin'
): string | null {
  const resolver = linkResolvers[type];
  return resolver ? resolver(meta, role) : null;
}
