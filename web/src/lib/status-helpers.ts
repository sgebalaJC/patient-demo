/**
 * Centralized status/priority color and icon helpers.
 * Used across admin pages, message views, and refill pages.
 */

import {
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import type { Appointment, MessageThread, PrescriptionRefillRequest } from '../types';

type AppointmentStatus = Appointment['status'];
type ThreadStatus = MessageThread['status'];
type RefillStatus = PrescriptionRefillRequest['status'];
type Urgency = PrescriptionRefillRequest['urgency'];
type ThreadPriority = MessageThread['priority'];

/** Force exhaustiveness on `switch` over a union — any new variant becomes a TS error. */
function assertNever(value: never): never {
  throw new Error(`Unhandled status variant: ${String(value)}`);
}

// Status icon resolvers — return Lucide component
export const getRefillStatusIcon = (status: RefillStatus) => {
  switch (status) {
    case 'pending': return Clock;
    case 'approved': return CheckCircle;
    case 'completed': return CheckCircle;
    case 'denied': return XCircle;
    case 'cancelled': return XCircle;
    default: return assertNever(status);
  }
};

export const getAppointmentStatusIcon = (status: AppointmentStatus) => {
  switch (status) {
    case 'confirmed': return CheckCircle;
    case 'completed': return CheckCircle;
    case 'cancelled': return XCircle;
    case 'no-show': return AlertCircle;
    case 'scheduled': return Clock;
    case 'in-progress': return Clock;
    default: return assertNever(status);
  }
};

// Appointment status
export const getAppointmentStatusColor = (status: AppointmentStatus): string => {
  switch (status) {
    case 'scheduled': return 'bg-blue-100 text-blue-800';
    case 'confirmed': return 'bg-green-100 text-green-800';
    case 'in-progress': return 'bg-blue-100 text-blue-800';
    case 'completed': return 'bg-purple-100 text-purple-800';
    case 'cancelled': return 'bg-red-100 text-red-800';
    case 'no-show': return 'bg-gray-100 text-gray-800';
    default: return assertNever(status);
  }
};

// Message thread status
export const getThreadStatusColor = (status: ThreadStatus): string => {
  switch (status) {
    case 'open': return 'bg-green-100 text-green-800';
    case 'in_progress': return 'bg-blue-100 text-blue-800';
    case 'resolved': return 'bg-purple-100 text-purple-800';
    case 'closed': return 'bg-gray-100 text-gray-800';
    default: return assertNever(status);
  }
};

// Refill status
export const getRefillStatusColor = (status: RefillStatus): string => {
  switch (status) {
    case 'pending': return 'bg-yellow-100 text-yellow-800';
    case 'approved': return 'bg-green-100 text-green-800';
    case 'denied': return 'bg-red-100 text-red-800';
    case 'completed': return 'bg-blue-100 text-blue-800';
    case 'cancelled': return 'bg-gray-100 text-gray-800';
    default: return assertNever(status);
  }
};

// Urgency
export const getUrgencyColor = (urgency: Urgency): string => {
  switch (urgency) {
    case 'routine': return 'bg-green-100 text-green-800';
    case 'urgent': return 'bg-yellow-100 text-yellow-800';
    case 'emergency': return 'bg-red-100 text-red-800';
    default: return assertNever(urgency);
  }
};

// Priority (badge style — background + text). Accepts both MessageThread
// priorities ("low" | "normal" | "high" | "urgent") and the wider "medium"
// some legacy data carries — narrow at the type level next time the schema
// is rewritten.
export const getPriorityBadgeColor = (priority: ThreadPriority | 'medium'): string => {
  switch (priority) {
    case 'high':
    case 'urgent':
      return 'bg-red-100 text-red-800';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800';
    case 'low':
      return 'bg-green-100 text-green-800';
    case 'normal':
      return 'bg-blue-100 text-blue-800';
    default:
      return assertNever(priority);
  }
};

// Priority (text-only color for dots/indicators)
export const getPriorityTextColor = (priority: ThreadPriority): string => {
  switch (priority) {
    case 'urgent': return 'text-red-600';
    case 'high': return 'text-orange-600';
    case 'normal': return 'text-blue-600';
    case 'low': return 'text-gray-600';
    default: return assertNever(priority);
  }
};
