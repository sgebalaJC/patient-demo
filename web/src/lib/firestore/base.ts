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

// Collection references
export const collections = {
  users: collection(db, 'users'),
  appointments: collection(db, 'appointments'),
  messageThreads: collection(db, 'message-threads'),
  threadMessages: collection(db, 'thread-messages'),
  prescriptionRefills: collection(db, 'prescription-refills'),
  patientDocuments: collection(db, 'patient-documents'),
  patientIntakeForms: collection(db, 'patient-intake-forms'),
  notifications: collection(db, 'notifications'),
  specialistRequests: collection(db, 'specialist-requests'),
  subscriptionPlans: collection(db, 'subscription-plans'),
  patientSubscriptions: collection(db, 'patient-subscriptions'),
  priorAuths: collection(db, 'prior-auths'),
  payers: collection(db, 'payers'),
  payerPolicies: collection(db, 'payer-policies'),
  payerPolicySnapshots: collection(db, 'payer-policy-snapshots'),
  payerCandidates: collection(db, 'payer-candidates'),
  targetCpts: collection(db, 'target-cpts'),
  priorAuthEvents: collection(db, 'prior-auth-events'),
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
