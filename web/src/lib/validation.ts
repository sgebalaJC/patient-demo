import { z } from 'zod';
import { FORK_CONFIG } from '../../../fork.config';

/**
 * Global ceiling for any free-text field written by a client. Per-field
 * caps below may be smaller (e.g. firstName: 100). Anything longer
 * than this ceiling throws — both in Zod schemas on the client and in
 * the matching helper on the server (functions/src/lib/validation.ts).
 */
export const MAX_FIELD_CHARS = FORK_CONFIG.limits.maxFieldChars;

/**
 * Throws if `value` exceeds the given max (default: MAX_FIELD_CHARS).
 * Error message names the field so form-level catches can surface a
 * precise message to the user. Use in hand-rolled validation paths
 * that aren't driven by Zod.
 */
export function assertMaxLength(
  field: string,
  value: string | null | undefined,
  max: number = MAX_FIELD_CHARS,
): void {
  if (value == null) return;
  if (value.length > max) {
    throw new Error(`${field} must be ${max} characters or fewer (got ${value.length}).`);
  }
}

/**
 * Centralized field length limits.
 * Used by Zod schemas (frontend) and should match Cloud Function validation.
 */
export const FIELD_LIMITS = {
  // Identity
  firstName: { min: 2, max: 100 },
  lastName: { min: 2, max: 100 },
  email: { max: 254 },
  phoneNumber: { max: 20 },
  password: { min: 8, max: 128 },

  // Messages
  messageSubject: { min: 5, max: 200 },
  messageContent: { min: 10, max: 5000 },

  // Prescriptions
  medicationName: { min: 2, max: 200 },
  dosage: { max: 200 },
  quantity: { max: 100 },
  pharmacyName: { max: 200 },
  pharmacyPhone: { max: 20 },
  pharmacyAddress: { max: 500 },

  // Specialist requests
  specialistReason: { min: 10, max: 500 },

  // Insurance
  insuranceProvider: { max: 200 },
  policyNumber: { max: 100 },
  groupNumber: { max: 100 },
  emergencyContactRelationship: { max: 100 },

  // Faxes
  coverName: { max: 120 },

  // General
  notes: { max: 2000 },
  description: { max: 500 },
  signature: { max: 200 },
  detailsField: { max: 500 },
  role: { max: 20 },
  address: { max: 500 },

  // Prior Authorization
  priorAuth: {
    memberNumber: { max: 64 },
    groupNumber: { max: 64 },
    referenceNumber: { max: 64 },
    authNumber: { max: 64 },
    denialReason: { max: 1000 },
    notes: { max: 2000 },
    evidence: { max: 2000 },
    cptCode: { min: 5, max: 5 },
    icd10Code: { max: 10 },
  },
} as const;

// ---------------------------------------------------------------------------
// Zod schema builders — compose identity/contact fields without repeating
// the same `min/max/email` trio across every form. Prefer these over
// inlining `z.string().min(...).max(...).email(...)` so max lengths and
// error messages stay in one place.
// ---------------------------------------------------------------------------

export function emailField(opts: { required?: boolean } = {}) {
  const required = opts.required ?? true;
  let s = z.string();
  if (required) s = s.min(1, 'Email is required');
  return s
    .max(FIELD_LIMITS.email.max, 'Email is too long')
    .email('Please enter a valid email address');
}

export function firstNameField() {
  return z
    .string()
    .min(FIELD_LIMITS.firstName.min, `First name must be at least ${FIELD_LIMITS.firstName.min} characters`)
    .max(FIELD_LIMITS.firstName.max, `First name must be less than ${FIELD_LIMITS.firstName.max} characters`);
}

export function lastNameField() {
  return z
    .string()
    .min(FIELD_LIMITS.lastName.min, `Last name must be at least ${FIELD_LIMITS.lastName.min} characters`)
    .max(FIELD_LIMITS.lastName.max, `Last name must be less than ${FIELD_LIMITS.lastName.max} characters`);
}

export function phoneField(opts: { required?: boolean } = {}) {
  const required = opts.required ?? false;
  let s = z.string();
  if (required) s = s.min(7, 'Valid phone number is required');
  return s.max(FIELD_LIMITS.phoneNumber.max, 'Phone number is too long');
}

export function passwordField() {
  return z
    .string()
    .min(FIELD_LIMITS.password.min, `Password must be at least ${FIELD_LIMITS.password.min} characters`)
    .max(FIELD_LIMITS.password.max, `Password must be less than ${FIELD_LIMITS.password.max} characters`);
}

/** Shared base schema for any "compose message" form (patient or admin). */
export const newMessageBaseSchema = {
  subject: z
    .string()
    .min(1, 'Subject is required')
    .min(FIELD_LIMITS.messageSubject.min, `Subject must be at least ${FIELD_LIMITS.messageSubject.min} characters`)
    .max(FIELD_LIMITS.messageSubject.max, `Subject must be less than ${FIELD_LIMITS.messageSubject.max} characters`),
  message: z
    .string()
    .min(1, 'Message is required')
    .min(FIELD_LIMITS.messageContent.min, `Message must be at least ${FIELD_LIMITS.messageContent.min} characters`)
    .max(FIELD_LIMITS.messageContent.max, `Message must be less than ${FIELD_LIMITS.messageContent.max} characters`),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
} as const;
