import {
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  orderBy,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { collections } from './base';
import logger from '../logger';

export interface DormantPatient {
  id: string;
  drchronoId?: number;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email?: string;
  gender?: 'male' | 'female' | 'other';
  dateOfBirth?: any;
  isActive: boolean;
  isMinor?: boolean;
  createdAt: any;
  updatedAt: any;
}

export const dormantPatientOperations = {
  async getAll(
    pageSize: number = 10,
    page: number = 1,
    searchQuery?: string
  ): Promise<{
    patients: DormantPatient[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const q = query(
        collections.users,
        where('isActive', '==', false),
        where('role', '==', 'patient'),
        orderBy('lastName', 'asc')
      );
      const snapshot = await getDocs(q);

      let all: DormantPatient[] = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      } as DormantPatient));

      if (searchQuery?.trim()) {
        const sq = searchQuery.toLowerCase().trim();
        all = all.filter(p => {
          const name = `${p.firstName} ${p.lastName}`.toLowerCase();
          return name.includes(sq) ||
            (p.email || '').toLowerCase().includes(sq) ||
            (p.phoneNumber || '').includes(sq);
        });
      }

      const total = all.length;
      const start = (page - 1) * pageSize;
      const paginated = all.slice(start, start + pageSize);

      return { patients: paginated, total, hasMore: start + pageSize < total };
    } catch (error: any) {
      logger.error('Error fetching dormant patients:', error);
      return { patients: [], total: 0, hasMore: false };
    }
  },

  async updateContact(id: string, data: { email?: string; phoneNumber?: string }): Promise<boolean> {
    try {
      const ref = doc(collections.users, id);
      await updateDoc(ref, {
        ...data,
        updatedAt: serverTimestamp(),
      });
      return true;
    } catch (error: any) {
      logger.error('Error updating dormant patient:', error);
      return false;
    }
  },

  async remove(id: string): Promise<boolean> {
    try {
      await deleteDoc(doc(collections.users, id));
      return true;
    } catch (error: any) {
      logger.error('Error removing dormant patient:', error);
      return false;
    }
  },
};
