import { Timestamp } from 'firebase/firestore';

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
  doctorId?: string;
  fileName: string;
  originalFileName: string;
  fileUrl: string;
  fileSize: number;
  fileType: string;
  documentType: DocumentType;
  description?: string;
  uploadedAt: Timestamp;
  isActive: boolean;
  tags?: string[];
  metadata?: {
    [key: string]: any;
  };
}
