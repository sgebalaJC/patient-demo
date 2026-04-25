import { Timestamp } from 'firebase/firestore';

export type UserRole = 'patient' | 'admin' | 'super_admin';

export interface User {
  id: string;
  email?: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phoneNumber: string;
  dateOfBirth?: Timestamp;
  /**
   * Server-stamped on first write. `null` only for the synthesized super-admin
   * profile (no Firestore users/<uid> doc exists), which AuthContext fabricates
   * client-side. Anywhere reading these should already be branching on role.
   */
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
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

export type Staff = Admin;

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
  parentAccountId?: string;
  childAccountIds?: string[];
  isMinor?: boolean;
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
