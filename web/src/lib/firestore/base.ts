import {
  collection,
  serverTimestamp,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// Helper function to log authentication context
export const logAuthContext = (_operation: string) => {
  // Auth context logging removed for production
};

// Global sim-mode flag, kept in sync by AppSettingsProvider. When true, every
// access through `collections.*` routes to `simulation/native/<name>` so the
// patient-side pages (Dashboard / Refills / Appointments / etc.) see seeded
// sandbox data transparently — same way the admin side already does via
// usePagedCollection and the sidecar nc() helper.
let simMode = false;
export function setSimCollectionMode(on: boolean) {
  simMode = on;
}

const simPath = (name: string) => (simMode ? `simulation/native/${name}` : name);

// Collection references — implemented as getters so they re-resolve against
// the current sim flag on every access. Firebase caches CollectionReference
// internally so the repeated `collection(db, ...)` calls are cheap.
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
