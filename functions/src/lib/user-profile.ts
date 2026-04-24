/**
 * Shared validator for the user-profile payload shape used by
 * createUserWithAuth, updateUserAuth, and the bootstrap trigger.
 *
 * Each field is optional so the same helper can be reused by both
 * create (all required) and update (partial) flows — the caller picks
 * which subset to require by asserting on the returned object.
 */

import { FIELD_LIMITS, validateStringField } from "./validation.js";

export type UserProfileInput = {
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  role?: unknown;
  phoneNumber?: unknown;
};

export type UserProfileFields = {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  phoneNumber?: string;
};

/**
 * Trim + length-check the standard set of user-profile fields. Skips
 * fields that aren't present (no value written) so this works for both
 * create and partial-update flows.
 */
export function validateUserProfileFields(data: UserProfileInput): UserProfileFields {
  const out: UserProfileFields = {};
  if (data.email !== undefined) {
    out.email = validateStringField(data.email, "email", { max: FIELD_LIMITS.email.max });
  }
  if (data.firstName !== undefined) {
    out.firstName = validateStringField(data.firstName, "firstName", FIELD_LIMITS.firstName);
  }
  if (data.lastName !== undefined) {
    out.lastName = validateStringField(data.lastName, "lastName", FIELD_LIMITS.lastName);
  }
  if (data.role !== undefined) {
    out.role = validateStringField(data.role, "role", FIELD_LIMITS.role);
  }
  if (data.phoneNumber !== undefined && data.phoneNumber !== "") {
    out.phoneNumber = validateStringField(data.phoneNumber, "phoneNumber", {
      max: FIELD_LIMITS.phoneNumber.max,
    });
  }
  return out;
}
