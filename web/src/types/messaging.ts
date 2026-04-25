import { Timestamp } from 'firebase/firestore';
import type { UserRole } from './user';

export interface MessageThread {
  id: string;
  patientId: string;
  patientName?: string;
  subject: string;
  lastMessage?: string;
  lastMessageAt?: Timestamp;
  lastMessageSenderId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isActive: boolean;
  unreadForPatient: boolean;
  unreadForAdmin: boolean;
  lastReadByAdminId?: string;
  lastReadByAdminAt?: Timestamp;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  tags: string[];
  // Legacy field — kept for backward compat during migration
  unreadCount?: { [key: string]: number };
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  content: string;
  attachments?: {
    id: string;
    name: string;
    url: string;
    type: string;
    size: number;
  }[];
  createdAt: Timestamp;
  readBy: { [key: string]: Timestamp };
  isEdited: boolean;
  editedAt?: Timestamp;
}

export type NotificationType =
  | 'appointment_booked'
  | 'appointment_cancelled'
  | 'appointment_confirmed'
  | 'new_message'
  | 'new_patient'
  | 'refill_request'
  | 'specialist_request'
  | 'system';

export interface Notification {
  id: string;
  recipientRole: 'admin' | 'patient';
  recipientId?: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  readBy: { [uid: string]: Timestamp };
  meta: { [key: string]: string };
  createdAt: Timestamp;
  readAt?: Timestamp;
}
