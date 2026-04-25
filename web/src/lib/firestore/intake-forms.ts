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
  DocumentData,
} from 'firebase/firestore';
import { collections, mapDoc } from './base';
import { PatientIntakeForm, ApiResponse } from '../../types';
import logger from "../logger";
import { errorMessage } from '../errors';

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
      const mapped = snapshot.empty ? null : mapDoc<PatientIntakeForm>(snapshot.docs[0]);
      if (mapped) return { success: true, data: mapped };
      return { success: false, error: 'No intake form found' };
    } catch (error: unknown) {
      logger.error('Error getting intake form:', error);
      return { success: false, error: errorMessage(error) };
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

      // Read back to pick up server-resolved timestamps — beats hand-forging
      // the shape with `as unknown as Timestamp` casts.
      const snap = await getDoc(docRef);
      const mapped = mapDoc<PatientIntakeForm>(snap);
      if (!mapped) return { success: false, error: 'Failed to read back created form' };
      return { success: true, data: mapped };
    } catch (error: unknown) {
      logger.error('Error creating intake form:', error);
      return { success: false, error: errorMessage(error) };
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

      // Stamp completion via serverTimestamp() so we don't store client clocks.
      cleanedData.completedAt = serverTimestamp();

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
    } catch (error: unknown) {
      logger.error('Error updating intake form section:', error);
      return { success: false, error: errorMessage(error) };
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
    } catch (error: unknown) {
      logger.error('Error updating current section:', error);
      return { success: false, error: errorMessage(error) };
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
    } catch (error: unknown) {
      logger.error('Error completing intake form:', error);
      return { success: false, error: errorMessage(error) };
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
    } catch (error: unknown) {
      logger.error('Error getting submitted forms:', error);
      return { success: false, error: errorMessage(error) };
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
    } catch (error: unknown) {
      logger.error('Error approving intake form:', error);
      return { success: false, error: errorMessage(error) };
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
    } catch (error: unknown) {
      logger.error('Error sending back intake form:', error);
      return { success: false, error: errorMessage(error) };
    }
  },
};
