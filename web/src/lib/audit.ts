/**
 * HIPAA-safe audit logger — sends structured audit events to Cloud Logging
 * via the logAuditEvent Cloud Function.
 *
 * NEVER include PII (names, emails, phone numbers, DOB, medical content).
 * Only log: UIDs, roles, action types, resource IDs, and non-PII metadata.
 *
 * Calls are fire-and-forget so they never block the UI.
 */

import { functions } from './firebase';
import logger from './logger';

export interface AuditEvent {
  /** Action identifier, e.g. "user.login", "message.sent", "refill.requested" */
  action: string;
  /** Firestore collection / resource category, e.g. "user", "message-thread" */
  resourceType?: string;
  /** Document ID of the resource acted upon */
  resourceId?: string;
  /** Non-PII metadata (status changes, counts, role changes, etc.) */
  metadata?: Record<string, unknown>;
}

let _httpsCallable: typeof import('firebase/functions').httpsCallable | null = null;

async function getCallable() {
  if (!_httpsCallable) {
    const mod = await import('firebase/functions');
    _httpsCallable = mod.httpsCallable;
  }
  return _httpsCallable;
}

/**
 * Log an audit event. Fire-and-forget — never throws, never blocks.
 */
export function audit(event: AuditEvent): void {
  if (!functions) {
    logger.warn('Audit: Firebase Functions not initialized');
    return;
  }

  // Fire-and-forget
  (async () => {
    try {
      const httpsCallable = await getCallable();
      const logAuditEvent = httpsCallable(functions, 'logAuditEvent');
      await logAuditEvent(event);
    } catch (err) {
      // Audit failures must not disrupt the app
      logger.warn('Audit event failed to send:', err);
    }
  })();
}
