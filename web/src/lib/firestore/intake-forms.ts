import {
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  DocumentData,
} from 'firebase/firestore';
import { collections } from './base';
import { PatientIntakeForm, ApiResponse } from '../../types';
import logger from "../logger";

// Patient intake form operations
export const intakeFormOperations = {
  // Get patient intake form
  async getPatientIntakeForm(patientId: string): Promise<ApiResponse<PatientIntakeForm>> {
    try {
      const formsQuery = query(
        collections.patientIntakeForms,
        where('patientId', '==', patientId),
        orderBy('createdAt', 'desc'),
        limit(1)
      );

      const snapshot = await getDocs(formsQuery);
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return { success: true, data: { id: doc.id, ...doc.data() } as PatientIntakeForm };
      }

      return { success: false, error: 'No intake form found' };
    } catch (error: any) {
      logger.error('Error getting intake form:', error);
      return { success: false, error: error.message };
    }
  },

  // Create new intake form
  async createIntakeForm(patientId: string): Promise<ApiResponse<PatientIntakeForm>> {
    try {
      const newIntakeForm = {
        patientId,
        status: 'draft' as const,
        completedSections: [],
        currentSection: 'patient-info',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collections.patientIntakeForms, newIntakeForm);

      const formWithTimestamp = { 
        id: docRef.id, 
        ...newIntakeForm,
        createdAt: newIntakeForm.createdAt as unknown as Timestamp,
        updatedAt: newIntakeForm.updatedAt as unknown as Timestamp
      };
      return { success: true, data: formWithTimestamp as unknown as PatientIntakeForm };
    } catch (error: any) {
      logger.error('Error creating intake form:', error);
      return { success: false, error: error.message };
    }
  },

  // Update a specific section of the intake form
  async updateIntakeFormSection(formId: string, sectionName: string, sectionData: Record<string, unknown>): Promise<ApiResponse<boolean>> {
    try {
      const formRef = doc(collections.patientIntakeForms, formId);

      // Clean the data to remove undefined values
      const cleanedData: Record<string, unknown> = {};
      Object.entries(sectionData).forEach(([key, value]) => {
        if (value !== undefined) {
          cleanedData[key] = value;
        }
      });

      const updateData: Record<string, unknown> = {
        [sectionName]: cleanedData,
        completedSections: [],
        updatedAt: serverTimestamp(),
      };

      // Get current form to update completed sections
      const currentForm = await getDoc(formRef);
      if (currentForm.exists()) {
        const currentData = currentForm.data();
        const currentCompleted = currentData.completedSections || [];

        // Add this section to completed sections if not already there
        if (!currentCompleted.includes(sectionName)) {
          updateData.completedSections = [...currentCompleted, sectionName];
        } else {
          updateData.completedSections = currentCompleted;
        }
      }

      await updateDoc(formRef, updateData);

      return { success: true, data: true };
    } catch (error: any) {
      logger.error('Error updating intake form section:', error);
      return { success: false, error: error.message };
    }
  },

  // Update current section for navigation state persistence
  async updateIntakeFormCurrentSection(formId: string, currentSection: string): Promise<ApiResponse<boolean>> {
    try {
      const formRef = doc(collections.patientIntakeForms, formId);
      await updateDoc(formRef, {
        currentSection,
        updatedAt: serverTimestamp(),
      });

      return { success: true, data: true };
    } catch (error: any) {
      logger.error('Error updating current section:', error);
      return { success: false, error: error.message };
    }
  },

  // Complete the entire intake form (patient submits)
  async completeIntakeForm(formId: string): Promise<ApiResponse<boolean>> {
    try {
      const formRef = doc(collections.patientIntakeForms, formId);
      await updateDoc(formRef, {
        status: 'completed',
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return { success: true, data: true };
    } catch (error: any) {
      logger.error('Error completing intake form:', error);
      return { success: false, error: error.message };
    }
  },

  // Admin: get all submitted/completed intake forms
  async getAllSubmittedForms(): Promise<ApiResponse<PatientIntakeForm[]>> {
    try {
      const formsQuery = query(
        collections.patientIntakeForms,
        where('status', 'in', ['completed', 'approved', 'in_progress']),
        orderBy('updatedAt', 'desc')
      );
      const snapshot = await getDocs(formsQuery);
      const forms = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PatientIntakeForm));
      return { success: true, data: forms };
    } catch (error: any) {
      logger.error('Error getting submitted forms:', error);
      return { success: false, error: error.message };
    }
  },

  // Admin: approve intake form
  async approveIntakeForm(formId: string, reviewedBy: string): Promise<ApiResponse<boolean>> {
    try {
      const formRef = doc(collections.patientIntakeForms, formId);
      await updateDoc(formRef, {
        status: 'approved',
        approvedAt: serverTimestamp(),
        reviewedBy,
        updatedAt: serverTimestamp(),
      });
      return { success: true, data: true };
    } catch (error: any) {
      logger.error('Error approving intake form:', error);
      return { success: false, error: error.message };
    }
  },

  // Admin: send back to in_progress (needs corrections)
  async sendBackIntakeForm(formId: string, reviewedBy: string, reviewNotes?: string): Promise<ApiResponse<boolean>> {
    try {
      const formRef = doc(collections.patientIntakeForms, formId);
      await updateDoc(formRef, {
        status: 'in_progress',
        reviewedBy,
        ...(reviewNotes ? { reviewNotes } : {}),
        approvedAt: null,
        completedAt: null,
        updatedAt: serverTimestamp(),
      });

      // Clear the patient's intakeFormSkipped flag so banner reappears
      // We need the patientId from the form
      const formDoc = await getDoc(formRef);
      if (formDoc.exists()) {
        const patientId = (formDoc.data() as DocumentData).patientId;
        if (patientId) {
          const userRef = doc(collections.users, patientId);
          await updateDoc(userRef, { intakeFormSkipped: false });
        }
      }

      return { success: true, data: true };
    } catch (error: any) {
      logger.error('Error sending back intake form:', error);
      return { success: false, error: error.message };
    }
  },
};
