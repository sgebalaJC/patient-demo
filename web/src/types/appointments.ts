import { Timestamp } from 'firebase/firestore';

export interface Appointment {
  id: string;
  patientId: string;
  appointmentDate: Timestamp;
  duration?: number;
  appointmentType?: 'consultation' | 'follow-up' | 'physical' | 'urgent';
  reason?: string;
  notes?: string;
  status: 'scheduled' | 'confirmed' | 'in-progress' | 'completed' | 'cancelled' | 'no-show';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  reminderSent: boolean;
  reminderMessage?: string;
  googleCalendarEventId?: string;
  lastSyncSource?: 'app' | 'calendar';
  // Specialist referral fields
  specialistType?: string;
  address?: string;
  isSpecialistReferral?: boolean;
  specialistRequestId?: string;
}

export type SpecialistRequestStatus = 'pending' | 'confirmed' | 'cancelled';

export interface SpecialistRequest {
  id: string;
  patientId: string;
  specialistType: string;
  reason: string;
  notes?: string;
  status: SpecialistRequestStatus;
  appointmentId?: string;
  confirmedBy?: string;
  confirmedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateAppointmentData {
  appointmentDate: Date;
  duration: number;
  appointmentType: Appointment['appointmentType'];
}
