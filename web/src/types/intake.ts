import { Timestamp } from 'firebase/firestore';

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
  medicalHistory?: string;
  hospitalizations?: string;
  pastSurgicalHistory?: string;
  currentMedications?: string;

  allergies: Array<{
    allergen: string;
    reaction: string;
  }>;

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

  patientInfo?: PatientInfoForm;
  medicalHistory?: MedicalHistoryForm;
  familyHistory?: FamilyHistoryForm;
  consentForm?: ConsentForm;
  conciergeAgreement?: ConciergeAgreement;

  completedSections: string[];
  currentSection: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
  approvedAt?: Timestamp;

  reviewedBy?: string;
  reviewNotes?: string;
}
