import {
  collection,
  query,
  where,
  orderBy,
  limit as fbLimit,
  startAfter,
  getDocs,
  Timestamp,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { ApiResponse } from '../../types';
import logger from '../logger';
import { errorMessage } from '../errors';

/**
 * Firestore mirror of audit events. Written by the `logAuditEvent` Cloud
 * Function (Admin SDK); read-only here. Super-admin gated by Firestore
 * rules — admins who can't pass `isSuperAdmin()` get permission-denied.
 */
export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  timestamp: Timestamp | null;
  /** ISO string set by the client at log time — fallback for queries before serverTimestamp resolves. */
  clientTimestamp: string;
}

export interface AuditLogFilter {
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  /** Page size; default 50. */
  pageSize?: number;
  /** Cursor — pass the previous page's last doc snapshot. */
  startAfter?: DocumentSnapshot;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  /** Last raw snapshot — pass to next call's `startAfter` for pagination. */
  cursor: DocumentSnapshot | null;
}

const COLLECTION = 'audit-logs';

export const auditLogOps = {
  async list(filter: AuditLogFilter = {}): Promise<ApiResponse<AuditLogPage>> {
    try {
      const ref = collection(db, COLLECTION);
      const constraints = [];
      if (filter.actorId) constraints.push(where('actorId', '==', filter.actorId));
      if (filter.action) constraints.push(where('action', '==', filter.action));
      if (filter.resourceType) constraints.push(where('resourceType', '==', filter.resourceType));
      if (filter.resourceId) constraints.push(where('resourceId', '==', filter.resourceId));
      constraints.push(orderBy('timestamp', 'desc'));
      if (filter.startAfter) constraints.push(startAfter(filter.startAfter));
      constraints.push(fbLimit(filter.pageSize ?? 50));

      const q = query(ref, ...constraints);
      const snap = await getDocs(q);
      const entries: AuditLogEntry[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          actorId: data.actorId ?? '',
          actorEmail: data.actorEmail ?? null,
          actorRole: data.actorRole ?? 'unknown',
          action: data.action ?? '',
          resourceType: data.resourceType ?? null,
          resourceId: data.resourceId ?? null,
          metadata: (data.metadata as Record<string, unknown>) ?? {},
          timestamp: data.timestamp instanceof Timestamp ? data.timestamp : null,
          clientTimestamp: data.clientTimestamp ?? '',
        };
      });
      const cursor = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
      return { success: true, data: { entries, cursor } };
    } catch (error: unknown) {
      logger.error('Error listing audit logs:', error);
      return { success: false, error: errorMessage(error) };
    }
  },
};
