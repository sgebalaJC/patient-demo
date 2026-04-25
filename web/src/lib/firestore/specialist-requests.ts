import {
  doc,
  addDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { collections } from './base';
import { SpecialistRequest, ApiResponse } from '../../types';
import logger from '../logger';
import { errorMessage } from '../errors';

export const specialistRequestOperations = {
  // Create a specialist request (patient)
  async createRequest(
    patientId: string,
    specialistType: string,
    reason: string,
    notes?: string,
  ): Promise<ApiResponse<SpecialistRequest>> {
    try {
      const data = {
        patientId,
        specialistType,
        reason,
        status: 'pending' as const,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(notes ? { notes } : {}),
      };

      const docRef = await addDoc(collections.specialistRequests, data);
      return { success: true, data: { id: docRef.id, ...data } as SpecialistRequest };
    } catch (error: unknown) {
      logger.error('Error creating specialist request:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  // Get requests for a patient
  async getPatientRequests(patientId: string): Promise<ApiResponse<SpecialistRequest[]>> {
    try {
      const q = query(
        collections.specialistRequests,
        where('patientId', '==', patientId),
        orderBy('createdAt', 'desc'),
      );
      const snapshot = await getDocs(q);
      const requests = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SpecialistRequest));
      return { success: true, data: requests };
    } catch (error: unknown) {
      logger.error('Error getting patient specialist requests:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  // Get all requests (admin)
  async getAllRequests(): Promise<ApiResponse<SpecialistRequest[]>> {
    try {
      const q = query(
        collections.specialistRequests,
        orderBy('createdAt', 'desc'),
      );
      const snapshot = await getDocs(q);
      const requests = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SpecialistRequest));
      return { success: true, data: requests };
    } catch (error: unknown) {
      logger.error('Error getting all specialist requests:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  // Update a request (admin confirms/cancels)
  async updateRequest(
    requestId: string,
    updates: Partial<SpecialistRequest>,
  ): Promise<ApiResponse<void>> {
    try {
      const ref = doc(collections.specialistRequests, requestId);
      await updateDoc(ref, {
        ...updates,
        updatedAt: serverTimestamp(),
      });
      return { success: true };
    } catch (error: unknown) {
      logger.error('Error updating specialist request:', error);
      return { success: false, error: errorMessage(error) };
    }
  },
};
