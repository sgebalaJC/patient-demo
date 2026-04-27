/**
 * HIPAA-safe audit logger — sends structured audit events to Cloud Logging
 * via the logAuditEvent Cloud Function.
 *
 * NEVER include PII (names, emails, phone numbers, DOB, medical content).
 * Only log: UIDs, roles, action types, resource IDs, and non-PII metadata.
 *
 * The server's `logAuditEvent` callable applies its own deep PII scrub on
 * receipt — so even if a caller forgets and passes `metadata: { email: ... }`,
 * Firestore + Cloud Logging never see the value. We ALSO scrub on the
 * client before sending, so the call's wire transcript (captured by error
 * monitoring tools, browser devtools, MITM debug proxies) doesn't carry
 * PII either. Defense in depth.
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

// Lowercased blocklist of object keys that get dropped from `metadata`
// before the callable. Mirrors the server-side AUDIT_PII_FIELD_NAMES in
// functions/src/lib/audit.ts — keep in sync if you add a name there.
const CLIENT_PII_FIELD_NAMES = new Set([
  'email', 'name', 'firstname', 'lastname', 'phone', 'phonenumber',
  'dateofbirth', 'dob', 'address', 'ssn', 'content', 'message', 'body',
  'password', 'token', 'allergies', 'diagnosis', 'medication', 'medications',
  'actor', 'operator', 'recipient', 'recipientemail', 'targetemail',
  'realemail',
  '__proto__', 'constructor', 'prototype',
]);

const CLIENT_SCRUB_MAX_DEPTH = 8;

function clientScrubPii(input: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (depth > CLIENT_SCRUB_MAX_DEPTH) return null;
  if (Array.isArray(input)) {
    if (!seen) seen = new WeakSet();
    if (seen.has(input)) return null;
    seen.add(input);
    return input.map((v) => clientScrubPii(v, depth + 1, seen));
  }
  if (input && typeof input === 'object') {
    if (!seen) seen = new WeakSet();
    if (seen.has(input as object)) return null;
    seen.add(input as object);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (CLIENT_PII_FIELD_NAMES.has(key.toLowerCase())) continue;
      out[key] = clientScrubPii(value, depth + 1, seen);
    }
    return out;
  }
  return input;
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

  // Pre-scrub metadata client-side so PII never leaves the browser even
  // if the caller forgot. The server scrubs again as the trust boundary.
  const safeEvent: AuditEvent = {
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    metadata: event.metadata ? (clientScrubPii(event.metadata) as Record<string, unknown>) : undefined,
  };

  // Fire-and-forget
  (async () => {
    try {
      const httpsCallable = await getCallable();
      const logAuditEvent = httpsCallable(functions, 'logAuditEvent');
      await logAuditEvent(safeEvent);
    } catch (err) {
      // Audit failures must not disrupt the app
      logger.warn('Audit event failed to send:', err);
    }
  })();
}
