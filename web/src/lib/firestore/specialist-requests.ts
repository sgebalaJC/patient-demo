import {
  doc,
  addDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { collections } from './base';
import { SpecialistRequest, SpecialistRequestStatus, ApiResponse } from '../../types';
import logger from '../logger';
import { errorMessage } from '../errors';

export const specialistRequestOperations = {
  // Create a specialist request.
  //
  // Patient self-service uses the default `pending` status — admin then
  // confirms via the existing confirm modal.
  //
  // Admin-composed referrals (office receives a confirmed appointment from
  // the specialist over the phone) pass `status: 'confirmed'` plus
  // `confirmedBy` so the row lands already-approved without round-tripping
  // through pending. The companion appointment is still created by the
  // caller — this op only writes the referral row.
  async createRequest(
    patientId: string,
    specialistType: string,
    reason: string,
    notes?: string,
    options?: { status?: SpecialistRequestStatus; confirmedBy?: string },
  ): Promise<ApiResponse<SpecialistRequest>> {
    try {
      const status = options?.status ?? 'pending';
      const data: Record<string, unknown> = {
        patientId,
        specialistType,
        reason,
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(notes ? { notes } : {}),
      };
      if (status === 'confirmed' && options?.confirmedBy) {
        data.confirmedBy = options.confirmedBy;
        data.confirmedAt = Timestamp.now();
      }

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
