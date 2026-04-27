/**
 * Server-side audit emit helpers.
 *
 * `emitAudit` is the single entry-point for any Cloud Function that
 * performs a HIPAA-classified action: it logs the structured `[AUDIT]`
 * event to Cloud Logging (with `audit:true` so the 7-year retention sink
 * picks it up) AND mirrors to the Firestore `audit-logs/{logId}` doc that
 * the super-admin /admin/audit-log page reads. PII is scrubbed at any
 * depth before the event is written.
 *
 * Lives in lib/ rather than alongside `logAuditEvent` in index.ts so any
 * function file (signalwire-webhook, stripe, EHR adapters, …) can import
 * it without creating a circular dep through index.ts's barrel exports.
 */

import {logger} from "firebase-functions";
import * as admin from "firebase-admin";

/**
 * PII field names dropped from audit metadata at any depth.
 *
 * Centralized so every emit + the existing `logAuditEvent` callable get
 * the same scrub. Adding a name here transparently protects all call
 * sites. Lowercase: `scrubPii` lowercases keys before lookup.
 *
 * MUST stay byte-identical to the client-side `CLIENT_PII_FIELD_NAMES`
 * in `web/src/lib/audit.ts`. The server scrub is the trust boundary —
 * but a client-side miss leaks PII into the wire transcript before the
 * callable lands. Bump `PII_BLOCKLIST_VERSION` on both sides when
 * adding a name; the version field makes future drift detection trivial.
 */
const PII_BLOCKLIST_VERSION = 1;
void PII_BLOCKLIST_VERSION;
const AUDIT_PII_FIELD_NAMES = new Set([
  "email", "name", "firstname", "lastname", "phone", "phonenumber",
  "dateofbirth", "dob", "address", "ssn", "content", "message", "body",
  "password", "token", "allergies", "diagnosis", "medication", "medications",
  "actor", "operator", "recipient", "recipientemail", "targetemail",
  "realemail",
  // Prototype-pollution hygiene: never copy these onto the scrubbed
  // output even though Object.entries already filters inherited props.
  "__proto__", "constructor", "prototype",
]);

/**
 * Recursively walk an audit-metadata value and drop any object key whose
 * lowercased name appears in `AUDIT_PII_FIELD_NAMES`. Arrays and
 * primitives pass through unchanged. Returns a new structure; input is
 * not mutated.
 *
 * Why deep-walk: callers sometimes nest details one level down
 * (`metadata: { user: { email } }`); a top-level filter would leak
 * `email`.
 *
 * Cycle + depth guards: `logAuditEvent` accepts arbitrary client
 * metadata. A self-referential object would otherwise stack-overflow the
 * function; a deeply-nested attacker payload could blow the call stack
 * and deny the audit logger to legitimate callers. The `seen` WeakSet
 * kills cycles and SCRUB_MAX_DEPTH caps adversarial nesting at a
 * realistic ceiling.
 */
const SCRUB_MAX_DEPTH = 8;

export function scrubPii(input: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (depth > SCRUB_MAX_DEPTH) return null;
  if (Array.isArray(input)) {
    if (!seen) seen = new WeakSet();
    if (seen.has(input)) return null;
    seen.add(input);
    return input.map((v) => scrubPii(v, depth + 1, seen));
  }
  if (input && typeof input === "object") {
    if (!seen) seen = new WeakSet();
    if (seen.has(input as object)) return null;
    seen.add(input as object);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (AUDIT_PII_FIELD_NAMES.has(key.toLowerCase())) continue;
      out[key] = scrubPii(value, depth + 1, seen);
    }
    return out;
  }
  return input;
}

/**
 * Common shape for audit emits. Every server-side audit point should use
 * `emitAudit(...)` instead of writing `logger.info('[AUDIT]', ...)`
 * directly.
 *
 * `actorRole` is caller-provided (server-internal contract): the function
 * already enforced the role check upstream via requireAdmin /
 * requireSuperAdmin, so re-fetching from Firestore here would just add
 * latency. The user-driven `logAuditEvent` callable (in index.ts) does
 * its own Firestore lookup since the client cannot be trusted.
 *
 * The Firestore mirror is awaited so the audit doc is durable BEFORE the
 * caller's response — Cloud Functions v2 guarantees the awaited promise
 * chain settles before container teardown. ~50ms latency tradeoff for
 * HIPAA durability is acceptable.
 *
 * Mirror failures degrade gracefully: Cloud Logging is the primary HIPAA
 * archive (via the audit-archive sink); the Firestore mirror is a UI
 * convenience. A logger.warn captures the failure for ops to investigate.
 */
export interface AuditEmitInput {
  actorId: string;
  actorRole: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Days an audit doc lives in Firestore before being TTL-pruned. The
 * Cloud Logging archive sink retains the same events for 7 years (HIPAA
 * minimum +1) — the Firestore mirror only needs a UI-friendly window.
 *
 * 90 days is a deliberate balance: long enough for ops review windows
 * and most compliance dashboards, short enough that a busy practice's
 * audit-logs collection doesn't grow into hundreds of thousands of docs
 * (and 12 composite indexes scaling with it).
 *
 * Operator action: enable Firestore TTL policy on the `expiresAt` field
 * via `gcloud firestore fields ttls update expiresAt --collection-group=audit-logs`.
 * Without that, this field is just metadata.
 */
const AUDIT_TTL_DAYS = 90;

export async function emitAudit(input: AuditEmitInput): Promise<void> {
  const safeMetadata = input.metadata ? (scrubPii(input.metadata) as Record<string, unknown>) : {};
  const timestamp = new Date().toISOString();
  const expiresAtMs = Date.now() + AUDIT_TTL_DAYS * 24 * 60 * 60 * 1000;
  logger.info("[AUDIT]", {
    audit: true,
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: input.action,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    metadata: safeMetadata,
    timestamp,
  });
  try {
    await admin.firestore().collection("audit-logs").add({
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      metadata: safeMetadata,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      clientTimestamp: timestamp,
      expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMs),
    });
  } catch (err) {
    logger.warn("[AUDIT] Firestore mirror failed:", {message: (err as Error).message});
  }
}
