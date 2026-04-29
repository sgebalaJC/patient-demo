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
  where,
  CollectionReference,
} from 'firebase/firestore';
import { collections, mapDocStrict } from './base';
import { User, ApiResponse } from '../../types';
import { isAdminRole } from '../roles';
import logger from "../logger";
import { errorMessage } from '../errors';
import { audit } from "../audit";

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
): Promise<Map<string, User>> {
  const result = new Map<string, User>();
  const distinct = Array.from(new Set(phones.filter(Boolean)));
  if (distinct.length === 0) return result;
  // collections.users routes through simPath() — sim-mode singleton decides
  // whether this hits real `users` or `simulation/native/users`.
  const usersRef = collections.users;
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
      audit({
        action: 'user.created',
        resourceType: 'user',
        resourceId: uid,
        metadata: { role: newUser.role, isActive: newUser.isActive },
      });
      return { success: true, data: newUser };
    } catch (error: unknown) {
      logger.error('Error creating user:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  // Get user by ID. Routes through `collections.users`, which the sim-mode
  // singleton remaps to `simulation/native/users` when sim is on (e.g. for
  // operators impersonating a seeded demo patient).
  async getUser(uid: string): Promise<ApiResponse<User>> {
    try {
      const ref = doc(collections.users, uid);
      const userDoc = await getDoc(ref);
      const mapped = mapDocStrict<User>(userDoc, ['role'], 'users');
      if (mapped) {
        return { success: true, data: { ...mapped, id: uid } };
      }
      return { success: false, error: 'User not found' };
    } catch (error: unknown) {
      logger.error('Error getting user:', error);
      return { success: false, error: errorMessage(error) };
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
      const mapped = mapDocStrict<User>(updatedUser, ['role'], 'users');
      if (!mapped) {
        return { success: false, error: 'User updated but could not be re-read' };
      }
      // Audit only the field NAMES that changed; values may be PII.
      const changedFields = Object.keys(updates).filter((k) => k !== 'updatedAt');
      audit({
        action: 'user.updated',
        resourceType: 'user',
        resourceId: uid,
        metadata: {
          changedFields,
          // Status/role transitions are non-PII and worth surfacing for compliance.
          ...(updates.role !== undefined ? { newRole: updates.role } : {}),
          ...(updates.isActive !== undefined ? { newIsActive: updates.isActive } : {}),
        },
      });
      return { success: true, data: { ...mapped, id: uid } };
    } catch (error: unknown) {
      logger.error('Error updating user:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  // Listen to user changes. Routes through `collections.users` — the sim-mode
  // singleton picks the physical path.
  onUserChange(uid: string, callback: (user: User | null) => void) {
    const ref = doc(collections.users, uid);
    return onSnapshot(
      ref,
      (snap) => {
        const mapped = mapDocStrict<User>(snap, ['role'], 'users');
        callback(mapped ? { ...mapped, id: uid } : null);
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
      const usersRef: CollectionReference = collections.users;

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
    } catch (error: unknown) {
      logger.error('Error getting users:', error);
      return { success: false, error: errorMessage(error) };
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
