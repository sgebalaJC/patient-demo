import {
  collection,
  serverTimestamp,
  writeBatch,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { simPath } from '../sim-mode';

/**
 * Standard Firestore doc → typed object adapter. Use everywhere that
 * a module returns shaped rows to the UI instead of reinventing
 * `{ id, ...data }` casts per file.
 *
 * Returns `null` when the doc does not exist, so callers can branch
 * without a separate `.exists()` check.
 */
export function mapDoc<T>(
  snap: DocumentSnapshot | QueryDocumentSnapshot,
): (T & { id: string }) | null {
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as T) };
}

/**
 * Strict variant — like `mapDoc`, but warns when one of `requiredKeys` is
 * missing in the stored document. Catches schema drift early instead of
 * silently flowing `undefined` into the UI. Returns `null` when the doc
 * doesn't exist OR a required key is missing.
 */
export function mapDocStrict<T extends object>(
  snap: DocumentSnapshot | QueryDocumentSnapshot,
  requiredKeys: ReadonlyArray<keyof T>,
  label = 'doc',
): (T & { id: string }) | null {
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<T>;
  for (const key of requiredKeys) {
    if (data[key] === undefined || data[key] === null) {
      // eslint-disable-next-line no-console
      console.warn(`[firestore] ${label} ${snap.id} missing required field "${String(key)}"`);
      return null;
    }
  }
  return { id: snap.id, ...(data as T) };
}

// Helper function to log authentication context
export const logAuthContext = (_operation: string) => {
  // Auth context logging removed for production
};

// Collection references — implemented as getters so they re-resolve against
// the current sim flag on every access. The flag lives in `lib/sim-mode.ts`
// (single source of truth); firebase caches CollectionReference internally
// so the repeated `collection(db, ...)` calls are cheap.
export const collections = {
  get users() { return collection(db, simPath('users')); },
  get appointments() { return collection(db, simPath('appointments')); },
  get messageThreads() { return collection(db, simPath('message-threads')); },
  get threadMessages() { return collection(db, simPath('thread-messages')); },
  get prescriptionRefills() { return collection(db, simPath('prescription-refills')); },
  get patientDocuments() { return collection(db, simPath('patient-documents')); },
  get patientIntakeForms() { return collection(db, simPath('patient-intake-forms')); },
  get notifications() { return collection(db, simPath('notifications')); },
  get specialistRequests() { return collection(db, simPath('specialist-requests')); },
  get subscriptionPlans() { return collection(db, simPath('subscription-plans')); },
  get patientSubscriptions() { return collection(db, simPath('patient-subscriptions')); },
  get priorAuths() { return collection(db, simPath('prior-auths')); },
  get payers() { return collection(db, simPath('payers')); },
  get payerPolicies() { return collection(db, simPath('payer-policies')); },
  get payerPolicySnapshots() { return collection(db, simPath('payer-policy-snapshots')); },
  get payerCandidates() { return collection(db, simPath('payer-candidates')); },
  get targetCpts() { return collection(db, simPath('target-cpts')); },
  get priorAuthEvents() { return collection(db, simPath('prior-auth-events')); },
  get adminChannelMessages() { return collection(db, simPath('admin-channel-messages')); },
};

// Utility functions
export const firestoreUtils = {
  // Convert Firestore timestamp to Date
  timestampToDate(timestamp: Timestamp): Date {
    return timestamp.toDate();
  },

  // Convert Date to Firestore timestamp
  dateToTimestamp(date: Date): Timestamp {
    return Timestamp.fromDate(date);
  },

  // Batch operations
  createBatch() {
    return writeBatch(db);
  },

  // Server timestamp
  serverTimestamp() {
    return serverTimestamp();
  },
};
