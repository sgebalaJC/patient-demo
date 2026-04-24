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
  documentId,
  startAfter,
  collection,
} from 'firebase/firestore';
import { collections, logAuthContext } from './base';
import { db } from '../firebase';
import { PrescriptionRefillRequest, ApiResponse, User } from '../../types';
import logger from "../logger";
import { audit } from "../audit";

// Prescription refill operations
export const prescriptionRefillOperations = {
  // Get patient names by IDs (batch fetch for efficiency). In sim mode the
  // caller passes `simulated: true` so we read from `simulation/native/users`
  // instead of the real users collection.
  async getPatientNamesByIds(
    patientIds: string[],
    simulated: boolean = false,
  ): Promise<ApiResponse<{ [patientId: string]: { firstName: string; lastName: string } }>> {
    try {
      if (patientIds.length === 0) {
        return { success: true, data: {} };
      }

      const usersRef = simulated ? collection(db, 'simulation/native/users') : collections.users;

      // Firestore 'in' queries support up to 10 items, so we need to batch larger queries
      const batchSize = 10;
      const patientNameMap: { [patientId: string]: { firstName: string; lastName: string } } = {};

      for (let i = 0; i < patientIds.length; i += batchSize) {
        const batchIds = patientIds.slice(i, i + batchSize);
        const patientsQuery = query(
          usersRef,
          where(documentId(), 'in', batchIds)
        );

        const patientsSnapshot = await getDocs(patientsQuery);

        patientsSnapshot.docs.forEach(doc => {
          const userData = doc.data() as User;
          patientNameMap[doc.id] = {
            firstName: userData.firstName,
            lastName: userData.lastName
          };
        });
      }

      return { success: true, data: patientNameMap };
    } catch (error: any) {
      logger.error('Error fetching patient names:', error);
      return { success: false, error: error.message };
    }
  },

  // Create prescription refill request
  async createRefillRequest(refillData: Omit<PrescriptionRefillRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiResponse<PrescriptionRefillRequest>> {
    try {
      logAuthContext('createRefillRequest');

      const newRefill = {
        ...refillData,
        status: refillData.status || 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collections.prescriptionRefills, newRefill);

      audit({ action: 'refill.requested', resourceType: 'prescription-refill', resourceId: docRef.id, metadata: { patientId: refillData.patientId, urgency: refillData.urgency } });
      return { success: true, data: { id: docRef.id, ...newRefill } as PrescriptionRefillRequest };
    } catch (error: any) {
      logger.error('Error creating refill request:', error);
      return { success: false, error: error.message };
    }
  },

  // Get all refill requests (for admin access). Cursor-based pagination —
  // matches `getPendingRefills` + `getPatientRefills` so the three admin
  // refill queries all behave the same way under deletions/concurrent writes.
  async getAllRefills(
    limitParam: number = 10,
    lastDocId?: string,
    statusFilter: 'all' | 'pending' | 'approved' | 'denied' | 'completed' = 'all'
  ): Promise<ApiResponse<{
    refills: PrescriptionRefillRequest[],
    total: number,
    lastDocId?: string,
    hasMore: boolean,
    statusCounts: {
      all: number,
      pending: number,
      approved: number,
      denied: number,
      completed: number
    }
  }>> {
    try {
      logAuthContext('getAllRefills');

      // Status-count rollup over the whole collection. Runs one full read;
      // acceptable at current volumes and kept here so the UI's tab counts
      // don't need a separate round-trip.
      const countSnapshot = await getDocs(query(collections.prescriptionRefills));
      const statusCounts = {
        all: countSnapshot.size,
        pending: 0,
        approved: 0,
        denied: 0,
        completed: 0,
      } as { all: number; pending: number; approved: number; denied: number; completed: number };
      countSnapshot.docs.forEach((d) => {
        const status = (d.data() as PrescriptionRefillRequest).status;
        if (status && status in statusCounts) {
          (statusCounts as any)[status] += 1;
        }
      });

      const total = statusFilter === 'all' ? statusCounts.all : statusCounts[statusFilter];

      // Cursor-paged fetch. One extra row is requested to detect hasMore
      // without a second count query.
      const baseConstraints: any[] = [];
      if (statusFilter !== 'all') baseConstraints.push(where('status', '==', statusFilter));
      baseConstraints.push(orderBy('createdAt', 'desc'));

      let cursorSnap = null;
      if (lastDocId) {
        const lastDocRef = doc(collections.prescriptionRefills, lastDocId);
        const snap = await getDoc(lastDocRef);
        if (snap.exists()) cursorSnap = snap;
        else logger.warn('Last document not found, starting from beginning');
      }

      const refillsQuery = cursorSnap
        ? query(collections.prescriptionRefills, ...baseConstraints, startAfter(cursorSnap), limit(limitParam + 1))
        : query(collections.prescriptionRefills, ...baseConstraints, limit(limitParam + 1));

      const snapshot = await getDocs(refillsQuery);
      const docs = snapshot.docs.map((d) => {
        const { doctorId: _legacy, ...rest } = d.data() as any;
        return { id: d.id, ...rest } as PrescriptionRefillRequest;
      });
      const hasMore = docs.length > limitParam;
      const refills = hasMore ? docs.slice(0, limitParam) : docs;
      const newLastDocId = refills.length > 0 ? refills[refills.length - 1].id : undefined;

      return {
        success: true,
        data: {
          refills,
          total,
          lastDocId: newLastDocId,
          hasMore,
          statusCounts,
        }
      };
    } catch (error: any) {
      logger.error('Error getting all refills:', error);
      return { success: false, error: error.message };
    }
  },

  // Get refill request by ID
  async getRefillRequest(refillId: string): Promise<ApiResponse<PrescriptionRefillRequest>> {
    try {
      const refillDoc = await getDoc(doc(collections.prescriptionRefills, refillId));
      if (refillDoc.exists()) {
        return { success: true, data: { id: refillId, ...refillDoc.data() } as PrescriptionRefillRequest };
      }
      return { success: false, error: 'Refill request not found' };
    } catch (error: any) {
      logger.error('Error getting refill request:', error);
      return { success: false, error: error.message };
    }
  },

  // Get patient refill requests - Already using cursor-based pagination
  async getPatientRefills(
    patientId: string,
    limitParam: number = 10,
    lastDocId?: string
  ): Promise<ApiResponse<{
    refills: PrescriptionRefillRequest[],
    total: number,
    lastDocId?: string,
    hasMore: boolean
  }>> {
    try {

      // Get total count (consider caching this for better performance)
      const countQuery = query(
        collections.prescriptionRefills,
        where('patientId', '==', patientId)
      );
      const countSnapshot = await getDocs(countQuery);
      const total = countSnapshot.size;

      // Build base query
      let refillsQuery = query(
        collections.prescriptionRefills,
        where('patientId', '==', patientId),
        orderBy('createdAt', 'desc'),
        limit(limitParam + 1) // Get one extra to check if there's a next page
      );

      // If we have a lastDocId, start after that document
      if (lastDocId) {
        try {
          const lastDocRef = doc(collections.prescriptionRefills, lastDocId);
          const lastDocSnap = await getDoc(lastDocRef);
          if (lastDocSnap.exists()) {
            refillsQuery = query(
              collections.prescriptionRefills,
              where('patientId', '==', patientId),
              orderBy('createdAt', 'desc'),
              startAfter(lastDocSnap),
              limit(limitParam + 1)
            );
          } else {
            logger.warn('Last document not found, starting from beginning');
            // If the lastDoc doesn't exist, start from beginning
            lastDocId = undefined;
          }
        } catch (error) {
          logger.error('Error fetching lastDoc, starting from beginning:', error);
          // If there's an error with the lastDoc, start from beginning
          lastDocId = undefined;
        }
      }

      const snapshot = await getDocs(refillsQuery);
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PrescriptionRefillRequest));

      // Check if there are more pages
      const hasMore = docs.length > limitParam;

      // Remove the extra document if it exists
      const refills = hasMore ? docs.slice(0, limitParam) : docs;

      // Get the last document ID for next page
      const newLastDocId = refills.length > 0 ? refills[refills.length - 1].id : undefined;

      return {
        success: true,
        data: {
          refills,
          total,
          lastDocId: newLastDocId,
          hasMore
        }
      };
    } catch (error: any) {
      logger.error('Error getting patient refills:', error);
      return { success: false, error: error.message };
    }
  },

  // Get all pending refills (for admin access) - Updated with cursor-based pagination
  async getPendingRefills(
    limitParam: number = 10,
    lastDocId?: string
  ): Promise<ApiResponse<{
    refills: PrescriptionRefillRequest[],
    total: number,
    lastDocId?: string,
    hasMore: boolean
  }>> {
    try {

      // First get total count
      const countQuery = query(
        collections.prescriptionRefills,
        where('status', '==', 'pending')
      );
      const countSnapshot = await getDocs(countQuery);
      const total = countSnapshot.size;

      // Build base query
      let refillsQuery = query(
        collections.prescriptionRefills,
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc'),
        limit(limitParam + 1) // Get one extra to check if there's a next page
      );

      // If we have a lastDocId, start after that document
      if (lastDocId) {
        try {
          const lastDocRef = doc(collections.prescriptionRefills, lastDocId);
          const lastDocSnap = await getDoc(lastDocRef);
          if (lastDocSnap.exists()) {
            refillsQuery = query(
              collections.prescriptionRefills,
              where('status', '==', 'pending'),
              orderBy('createdAt', 'desc'),
              startAfter(lastDocSnap),
              limit(limitParam + 1)
            );
          } else {
            logger.warn('Last document not found, starting from beginning');
            lastDocId = undefined;
          }
        } catch (error) {
          logger.error('Error fetching lastDoc, starting from beginning:', error);
          lastDocId = undefined;
        }
      }

      const snapshot = await getDocs(refillsQuery);
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PrescriptionRefillRequest));

      // Check if there are more pages
      const hasMore = docs.length > limitParam;

      // Remove the extra document if it exists
      const refills = hasMore ? docs.slice(0, limitParam) : docs;

      // Get the last document ID for next page
      const newLastDocId = refills.length > 0 ? refills[refills.length - 1].id : undefined;

      return {
        success: true,
        data: {
          refills,
          total,
          lastDocId: newLastDocId,
          hasMore
        }
      };
    } catch (error: any) {
      logger.error('Error getting pending refills:', error);
      return { success: false, error: error.message };
    }
  },

  // Update refill request
  async updateRefillRequest(refillId: string, updates: Partial<PrescriptionRefillRequest>): Promise<ApiResponse<PrescriptionRefillRequest>> {
    try {
      logAuthContext('updateRefillRequest');

      const refillRef = doc(collections.prescriptionRefills, refillId);
      const updateData = {
        ...updates,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(refillRef, updateData);
      const updatedRefill = await getDoc(refillRef);

      audit({ action: 'refill.updated', resourceType: 'prescription-refill', resourceId: refillId, metadata: { newStatus: updates.status } });
      return { success: true, data: { id: refillId, ...updatedRefill.data() } as PrescriptionRefillRequest };
    } catch (error: any) {
      logger.error('Error updating refill request:', error);
      return { success: false, error: error.message };
    }
  },

  // Approve refill request
  async approveRefill(refillId: string, doctorNotes?: string): Promise<ApiResponse<PrescriptionRefillRequest>> {
    try {
      return await this.updateRefillRequest(refillId, {
        status: 'approved',
        doctorNotes: doctorNotes,
      });
    } catch (error: any) {
      logger.error('Error approving refill:', error);
      return { success: false, error: error.message };
    }
  },

  // Deny refill request
  async denyRefill(refillId: string, doctorNotes: string): Promise<ApiResponse<PrescriptionRefillRequest>> {
    try {
      return await this.updateRefillRequest(refillId, {
        status: 'denied',
        doctorNotes: doctorNotes,
      });
    } catch (error: any) {
      logger.error('Error denying refill:', error);
      return { success: false, error: error.message };
    }
  },

  // Complete refill request
  async completeRefill(refillId: string): Promise<ApiResponse<PrescriptionRefillRequest>> {
    try {
      return await this.updateRefillRequest(refillId, {
        status: 'completed',
      });
    } catch (error: any) {
      logger.error('Error completing refill:', error);
      return { success: false, error: error.message };
    }
  },

  // Update refill status (convenience method for admin/doctor use)
  async updateRefillStatus(refillId: string, status: PrescriptionRefillRequest['status'], doctorNotes?: string): Promise<ApiResponse<PrescriptionRefillRequest>> {
    try {
      const updates: Partial<PrescriptionRefillRequest> = {
        status,
        ...(doctorNotes && { doctorNotes }),
      };

      return await this.updateRefillRequest(refillId, updates);
    } catch (error: any) {
      logger.error('Error updating refill status:', error);
      return { success: false, error: error.message };
    }
  },

  // Delete refill request (soft delete by updating status)
  async deleteRefillRequest(refillId: string): Promise<ApiResponse<boolean>> {
    try {
      const refillRef = doc(collections.prescriptionRefills, refillId);
      await updateDoc(refillRef, {
        status: 'cancelled',
        updatedAt: serverTimestamp(),
      });

      return { success: true, data: true };
    } catch (error: any) {
      logger.error('Error deleting refill request:', error);
      return { success: false, error: error.message };
    }
  },
};