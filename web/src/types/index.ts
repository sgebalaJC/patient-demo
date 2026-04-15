import { Timestamp } from 'firebase/firestore';

export type UserRole = 'patient' | 'assistant' | 'admin';

export interface User {
  id: string;
  email?: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phoneNumber: string;
  dateOfBirth?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isActive: boolean;
  phoneVerified?: boolean;
  lastLoginAt?: Timestamp;
  tutorialCompletedSections?: string[];
  tutorialSkippedSections?: string[];
  tutorialDismissedAt?: Timestamp;
  intakeFormSkipped?: boolean;
}

export interface Admin extends User {
  role: 'admin';
  specialization?: string;
  licenseNumber?: string;
  experience?: number;
  workingHours?: {
    [key: string]: {
      start: string;
      end: string;
      isAvailable: boolean;
    };
  };
  consultationFee?: number;
  languages?: string[];
}

export interface Assistant extends User {
  role: 'assistant';
  department: string;
  supervisorId?: string;
  permissions: string[];
  workingHours: {
    [key: string]: {
      start: string;
      end: string;
      isAvailable: boolean;
    };
  };
  languages: string[];
}

export type Staff = Admin | Assistant;

export interface Patient extends User {
  role: 'patient';
  dateOfBirth: Timestamp;
  gender: 'male' | 'female' | 'other';
  bloodType?: string;
  allergies: string[];
  medicalHistory: string[];
  emergencyContact: {
    name: string;
    relationship: string;
    phoneNumber: string;
  };
  assignedDoctors: string[];
  insuranceInfo?: {
    provider: string;
    policyNumber: string;
    groupNumber?: string;
  };
  drchronoId?: number;
  parentAccountId?: string; // For child/dependent accounts — links to parent's user doc UID
  childAccountIds?: string[]; // UIDs of linked child/dependent accounts
  isMinor?: boolean; // Under 18 — cannot log in, messages route to parent
}

export interface Appointment {
  id: string;
  patientId: string;
  appointmentDate: Timestamp;
  duration?: number; // in minutes
  appointmentType?: 'consultation' | 'follow-up' | 'physical' | 'urgent';
  reason?: string;
  notes?: string;
  status: 'scheduled' | 'confirmed' | 'in-progress' | 'completed' | 'cancelled' | 'no-show';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  reminderSent: boolean;
  reminderMessage?: string; // Custom SMS text — becomes Calendar event description
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
  // Filled by admin on confirmation
  appointmentId?: string;
  confirmedBy?: string;
  confirmedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

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
  recipientId?: string; // specific user, or omit for all admins
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  readBy: { [uid: string]: Timestamp };
  meta: { [key: string]: string }; // type-specific data for deep linking
  createdAt: Timestamp;
  readAt?: Timestamp;
}

export interface PrescriptionRefillRequest {
  id: string;
  patientId: string;
  medicationName: string;
  dosage: string;
  quantity: string;
  pharmacyAddress?: string;
  pharmacyName: string;
  pharmacyPhone?: string;
  prescriptionNumber?: string;
  originalPrescriptionDate?: Timestamp;
  requestedDate: Timestamp;
  urgency: 'routine' | 'urgent' | 'emergency';
  status: 'pending' | 'approved' | 'denied' | 'completed' | 'cancelled';
  notes?: string;
  doctorNotes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type DocumentType = 
  | 'drivers_license'
  | 'insurance_card_front'
  | 'insurance_card_back'
  | 'medical_records'
  | 'lab_results'
  | 'advance_directive'
  | 'prescription'
  | 'other';

export interface PatientDocument {
  id: string;
  patientId: string;
  doctorId?: string; // Doctor who uploaded (if applicable)
  fileName: string;
  originalFileName: string;
  fileUrl: string;
  fileSize: number;
  fileType: string; // MIME type
  documentType: DocumentType;
  description?: string;
  uploadedAt: Timestamp;
  isActive: boolean;
  tags?: string[];
  metadata?: {
    [key: string]: any;
  };
}

export interface PatientInfoForm {
  // Patient Information
  fullName: string;
  dateOfBirth: string;
  phoneNumber: string;
  gender: 'male' | 'female';
  emailAddress: string;
  address: string;

  // Emergency Contact
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;

  // Insurance Information
  insuranceProvider?: string;
  policyNumber?: string;
  groupNumber?: string;

  // Preferred Pharmacy
  pharmacyName?: string;
  pharmacyPhone?: string;
  pharmacyAddress?: string;

  completedAt: Timestamp;
}

export interface MedicalHistoryForm {
  // Medical History (free text)
  medicalHistory?: string;

  // Hospitalizations (free text)
  hospitalizations?: string;

  // Past Surgical History (free text)
  pastSurgicalHistory?: string;

  // Current Medications (free text)
  currentMedications?: string;

  // Allergies
  allergies: Array<{
    allergen: string;
    reaction: string;
  }>;

  // Social History
  smokingStatus: 'never' | 'former' | 'current';
  smokingDetails?: string;
  alcoholConsumption: 'none' | 'occasional' | 'moderate' | 'heavy';
  alcoholDetails?: string;
  exerciseFrequency: 'none' | 'rarely' | 'weekly' | 'daily';
  exerciseDetails?: string;

  completedAt?: Timestamp;
}

export const FAMILY_HISTORY_CONDITIONS = [
  'Heart Disease',
  'High Blood Pressure',
  'Stroke',
  'Diabetes',
  'Cancer',
  'Asthma / Lung Disease',
  'Mental Health (Depression, Anxiety)',
  'Kidney Disease',
  'Liver Disease',
  'Autoimmune Disorder',
  'Blood Disorder',
  'Alzheimer\'s / Dementia',
] as const;

export type FamilyRelation = 'mother' | 'father' | 'sibling' | 'grandparent' | 'other';

export interface FamilyHistoryEntry {
  condition: string;
  relation: FamilyRelation;
  details?: string;
}

export interface FamilyHistoryForm {
  conditions: FamilyHistoryEntry[];
  otherHistory?: string;
  completedAt?: Timestamp;
}

export interface ConsentForm {
  treatmentConsent: boolean;
  hipaaConsent: boolean;
  financialResponsibility: boolean;
  communicationConsent: boolean;
  telemedConsent: boolean;
  emergencyConsent: boolean;
  photographyConsent: boolean;
  researchParticipation: boolean;
  marketingCommunications: boolean;
  patientSignature: string;
  signatureDate: string;
  completedAt?: Timestamp;
}

export interface ConciergeAgreement {
  membershipPlan: 'basic' | 'premium' | 'executive';
  membershipDuration: 'monthly' | 'annual';
  agreementAcceptance: boolean;
  paymentAuthorization: boolean;
  serviceAgreement: boolean;
  cancellationPolicy: boolean;
  emergencyContact?: {
    name: string;
    relationship: string;
    phoneNumber: string;
  };
  preferredAppointmentTimes: string[];
  communicationPreferences: string[];
  specialRequests?: string;
  patientSignature: string;
  signatureDate: string;
  completedAt?: Timestamp;
}

export interface PatientIntakeForm {
  id: string;
  patientId: string;
  status: 'draft' | 'in_progress' | 'completed' | 'approved' | 'rejected';

  // Form Sections
  patientInfo?: PatientInfoForm;
  medicalHistory?: MedicalHistoryForm;
  familyHistory?: FamilyHistoryForm;
  consentForm?: ConsentForm;
  conciergeAgreement?: ConciergeAgreement;

  // Progress Tracking
  completedSections: string[];
  currentSection: string;

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
  approvedAt?: Timestamp;

  // Admin Review
  reviewedBy?: string;
  reviewNotes?: string;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Form types
export interface CreateAppointmentData {
  appointmentDate: Date;
  duration: number;
  appointmentType: Appointment['appointmentType'];
}

export interface UpdateUserProfileData {
  firstName?: string;
  lastName?: string;
  phoneNumber: string;
}

export interface DoctorProfileData extends UpdateUserProfileData {
  specialization?: string;
  experience?: number;
  consultationFee?: number;
  biography?: string;
  languages?: string[];
}

export interface PatientProfileData extends UpdateUserProfileData {
  dateOfBirth?: Date;
  gender?: Patient['gender'];
  bloodType?: string;
  allergies?: string[];
  emergencyContact?: Patient['emergencyContact'];
  insuranceInfo?: Patient['insuranceInfo'];
}

declare global {
  namespace google.maps {
      interface PlacesLibrary {
        BasicPlaceAutocompleteElement: typeof google.maps.places.BasicPlaceAutocompleteElement;
      }

      namespace places {
        class BasicPlaceAutocompleteElement extends HTMLElement {
          value: string;
          placeholder: string;
          includedPrimaryTypes: string[];
          requestedLanguage: string;
          includedRegionCodes: string[];
          locationBias: any;
          locationRestriction: any;

          addEventListener(
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | AddEventListenerOptions
          ): void;
        }
      }
    }
}

// ─── Stripe billing ──────────────────────────────────────────────────────────

/**
 * Admin-managed subscription plan. Document id = Stripe price id.
 * Admins add rows via AdminSubscriptionPlansPage after creating products in
 * the Stripe dashboard.
 */
export interface SubscriptionPlan {
  id: string;
  /** Display name shown to patients, e.g. "Concierge Monthly" */
  name: string;
  /** Short marketing description */
  description?: string;
  /** Amount in smallest currency unit (cents). Informational only — Stripe is the source of truth. */
  amount: number;
  /** Three-letter ISO currency, e.g. "usd" */
  currency: string;
  /** Stripe recurring interval, e.g. "month" | "year" */
  interval: 'day' | 'week' | 'month' | 'year';
  /** Whether this plan is currently offered to patients */
  active: boolean;
  /** Ordered feature bullet points shown on the subscribe page */
  features?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/**
 * Per-patient subscription state. Document id = patient uid.
 * Mirrored from Stripe by the stripeWebhook Cloud Function — never edit
 * directly from the client.
 */
export interface PatientSubscription {
  id: string;
  status: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  priceId?: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: number | null;
  endedAt?: number | null;
  updatedAt?: Timestamp;
}
