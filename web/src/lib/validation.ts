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

  // Todos
  todoTitle: { min: 1, max: 100 },
  todoDescription: { max: 1000 },
  todoCategory: { max: 100 },

  // Prescriptions
  medicationName: { min: 2, max: 200 },
  dosage: { max: 200 },
  quantity: { max: 100 },
  pharmacyName: { max: 200 },
  pharmacyPhone: { max: 20 },
  pharmacyAddress: { max: 500 },

  // Specialist requests
  specialistReason: { min: 10, max: 500 },

  // General
  notes: { max: 2000 },
  description: { max: 500 },
  signature: { max: 200 },
  detailsField: { max: 500 },
  role: { max: 20 },
} as const;
