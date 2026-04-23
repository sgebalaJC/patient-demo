import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  startAfter,
  endBefore,
  limitToLast,
  serverTimestamp,
  Timestamp,
  DocumentSnapshot,
  QueryDocumentSnapshot,
  getCountFromServer,
  collection,
  where,
  CollectionReference,
} from 'firebase/firestore';
import { collections } from './base';
import { db } from '../firebase';
import { User, ApiResponse } from '../../types';
import { isAdminRole } from '../roles';
import logger from "../logger";

export type UserSortField = 'lastName' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

/**
 * Look up users whose `phoneNumber` exactly matches one of the given numbers.
 * Used to attribute inbound SMS / fax replies to a known patient. Honors
 * simulation mode so seeded inbound messages can match seeded patients.
 *
 * Firestore caps `where … in […]` at 30 values per query, so we batch.
 * Returns a Map keyed by the normalized phone (e.164) for O(1) lookup.
 */
export async function findUsersByPhones(
  phones: string[],
  simulated = false,
): Promise<Map<string, User>> {
  const result = new Map<string, User>();
  const distinct = Array.from(new Set(phones.filter(Boolean)));
  if (distinct.length === 0) return result;
  const usersRef = simulated
    ? (collection(db, 'simulation/native/users') as CollectionReference)
    : collections.users;
  for (let i = 0; i < distinct.length; i += 30) {
    const chunk = distinct.slice(i, i + 30);
    const snap = await getDocs(query(usersRef, where('phoneNumber', 'in', chunk)));
    snap.docs.forEach((d) => {
      const data = d.data() as User;
      const phone = (data.phoneNumber || '').trim();
      if (phone && !result.has(phone)) {
        result.set(phone, { ...data, id: d.id });
      }
    });
  }
  return result;
}



// User operations
export const userOperations = {
  // Create user profile
  async createUser(uid: string, userData: Partial<User>): Promise<ApiResponse<User>> {
    try {
      const userRef = doc(collections.users, uid);
      const newUser: User = {
        id: uid,
        email: userData.email || '',
        firstName: userData.firstName || '',
        lastName: userData.lastName || '',
        role: userData.role || 'patient',
        phoneNumber: userData.phoneNumber || '',
        createdAt: serverTimestamp() as Timestamp,
        updatedAt: serverTimestamp() as Timestamp,
        isActive: true,
        ...userData,
      };

      await setDoc(userRef, newUser, { merge: true });
      return { success: true, data: newUser };
    } catch (error: any) {
      logger.error('Error creating user:', error);
      return { success: false, error: error.message };
    }
  },

  // Get user by ID. When `simulated` is true (e.g. when a super-admin
  // impersonates a seeded demo user that only exists at
  // simulation/native/users/<uid>), reads from the sim collection instead.
  async getUser(uid: string, simulated = false): Promise<ApiResponse<User>> {
    try {
      const ref = simulated
        ? doc(collection(db, 'simulation/native/users') as CollectionReference, uid)
        : doc(collections.users, uid);
      const userDoc = await getDoc(ref);
      if (userDoc.exists()) {
        return { success: true, data: { id: uid, ...userDoc.data() } as User };
      }
      return { success: false, error: 'User not found' };
    } catch (error: any) {
      logger.error('Error getting user:', error);
      return { success: false, error: error.message };
    }
  },

  // Update user profile
  async updateUser(uid: string, updates: Partial<User>): Promise<ApiResponse<User>> {
    try {
      const userRef = doc(collections.users, uid);
      const updateData = {
        ...updates,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(userRef, updateData);
      const updatedUser = await getDoc(userRef);

      return { success: true, data: { id: uid, ...updatedUser.data() } as User };
    } catch (error: any) {
      logger.error('Error updating user:', error);
      return { success: false, error: error.message };
    }
  },

  // Listen to user changes. `simulated` mirrors `getUser` — read from
  // simulation/native/users/<uid> when the active session is impersonating
  // a seeded demo user.
  onUserChange(uid: string, callback: (user: User | null) => void, simulated = false) {
    const ref = simulated
      ? doc(collection(db, 'simulation/native/users') as CollectionReference, uid)
      : doc(collections.users, uid);
    return onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          callback({ id: uid, ...snap.data() } as User);
        } else {
          callback(null);
        }
      },
      // Without an error handler, a permission-denied snapshot leaves the
      // success callback unfired forever — the impersonation flow then sits
      // on the loading spinner with no way out except clearing storage.
      (err) => {
        logger.error('onUserChange snapshot error:', err);
        callback(null);
      },
    );
  },

  // Get users with cursor-based pagination and server-side sorting (admin only)
  // For search: falls back to client-side filtering (Firestore has no LIKE query)
  async getAllUsers(
    pageSize: number = 25,
    page: number = 1,
    searchQuery?: string,
    sortBy: UserSortField = 'lastName',
    sortDir: SortDirection = 'asc',
    cursorDoc?: DocumentSnapshot | null,
    direction: 'next' | 'prev' | 'first' = 'first',
    simulated: boolean = false,
  ): Promise<ApiResponse<{
    users: User[];
    total: number;
    hasMore: boolean;
    currentPage: number;
    stats: { active: number; patients: number; staff: number };
    firstDoc: DocumentSnapshot | null;
    lastDoc: DocumentSnapshot | null;
  }>> {
    try {
      const usersRef: CollectionReference = simulated
        ? collection(db, 'simulation/native/users')
        : collections.users;

      // Search mode: fetch all and filter client-side (unavoidable with Firestore)
      if (searchQuery && searchQuery.trim()) {
        return this._searchUsers(pageSize, page, searchQuery, usersRef);
      }

      // ── Server-side paginated query ──
      const baseConstraints = [orderBy(sortBy, sortDir)];

      // Get total count (cached by Firestore, cheap after first call)
      const countSnap = await getCountFromServer(query(usersRef));
      const total = countSnap.data().count;

      // Build paginated query
      let paginatedQuery;
      if (direction === 'next' && cursorDoc) {
        paginatedQuery = query(usersRef, ...baseConstraints, startAfter(cursorDoc), limit(pageSize));
      } else if (direction === 'prev' && cursorDoc) {
        paginatedQuery = query(usersRef, ...baseConstraints, endBefore(cursorDoc), limitToLast(pageSize));
      } else {
        // First page
        paginatedQuery = query(usersRef, ...baseConstraints, limit(pageSize));
      }

      const snapshot = await getDocs(paginatedQuery);
      const users = snapshot.docs.map(doc => this._docToUser(doc)).filter(Boolean) as User[];

      // Check if there's a next page
      let hasMore = false;
      if (snapshot.docs.length === pageSize) {
        const lastDoc = snapshot.docs[snapshot.docs.length - 1];
        const peekQuery = query(usersRef, ...baseConstraints, startAfter(lastDoc), limit(1));
        const peekSnap = await getDocs(peekQuery);
        hasMore = !peekSnap.empty;
      }

      return {
        success: true,
        data: {
          users,
          total,
          hasMore,
          currentPage: page,
          stats: { active: 0, patients: 0, staff: 0 }, // Stats fetched separately if needed
          firstDoc: snapshot.docs[0] || null,
          lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
        }
      };
    } catch (error: any) {
      logger.error('Error getting users:', error);
      return { success: false, error: error.message };
    }
  },

  // Fetch stats separately (lightweight count queries)
  async getUserStats(): Promise<{ active: number; patients: number; staff: number; total: number }> {
    try {
      // Single fetch, count in memory — cheaper than 4 separate count queries
      const snapshot = await getDocs(query(collections.users));
      let active = 0, patients = 0, staff = 0;
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.isActive) active++;
        if (data.role === 'patient') patients++;
        if (isAdminRole(data.role)) staff++;
      });
      return { active, patients, staff, total: snapshot.size };
    } catch (error) {
      logger.error('Error getting user stats:', error);
      return { active: 0, patients: 0, staff: 0, total: 0 };
    }
  },

  // Search: client-side filter (Firestore doesn't support LIKE)
  async _searchUsers(
    pageSize: number,
    page: number,
    searchQuery: string,
    usersRef: CollectionReference = collections.users,
  ): Promise<ApiResponse<{
    users: User[];
    total: number;
    hasMore: boolean;
    currentPage: number;
    stats: { active: number; patients: number; staff: number };
    firstDoc: null;
    lastDoc: null;
  }>> {
    const allSnapshot = await getDocs(query(usersRef, orderBy('lastName', 'asc')));
    const allUsers = allSnapshot.docs.map(doc => this._docToUser(doc)).filter(Boolean) as User[];

    const q = searchQuery.toLowerCase().trim();
    const filtered = allUsers.filter(user => {
      const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
      const email = (user.email || '').toLowerCase();
      const phone = (user.phoneNumber || '').toLowerCase();
      return fullName.includes(q) || email.includes(q) || phone.includes(q);
    });

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    const paginatedUsers = filtered.slice(startIndex, startIndex + pageSize);

    return {
      success: true,
      data: {
        users: paginatedUsers,
        total,
        hasMore: startIndex + pageSize < total,
        currentPage: page,
        stats: { active: 0, patients: 0, staff: 0 },
        firstDoc: null,
        lastDoc: null,
      }
    };
  },

  _docToUser(doc: QueryDocumentSnapshot): User | null {
    try {
      const data = doc.data();
      if (!data.role) return null;
      return {
        id: doc.id,
        email: data.email || '',
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        phoneNumber: data.phoneNumber || '',
        role: data.role || 'patient',
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdAt: data.createdAt || serverTimestamp() as Timestamp,
        updatedAt: data.updatedAt || serverTimestamp() as Timestamp,
        ...(data.dateOfBirth && { dateOfBirth: data.dateOfBirth }),
      };
    } catch {
      return null;
    }
  },

  // Get all users (original method for backward compatibility)
  async getAllUsersLegacy(): Promise<ApiResponse<User[]>> {
    const response = await this.getAllUsers(100, 1); // Get first 100 users for backward compatibility
    if (response.success && response.data) {
      return {
        success: true,
        data: response.data.users,
        error: undefined
      };
    }
    return {
      success: response.success,
      data: [],
      error: response.error
    };
  },
};
