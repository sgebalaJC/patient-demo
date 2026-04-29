import {
  doc,
  addDoc,
  getDocs,
  updateDoc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { collections } from './base';
import { PatientDocument, DocumentType, ApiResponse } from '../../types';
import logger from '../logger';
import { errorMessage } from '../errors';
import { audit } from '../audit';

// Document operations
export const documentOperations = {
  // Create document
  async createDocument(documentData: Omit<PatientDocument, 'id' | 'uploadedAt'>): Promise<ApiResponse<PatientDocument>> {
    try {
      // Remove undefined fields to prevent Firestore errors
      const cleanedData: Record<string, unknown> = {};
      Object.entries(documentData).forEach(([key, value]) => {
        if (value !== undefined) {
          cleanedData[key] = value;
        }
      });

      const newDocument = {
        ...cleanedData,
        uploadedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collections.patientDocuments, newDocument);
      audit({ action: 'document.uploaded', resourceType: 'patient-document', resourceId: docRef.id, metadata: { patientId: documentData.patientId, documentType: documentData.documentType } });
      return { success: true, data: { id: docRef.id, ...newDocument } as PatientDocument };
    } catch (error: unknown) {
      logger.error('Error creating document:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  // Get patient documents. Routes through `collections.patientDocuments`;
  // sim-mode singleton remaps to `simulation/native/patient-documents` when on.
  async getPatientDocuments(
    patientId: string,
  ): Promise<ApiResponse<PatientDocument[]>> {
    try {
      const documentsQuery = query(
        collections.patientDocuments,
        where('isActive', '==', true),
        where('patientId', '==', patientId),
      );

      const snapshot = await getDocs(documentsQuery);

      const documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PatientDocument));

      // Sort by uploadedAt in descending order (newest first) on the client side
      const sortedDocuments = documents.sort((a, b) => {
        const aTime = a.uploadedAt?.toDate?.() || new Date(0);
        const bTime = b.uploadedAt?.toDate?.() || new Date(0);
        return bTime.getTime() - aTime.getTime();
      });

      return { success: true, data: sortedDocuments };
    } catch (error: unknown) {
      logger.error('Error getting patient documents:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  // Delete document (soft delete)
  async deleteDocument(documentId: string): Promise<ApiResponse<boolean>> {
    try {
      const documentRef = doc(collections.patientDocuments, documentId);
      await updateDoc(documentRef, {
        isActive: false,
        updatedAt: serverTimestamp(),
      });

      audit({ action: 'document.deleted', resourceType: 'patient-document', resourceId: documentId });
      return { success: true, data: true };
    } catch (error: unknown) {
      logger.error('Error deleting document:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  // Get documents by type
  async getDocumentsByType(patientId: string, documentType: DocumentType): Promise<ApiResponse<PatientDocument[]>> {
    try {
      const documentsQuery = query(
        collections.patientDocuments,
        where('patientId', '==', patientId),
        where('documentType', '==', documentType),
        where('isActive', '==', true)
      );

      const snapshot = await getDocs(documentsQuery);
      const documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PatientDocument));

      // Sort by uploadedAt in descending order (newest first)
      const sortedDocuments = documents.sort((a, b) => {
        const aTime = a.uploadedAt?.toDate?.() || new Date(0);
        const bTime = b.uploadedAt?.toDate?.() || new Date(0);
        return bTime.getTime() - aTime.getTime();
      });

      return { success: true, data: sortedDocuments };
    } catch (error: unknown) {
      logger.error('Error getting documents by type:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  // Get documents by multiple types
  async getDocumentsByTypes(patientId: string, documentTypes: DocumentType[]): Promise<ApiResponse<PatientDocument[]>> {
    try {
      const documentsQuery = query(
        collections.patientDocuments,
        where('patientId', '==', patientId),
        where('documentType', 'in', documentTypes),
        where('isActive', '==', true)
      );

      const snapshot = await getDocs(documentsQuery);
      const documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PatientDocument));

      // Sort by uploadedAt in descending order (newest first)
      const sortedDocuments = documents.sort((a, b) => {
        const aTime = a.uploadedAt?.toDate?.() || new Date(0);
        const bTime = b.uploadedAt?.toDate?.() || new Date(0);
        return bTime.getTime() - aTime.getTime();
      });

      return { success: true, data: sortedDocuments };
    } catch (error: unknown) {
      logger.error('Error getting documents by types:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  // Check if patient has specific document type
  async hasDocumentType(patientId: string, documentType: DocumentType): Promise<ApiResponse<boolean>> {
    try {
      const result = await this.getDocumentsByType(patientId, documentType);
      if (result.success && result.data) {
        return { success: true, data: result.data.length > 0 };
      }
      return { success: false, error: result.error };
    } catch (error: unknown) {
      logger.error('Error checking document type:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  // Get required documents status for patient
  async getRequiredDocumentsStatus(patientId: string): Promise<ApiResponse<{ [key in DocumentType]?: boolean }>> {
    try {
      const requiredDocTypes: DocumentType[] = [
        'drivers_license',
        'insurance_card_front',
        'insurance_card_back'
      ];

      const status: { [key in DocumentType]?: boolean } = {};

      for (const docType of requiredDocTypes) {
        const result = await this.hasDocumentType(patientId, docType);
        if (result.success) {
          status[docType] = result.data || false;
        }
      }

      return { success: true, data: status };
    } catch (error: unknown) {
      logger.error('Error getting required documents status:', error);
      return { success: false, error: errorMessage(error) };
    }
  },
};
