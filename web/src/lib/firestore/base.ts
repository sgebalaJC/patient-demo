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
  todos: collection(db, 'admin-todos'),
  prescriptionRefills: collection(db, 'prescription-refills'),
  patientDocuments: collection(db, 'patient-documents'),
  patientIntakeForms: collection(db, 'patient-intake-forms'),
  notifications: collection(db, 'notifications'),
  agentWorkflows: collection(db, 'agent-workflows'),
  workflowRuns: collection(db, 'workflow-runs'),
  specialistRequests: collection(db, 'specialist-requests'),
  subscriptionPlans: collection(db, 'subscription-plans'),
  patientSubscriptions: collection(db, 'patient-subscriptions'),
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
