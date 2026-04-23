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

// Status icon resolvers — return Lucide component
export const getRefillStatusIcon = (status: string) => {
  switch (status) {
    case 'pending': return Clock;
    case 'approved': return CheckCircle;
    case 'denied': return XCircle;
    case 'completed': return CheckCircle;
    default: return Clock;
  }
};

export const getAppointmentStatusIcon = (status: string) => {
  switch (status) {
    case 'confirmed': return CheckCircle;
    case 'cancelled': return XCircle;
    case 'no-show': return AlertCircle;
    default: return Clock;
  }
};

// Appointment status
export const getAppointmentStatusColor = (status: string): string => {
  switch (status) {
    case 'scheduled': return 'bg-blue-100 text-blue-800';
    case 'confirmed': return 'bg-green-100 text-green-800';
    case 'completed': return 'bg-purple-100 text-purple-800';
    case 'cancelled': return 'bg-red-100 text-red-800';
    case 'no-show': return 'bg-gray-100 text-gray-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

// Message thread status
export const getThreadStatusColor = (status: string): string => {
  switch (status) {
    case 'open': return 'bg-green-100 text-green-800';
    case 'in_progress': return 'bg-blue-100 text-blue-800';
    case 'resolved': return 'bg-purple-100 text-purple-800';
    case 'closed': return 'bg-gray-100 text-gray-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

// Refill status
export const getRefillStatusColor = (status: string): string => {
  switch (status) {
    case 'pending': return 'bg-yellow-100 text-yellow-800';
    case 'approved': return 'bg-green-100 text-green-800';
    case 'denied': return 'bg-red-100 text-red-800';
    case 'completed': return 'bg-blue-100 text-blue-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

// Urgency
export const getUrgencyColor = (urgency: string): string => {
  switch (urgency) {
    case 'routine': return 'bg-green-100 text-green-800';
    case 'urgent': return 'bg-yellow-100 text-yellow-800';
    case 'emergency': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

// Priority (badge style — background + text)
export const getPriorityBadgeColor = (priority: string): string => {
  switch (priority) {
    case 'high': case 'urgent': return 'bg-red-100 text-red-800';
    case 'medium': return 'bg-yellow-100 text-yellow-800';
    case 'low': return 'bg-green-100 text-green-800';
    case 'normal': return 'bg-blue-100 text-blue-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

// Priority (text-only color for dots/indicators)
export const getPriorityTextColor = (priority: string): string => {
  switch (priority) {
    case 'urgent': return 'text-red-600';
    case 'high': return 'text-orange-600';
    case 'normal': return 'text-blue-600';
    case 'low': return 'text-gray-600';
    default: return 'text-gray-600';
  }
};
