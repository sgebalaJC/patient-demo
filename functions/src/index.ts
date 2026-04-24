/**
 * Cloud Functions for Patient Portal
 * - User management (Auth + Firestore)
 * - Google Calendar bidirectional sync
 * - Appointment availability checking
 * - Stripe subscription billing
 */

import {FUNCTIONS_BRANDING} from "./branding.js";
import {assertAdmin as assertCallerIsAdmin} from "./superAdmins.js";
import {sendEmail as sendTransactionalEmail, appointmentConfirmedEmail, appointmentCancelledEmail, welcomeEmail, refillStatusEmail} from "./email.js";
import {setGlobalOptions} from "firebase-functions/v2";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {onCall, onRequest} from "firebase-functions/v2/https";
import {corsOptions, isProduction} from "./lib/cors.js";
import {normalizePhoneNumber, toE164} from "./lib/phone.js";
import {FIELD_LIMITS, VALID_ROLES} from "./lib/validation.js";
import {validateUserProfileFields} from "./lib/user-profile.js";
import {requireAdmin, requireAuth, requireSuperAdmin} from "./lib/auth.js";
import {checkRateLimit, clientIp} from "./lib/rate-limit.js";

import {
  SIDECAR_URL_SECRET,
  SIDECAR_API_KEY_SECRET,
  sidecarUrlEnv,
  sidecarApiKeyEnv,
} from "./lib/sidecar.js";
import {onDocumentWritten, onDocumentCreated} from "firebase-functions/v2/firestore";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

// Pin all functions to us-west1. This MUST run before any re-export below,
// because `onCall`/`onRequest`/`onSchedule` snapshot the current default at
// import time — re-exports above this line would silently deploy to the
// library default (us-central1). Change this per-customer if using a
// different region.
setGlobalOptions({region: "us-west1"});

// Client-side error telemetry (browser → Cloud Logging)
export {logClientError} from "./client-errors.js";

// Simulation layer — single entry point for all external integrations with
// Sandbox seed/clear callables — sim/real routing itself lives on the
// sidecar. See docs/SIMULATION.md.
export {seedSimulationData, clearSimulationData} from "./simulation/index.js";

// Appointment reminder cron jobs. Extracted from this file.
export {calendarReminderScheduler, morningReminderScheduler} from "./reminders.js";

// Stripe subscription billing — patient pays practice
export {
  createCheckoutSession,
  cancelSubscription,
  stripeWebhook,
} from "./stripe.js";

// Stripe platform billing — practice pays platform vendor (you)
export {
  createPlatformCheckoutSession,
  createPlatformTopupSession,
  createPlatformBillingPortalSession,
  cancelPlatformSubscription,
  resumePlatformSubscription,
  platformStripeWebhook,
} from "./platformStripe.js";

// Google Workspace auth is configured via the admin Integrations UI and
// stored on `integrations/google-workspace`. Service-account keys live in
// Secret Manager; OAuth refresh tokens (encrypted) live in the doc. No env
// vars for GOOGLE_CALENDAR_ID / GOOGLE_SA_KEY / GOOGLE_CALENDAR_SUBJECT —
// everything flows through the integration doc.

// Initialize Firebase Admin
admin.initializeApp();

// Initialize Firestore
const db = admin.firestore();

import {sendSms, SMS_SECRETS} from "./lib/sms-helpers.js";

// CORS, validation, phone normalization, rate limiting, and client-IP
// helpers are all imported from ./lib/*.


/**
 * Update existing user with Firebase Auth
 */
export const updateUserAuth = onCall({
  cors: corsOptions
}, async (request) => {
  try {
    logger.info('updateUserAuth called');

    const context = await requireAdmin(request, { rateLimitKey: 'updateUser' });

    const { uid } = request.data;
    if (!uid || typeof uid !== 'string') {
      throw new Error('User UID is required for updates');
    }

    // Only pass through defined fields — undefined means "do not update".
    const profile = validateUserProfileFields({
      ...(request.data.email !== undefined ? { email: request.data.email } : {}),
      ...(request.data.firstName !== undefined ? { firstName: request.data.firstName } : {}),
      ...(request.data.lastName !== undefined ? { lastName: request.data.lastName } : {}),
      ...(request.data.role !== undefined ? { role: request.data.role } : {}),
    });
    const { email, firstName, lastName, role } = profile;
    const isActive = typeof request.data.isActive === 'boolean' ? request.data.isActive : undefined;
    const emailVerified = typeof request.data.emailVerified === 'boolean' ? request.data.emailVerified : undefined;

    if (role && !VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
      throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
    }

    // Update Firebase Auth user
    const updateData: Record<string, unknown> = {};
    if (email) updateData.email = email;
    if (firstName && lastName) updateData.displayName = `${firstName} ${lastName}`;
    if (emailVerified !== undefined) updateData.emailVerified = emailVerified;
    if (isActive !== undefined) updateData.disabled = !isActive;

    if (Object.keys(updateData).length > 0) {
      await admin.auth().updateUser(uid, updateData);
    }

    // Update user document in Firestore
    const userDocData: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (email) userDocData.email = email;
    if (firstName) userDocData.firstName = firstName;
    if (lastName) userDocData.lastName = lastName;
    if (firstName && lastName) userDocData.displayName = `${firstName} ${lastName}`;
    if (role) userDocData.role = role;
    if (isActive !== undefined) userDocData.isActive = isActive;
    if (emailVerified !== undefined) userDocData.emailVerified = emailVerified;

    await db.collection('users').doc(uid).update(userDocData);
    logger.info('User updated successfully', { uid });

    // Audit log: user update
    const changedFields = Object.keys(userDocData).filter(k => k !== 'updatedAt');
    logger.info('[AUDIT]', {
      audit: true,
      actorId: context.uid,
      actorRole: 'admin',
      action: 'user.updated',
      resourceType: 'user',
      resourceId: uid,
      metadata: { changedFields },
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      message: 'User updated successfully',
      uid: uid
    };

  } catch (error: any) {
    logger.error('Error in updateUserAuth:', { code: error.code, message: error.message });
    return {
      success: false,
      error: error.message || 'An unexpected error occurred while updating the user',
      code: error.code
    };
  }
});


/**
 * Admin sets a password for any user. The system is passwordless by default,
 * so this is an explicit opt-in per user (useful for kiosk-style logins or
 * when a user can't receive email links / SMS). Never logs the password.
 */
export const setUserPassword = onCall({
  cors: corsOptions,
}, async (request) => {
  try {
    const context = await requireAdmin(request, { rateLimitKey: 'setUserPassword' });

    const { uid, password } = request.data ?? {};
    if (!uid || typeof uid !== 'string') {
      throw new Error('User UID is required');
    }
    if (typeof password !== 'string') {
      throw new Error('Password must be a string');
    }
    if (password.length < FIELD_LIMITS.password.min) {
      throw new Error(`Password must be at least ${FIELD_LIMITS.password.min} characters`);
    }
    if (password.length > FIELD_LIMITS.password.max) {
      throw new Error(`Password must be less than ${FIELD_LIMITS.password.max} characters`);
    }

    await admin.auth().updateUser(uid, { password });

    logger.info('[AUDIT]', {
      audit: true,
      actorId: context.uid,
      actorRole: 'admin',
      action: 'user.password_set',
      resourceType: 'user',
      resourceId: uid,
      timestamp: new Date().toISOString(),
    });

    return { success: true, message: 'Password set successfully' };
  } catch (error: any) {
    logger.error('Error in setUserPassword:', { code: error.code, message: error.message });
    return {
      success: false,
      error: error.message || 'Failed to set password',
      code: error.code,
    };
  }
});


/**
 * HTTP Callable Functions for User Management
 */

/**
 * Audit Logging — writes structured, HIPAA-safe audit events to GCP Cloud Logging.
 * Only stores UIDs, roles, action types, resource IDs. Never stores PII.
 */
export const logAuditEvent = onCall({
  cors: corsOptions
}, async (request) => {
  try {
    const context = requireAuth(request);

    const { action, resourceType, resourceId, metadata } = request.data;

    if (!action || typeof action !== 'string') {
      throw new Error('action is required');
    }

    // Look up actor role from Firestore (don't trust client-provided role)
    let actorRole = 'unknown';
    try {
      const actorDoc = await db.collection('users').doc(context.uid).get();
      if (actorDoc.exists) {
        actorRole = actorDoc.data()?.role || 'unknown';
      }
    } catch {
      // If role lookup fails, proceed with 'unknown' — don't block audit
    }

    // Sanitize metadata: strip any fields that could contain PII
    const PII_FIELD_NAMES = [
      'email', 'name', 'firstName', 'lastName', 'phone', 'phoneNumber',
      'dateOfBirth', 'dob', 'address', 'ssn', 'content', 'message',
      'password', 'token', 'allergies', 'diagnosis', 'medication',
    ];
    let safeMetadata: Record<string, unknown> = {};
    if (metadata && typeof metadata === 'object') {
      safeMetadata = Object.fromEntries(
        Object.entries(metadata).filter(
          ([key]) => !PII_FIELD_NAMES.includes(key.toLowerCase())
        )
      );
    }

    // Write structured audit log — this goes to GCP Cloud Logging
    logger.info('[AUDIT]', {
      audit: true,
      actorId: context.uid,
      actorRole,
      action,
      resourceType: resourceType || null,
      resourceId: resourceId || null,
      metadata: safeMetadata,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  } catch (error: any) {
    logger.error('Audit log error:', { message: error.message });
    return { success: false, error: error.message };
  }
});

export const createUserWithAuth = onCall({
  cors: corsOptions,
  secrets: [...SMS_SECRETS],
}, async (request) => {
  try {
    logger.info('createUserWithAuth called');

    const context = await requireAdmin(request, {
      rateLimitKey: 'createUser',
      maxRequests: 10,
    });

    // Validate and sanitize input
    const profile = validateUserProfileFields({
      email: request.data.email,
      firstName: request.data.firstName,
      lastName: request.data.lastName,
      role: request.data.role,
      phoneNumber: request.data.phoneNumber,
    });
    const email = profile.email!;
    const firstName = profile.firstName!;
    const lastName = profile.lastName!;
    const role = profile.role!;
    const rawPhoneNumber = profile.phoneNumber ?? '';
    const sendWelcomeSms = request.data.sendWelcomeSms === true;

    if (!VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
      throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
    }

    // Normalize phone to canonical 10-digit US form so later phone-OTP
    // sign-ins can match on users.where('phoneNumber', '==', ...).
    const phoneNumber = rawPhoneNumber ? normalizePhoneNumber(rawPhoneNumber) : '';

    // Passwordless: admin-created users have no password set. They sign in via
    // the invite link (Firebase email link) sent from the admin's browser after
    // this function returns, or via Google / phone OTP.
    logger.info('Creating user account', { role });

    // Check if user already exists
    try {
      await admin.auth().getUserByEmail(email);
      return {
        success: false,
        error: 'A user with this email already exists. Please use a different email address.',
        code: 'USER_ALREADY_EXISTS'
      };
    } catch (error: any) {
      if (error.code !== 'auth/user-not-found') {
        logger.error('Error checking existing user:', { code: error.code });
        return {
          success: false,
          error: 'Unable to verify if user exists. Please try again.',
          code: 'CHECK_USER_FAILED'
        };
      }
    }

    // Create user in Firebase Auth — no password set (passwordless invite flow).
    // Registration-disabled gating happens client-side in `createUserDocument`
    // for self-signup paths (email/Google); admin-created users bypass that
    // because the admin role check above already authorized this call.
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email,
        displayName: `${firstName} ${lastName}`,
        emailVerified: false,
      });

      logger.info('User auth record created', { uid: userRecord.uid, role });
    } catch (authError: any) {
      logger.error('Error creating user in Firebase Auth:', authError);

      // Handle specific Firebase Auth errors
      if (authError.code === 'auth/email-already-exists') {
        return {
          success: false,
          error: 'This email address is already in use. Please use a different email address.',
          code: 'EMAIL_EXISTS'
        };
      } else if (authError.code === 'auth/invalid-email') {
        return {
          success: false,
          error: 'The email address is not valid. Please enter a valid email address.',
          code: 'INVALID_EMAIL'
        };
      } else {
        return {
          success: false,
          error: 'Failed to create user account. Please try again.',
          code: 'CREATE_AUTH_FAILED'
        };
      }
    }

    // Set custom claims for the user
    try {
      await admin.auth().setCustomUserClaims(userRecord.uid, { role });
    } catch (claimsError: any) {
      logger.error('Error setting custom claims:', claimsError);
      // Clean up: delete the created user if claims failed
      try {
        await admin.auth().deleteUser(userRecord.uid);
      } catch (deleteError) {
        logger.error('Error cleaning up user after claims failure:', deleteError);
      }

      return {
        success: false,
        error: 'User account created but failed to set permissions. Please try again.',
        code: 'SET_CLAIMS_FAILED'
      };
    }

    // Create user profile in Firestore using Firebase Auth UID
    const userProfile = {
      email,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      role,
      phoneNumber: phoneNumber || '',
      isActive: true,
      emailVerified: false,
      authUid: userRecord.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    try {
      await db.collection('users').doc(userRecord.uid).set(userProfile);
    } catch (firestoreError: any) {
      logger.error('Error creating user profile in Firestore:', firestoreError);
      // Clean up: delete the created user if Firestore failed
      try {
        await admin.auth().deleteUser(userRecord.uid);
      } catch (deleteError) {
        logger.error('Error cleaning up user after Firestore failure:', deleteError);
      }

      return {
        success: false,
        error: 'User account created but failed to save profile. Please try again.',
        code: 'CREATE_PROFILE_FAILED'
      };
    }

    logger.info('User created successfully', { uid: userRecord.uid, role });

    // Optional welcome SMS via SignalWire (best-effort, non-fatal on failure).
    // In sim mode the call routes into simulation/sms/outbound — admins see
    // it in the SMS history panel, real SignalWire is not hit.
    let smsSent = false;
    if (sendWelcomeSms && phoneNumber) {
      try {
        const formattedTo = toE164(phoneNumber);
        const body = `Welcome to ${FUNCTIONS_BRANDING.shortName}, ${firstName}! Check your email for a sign-in link to access your account.`;
        const result = await sendSms({to: formattedTo, body, kind: 'welcome', context: 'welcome-sms'});
        smsSent = result.sent;
      } catch (smsError: any) {
        logger.error('Welcome SMS failed (non-fatal):', { message: smsError.message });
      }
    }

    // Welcome email (best-effort, non-fatal)
    let emailSent = false;
    if (email) {
      const template = welcomeEmail(firstName, FUNCTIONS_BRANDING.portalUrl);
      emailSent = await sendTransactionalEmail({to: email, ...template});
    }

    // Audit log: user creation
    logger.info('[AUDIT]', {
      audit: true,
      actorId: context.uid,
      actorRole: 'admin',
      action: 'user.created',
      resourceType: 'user',
      resourceId: userRecord.uid,
      metadata: { targetRole: role, smsSent, emailSent },
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      uid: userRecord.uid,
      smsSent,
      message: 'User created. The admin client should now send the sign-in invite link.',
    };

  } catch (error: any) {
    logger.error('Error creating user:', { code: error.code, message: error.message });

    return {
      success: false,
      error: error.message || 'An unexpected error occurred while creating the user.',
      code: error.code || 'UNEXPECTED_ERROR'
    };
  }
});


/**
 * Bootstrap the very first administrator on a fresh install — WordPress-style.
 *
 * Implemented as a Firestore-triggered function (NOT an unauthenticated
 * callable) so it works under GCP orgs that enforce
 * `iam.allowedPolicyMemberDomains` — which blocks granting `run.invoker` to
 * `allUsers` and would otherwise make a public callable unreachable.
 *
 * Flow:
 *  1. Unauthenticated client writes a request doc:
 *     `bootstrap-requests/{uuid} = { email, firstName, lastName, phoneNumber, status: 'pending' }`
 *     Firestore rules allow this create ONLY when `system/settings.bootstrapped`
 *     is false or missing.
 *  2. This trigger fires as the function's service account (no public
 *     invocation needed — Firestore triggers bypass Cloud Run IAM).
 *  3. Transactional gate: read `system/settings`, reject if already bootstrapped,
 *     self-heal if an active admin exists, otherwise reserve the slot.
 *  4. Create the Firebase Auth user (no password), set admin custom claim,
 *     write the `users/{uid}` profile doc.
 *  5. Write the resulting custom token back to the SAME request doc
 *     (`{ status: 'ready', token, uid }`). The client is listening via
 *     `onSnapshot` and immediately calls `signInWithCustomToken`.
 *
 * Security: the request doc's ID is a client-generated UUID (128 bits of
 * entropy). Firestore rules allow `get` but deny `list`, so an attacker can't
 * enumerate pending requests to steal tokens. The token is a one-shot
 * credential valid for ~1 hour; the request doc should be deleted by the
 * client after successful sign-in.
 *
 * Race-safe: concurrent bootstrap attempts hit the same transaction, only one
 * wins. The `bootstrapped` flag is write-once; once set, subsequent requests
 * are rejected with `status: 'error', error: 'ALREADY_BOOTSTRAPPED'`.
 */
export const onBootstrapRequestCreated = onDocumentCreated({
  document: 'bootstrap-requests/{requestId}',
}, async (event) => {
  const requestId = event.params.requestId;
  const data = event.data?.data();
  const requestRef = db.collection('bootstrap-requests').doc(requestId);

  const writeError = async (code: string, message: string) => {
    try {
      await requestRef.update({
        status: 'error',
        errorCode: code,
        error: message,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.error('Failed to write error status to bootstrap request:', err);
    }
  };

  if (!data) {
    logger.warn('Bootstrap request doc has no data', { requestId });
    return;
  }

  if (data.status && data.status !== 'pending') {
    return;
  }

  try {
    let email: string;
    let firstName: string;
    let lastName: string;
    let phoneNumber: string;
    try {
      const profile = validateUserProfileFields({
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phoneNumber: data.phoneNumber,
      });
      email = profile.email!;
      firstName = profile.firstName!;
      lastName = profile.lastName!;
      phoneNumber = profile.phoneNumber ?? '';
    } catch (validationErr: any) {
      await writeError('VALIDATION_FAILED', validationErr.message || 'Invalid input');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await writeError('INVALID_EMAIL', 'Invalid email address');
      return;
    }

    // Normalize phone number to canonical 10-digit US form so later
    // phone-OTP sign-ins can match.
    const normalizedPhone = phoneNumber ? normalizePhoneNumber(phoneNumber) : '';

    const settingsRef = db.collection('system').doc('settings');

    let reservedBootstrap = false;
    try {
      await db.runTransaction(async (tx) => {
        const settingsSnap = await tx.get(settingsRef);
        const settingsData = settingsSnap.data() || {};

        if (settingsData.bootstrapped === true) {
          throw new Error('ALREADY_BOOTSTRAPPED');
        }

        // Self-heal: if ANY user exists (not just admins), mark bootstrapped
        // and reject. The bootstrap form is only valid for a truly fresh
        // install — the presence of any leftover user record means the system
        // has already been used and the bootstrap channel must be closed.
        const anyUserQuery = await db.collection('users').limit(1).get();

        if (!anyUserQuery.empty) {
          tx.set(settingsRef, { bootstrapped: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          throw new Error('ALREADY_BOOTSTRAPPED');
        }

        tx.set(settingsRef, { bootstrapped: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        reservedBootstrap = true;
      });
    } catch (err: any) {
      if (err.message === 'ALREADY_BOOTSTRAPPED') {
        await writeError(
          'ALREADY_BOOTSTRAPPED',
          'This system has already been set up. Please ask an administrator to invite you.',
        );
        return;
      }
      throw err;
    }

    // Phase 2: create auth user + profile. Track everything created so the
    // rollback path can delete all of it atomically on any failure — we must
    // not leak orphan auth users or Firestore docs, since their presence would
    // cause the hardened "no users exist" check in Phase 1 to permanently
    // lock out future bootstrap attempts on retry.
    let createdAuthUid: string | null = null;
    let createdFirestoreDoc = false;
    try {
      try {
        await admin.auth().getUserByEmail(email);
        if (reservedBootstrap) {
          await settingsRef.set({ bootstrapped: false }, { merge: true });
        }
        await writeError(
          'USER_ALREADY_EXISTS',
          'A user with this email already exists. Try signing in instead.',
        );
        return;
      } catch (err: any) {
        if (err.code !== 'auth/user-not-found') throw err;
      }

      const userRecord = await admin.auth().createUser({
        email,
        displayName: `${firstName} ${lastName}`,
        emailVerified: true,
      });
      createdAuthUid = userRecord.uid;

      await admin.auth().setCustomUserClaims(userRecord.uid, { role: 'admin' });

      await db.collection('users').doc(userRecord.uid).set({
        email,
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`,
        role: 'admin',
        phoneNumber: normalizedPhone,
        isActive: true,
        emailVerified: true,
        authUid: userRecord.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      createdFirestoreDoc = true;

      const token = await admin.auth().createCustomToken(userRecord.uid, { role: 'admin' });

      logger.info('[AUDIT] First admin bootstrapped', {
        audit: true,
        actorId: 'bootstrap',
        action: 'user.bootstrap',
        resourceType: 'user',
        resourceId: userRecord.uid,
        timestamp: new Date().toISOString(),
      });

      await requestRef.update({
        status: 'ready',
        token,
        uid: userRecord.uid,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err: any) {
      // Atomic rollback: delete everything we created so the system returns
      // to true fresh-install state and the user can retry cleanly. Order
      // matters — delete Firestore doc before auth user so the `users` query
      // in Phase 1 doesn't see an orphan on retry.
      if (createdFirestoreDoc && createdAuthUid) {
        try {
          await db.collection('users').doc(createdAuthUid).delete();
        } catch (rbErr) {
          logger.error('Failed to rollback Firestore user doc:', rbErr);
        }
      }
      if (createdAuthUid) {
        try {
          await admin.auth().deleteUser(createdAuthUid);
        } catch (rbErr) {
          logger.error('Failed to rollback auth user:', rbErr);
        }
      }
      if (reservedBootstrap) {
        try {
          await settingsRef.set({ bootstrapped: false }, { merge: true });
        } catch (rollbackErr) {
          logger.error('Failed to rollback bootstrap flag:', rollbackErr);
        }
      }
      logger.error('Bootstrap admin creation failed:', err);
      await writeError(err.code || 'BOOTSTRAP_FAILED', err.message || 'Failed to create administrator');
    }
  } catch (error: any) {
    logger.error('onBootstrapRequestCreated unexpected error:', { code: error.code, message: error.message });
    await writeError('UNEXPECTED_ERROR', error.message || 'An unexpected error occurred');
  }
});


/**
 * Delete user account and all associated data.
 * Can be called by the patient themselves or by an admin.
 */
export const deleteAccount = onCall({
  cors: corsOptions
}, async (request) => {
  try {
    const context = requireAuth(request);

    const { targetUserId } = request.data;
    const uidToDelete = targetUserId || context.uid;

    // Only allow self-deletion or admin-initiated deletion
    if (uidToDelete !== context.uid) {
      await assertCallerIsAdmin(context);
    }

    // Rate limit: 1 deletion per 10 minutes
    await checkRateLimit(context.uid, 'deleteAccount', 1, 10);

    logger.info('[AUDIT] Account deletion started', {
      audit: true,
      actorId: context.uid,
      targetUserId: uidToDelete,
      timestamp: new Date().toISOString(),
    });

    const batch = db.batch();
    const collectionsToClean = [
      { name: 'appointments', field: 'patientId' },
      { name: 'prescription-refills', field: 'patientId' },
      { name: 'patient-documents', field: 'patientId' },
      { name: 'patient-intake-forms', field: 'patientId' },
      { name: 'message-threads', field: 'patientId' },
    ];

    let totalDeleted = 0;

    // Delete documents from each collection
    for (const col of collectionsToClean) {
      const snapshot = await db.collection(col.name)
        .where(col.field, '==', uidToDelete)
        .get();

      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        totalDeleted++;
      });
    }

    // Delete thread messages where user is sender
    const threadMessages = await db.collection('thread-messages')
      .where('senderId', '==', uidToDelete)
      .get();
    threadMessages.docs.forEach(doc => {
      batch.delete(doc.ref);
      totalDeleted++;
    });

    // Delete user document
    const userRef = db.collection('users').doc(uidToDelete);
    batch.delete(userRef);
    totalDeleted++;

    // Commit all Firestore deletions
    await batch.commit();

    // Delete files from Cloud Storage
    const storage = admin.storage().bucket();
    try {
      await storage.deleteFiles({
        prefix: `patients/${uidToDelete}/`,
      });
    } catch (storageError) {
      logger.warn('Storage cleanup partial or skipped:', { uid: uidToDelete });
    }

    // Delete Firebase Auth account
    try {
      await admin.auth().deleteUser(uidToDelete);
    } catch (authError: any) {
      if (authError.code !== 'auth/user-not-found') {
        logger.error('Failed to delete auth account:', { code: authError.code });
      }
    }

    logger.info('[AUDIT] Account deletion completed', {
      audit: true,
      actorId: context.uid,
      targetUserId: uidToDelete,
      documentsDeleted: totalDeleted,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      message: 'Account and all associated data have been deleted.',
    };

  } catch (error: any) {
    logger.error('Error deleting account:', { code: error.code, message: error.message });
    return {
      success: false,
      error: error.message || 'Failed to delete account.',
      code: error.code || 'DELETE_FAILED'
    };
  }
});


// =============================================================================
// Patient Data Export (HIPAA Right-of-Access)
// =============================================================================

export const exportPatientData = onCall({
  cors: corsOptions,
  memory: "1GiB",
  timeoutSeconds: 300,
}, async (request) => {
  try {
    const context = request.auth;
    if (!context) {
      throw new Error("Authentication required");
    }

    const patientId = context.uid;

    // Verify patient role
    const callerDoc = await db.collection("users").doc(patientId).get();
    const callerData = callerDoc.data();
    if (!callerDoc.exists || callerData?.role !== "patient") {
      throw new Error("Only patients can export their own data");
    }

    // Rate limit: 1 export per 60 minutes
    await checkRateLimit(patientId, "exportPatientData", 1, 60);

    logger.info("[AUDIT] Patient data export started", {
      audit: true,
      actorId: patientId,
      action: "patient.export",
      timestamp: new Date().toISOString(),
    });

    // ── Collect all patient data from Firestore ──

    const profile = callerData;

    const collectionsToExport = [
      {name: "appointments", field: "patientId", outputName: "appointments"},
      {name: "prescription-refills", field: "patientId", outputName: "prescription-refills"},
      {name: "patient-documents", field: "patientId", outputName: "documents-metadata"},
      {name: "patient-intake-forms", field: "patientId", outputName: "intake-forms"},
      {name: "specialist-requests", field: "patientId", outputName: "specialist-requests"},
    ];

    const exportData: Record<string, unknown[]> = {};

    for (const col of collectionsToExport) {
      const snapshot = await db.collection(col.name)
        .where(col.field, "==", patientId)
        .get();
      exportData[col.outputName] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    }

    // Messages: get threads then their messages
    const threadsSnapshot = await db.collection("message-threads")
      .where("patientId", "==", patientId)
      .get();

    const threads = threadsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const allMessages: unknown[] = [];
    for (const thread of threads) {
      const msgsSnapshot = await db.collection("thread-messages")
        .where("threadId", "==", (thread as {id: string}).id)
        .orderBy("createdAt", "asc")
        .get();
      msgsSnapshot.docs.forEach((doc) => {
        allMessages.push({id: doc.id, ...doc.data()});
      });
    }

    // Notifications
    const notifSnapshot = await db.collection("notifications")
      .where("recipientId", "==", patientId)
      .get();
    const notifications = notifSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Support chat
    const supportSnapshot = await db.collection("support-chat")
      .where("patientId", "==", patientId)
      .get();
    const supportChat = supportSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // ── Download files from Cloud Storage ──

    const bucket = admin.storage().bucket();
    const downloadedFiles: {path: string; buffer: Buffer}[] = [];
    let totalFileSize = 0;
    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB guard

    // Patient documents
    try {
      const [files] = await bucket.getFiles({
        prefix: `patients/${patientId}/documents/`,
      });
      for (const file of files) {
        if (totalFileSize > MAX_FILE_SIZE) break;
        try {
          const [buffer] = await file.download();
          totalFileSize += buffer.length;
          const relativePath = file.name.replace(
            `patients/${patientId}/documents/`,
            "files/documents/"
          );
          downloadedFiles.push({path: relativePath, buffer});
        } catch {
          logger.warn(`Failed to download file: ${file.name}`);
        }
      }
    } catch {
      logger.warn("No patient documents in Storage or access error");
    }

    // Message attachments
    const messagesWithAttachments = allMessages.filter(
      (m: any) => m.attachments?.length > 0
    );
    for (const msg of messagesWithAttachments as any[]) {
      if (totalFileSize > MAX_FILE_SIZE) break;
      for (const att of msg.attachments) {
        if (!att.url) continue;
        // Extract storage path from download URL
        try {
          const url = new URL(att.url);
          const pathMatch = url.pathname.match(/\/o\/(.+?)(\?|$)/);
          if (!pathMatch) continue;
          const storagePath = decodeURIComponent(pathMatch[1]);
          const [buffer] = await bucket.file(storagePath).download();
          totalFileSize += buffer.length;
          downloadedFiles.push({
            path: `files/message-attachments/${msg.threadId}/${att.name || "attachment"}`,
            buffer,
          });
        } catch {
          logger.warn(`Failed to download attachment: ${att.name}`);
        }
      }
    }

    const filesSkipped = totalFileSize > MAX_FILE_SIZE;

    // ── Build ZIP ──

    const archiver = require("archiver");
    const {PassThrough} = require("stream");

    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const passThrough = new PassThrough();
      passThrough.on("data", (chunk: Buffer) => chunks.push(chunk));
      passThrough.on("end", () => resolve(Buffer.concat(chunks)));
      passThrough.on("error", reject);

      const archive = archiver("zip", {zlib: {level: 6}});
      archive.on("error", reject);
      archive.pipe(passThrough);

      // README
      const exportDate = new Date().toISOString();
      archive.append(
        `Patient Data Export\n` +
        `Generated: ${exportDate}\n` +
        `Patient ID: ${patientId}\n\n` +
        `This archive contains your health records exported under HIPAA Right of Access.\n` +
        `The data/ folder contains structured records in JSON format.\n` +
        `The files/ folder contains your uploaded documents and message attachments.\n` +
        (filesSkipped ? `\nNote: Some files were skipped because the total exceeded 500MB.\n` : ""),
        {name: "patient-export/README.txt"}
      );

      // JSON data
      archive.append(JSON.stringify(profile, null, 2),
        {name: "patient-export/data/profile.json"});
      archive.append(JSON.stringify(exportData["appointments"], null, 2),
        {name: "patient-export/data/appointments.json"});
      archive.append(JSON.stringify({threads, messages: allMessages}, null, 2),
        {name: "patient-export/data/messages.json"});
      archive.append(JSON.stringify(exportData["documents-metadata"], null, 2),
        {name: "patient-export/data/documents-metadata.json"});
      archive.append(JSON.stringify(exportData["intake-forms"], null, 2),
        {name: "patient-export/data/intake-forms.json"});
      archive.append(JSON.stringify(exportData["prescription-refills"], null, 2),
        {name: "patient-export/data/prescription-refills.json"});
      archive.append(JSON.stringify(exportData["specialist-requests"], null, 2),
        {name: "patient-export/data/specialist-requests.json"});
      archive.append(JSON.stringify(notifications, null, 2),
        {name: "patient-export/data/notifications.json"});
      archive.append(JSON.stringify(supportChat, null, 2),
        {name: "patient-export/data/support-chat.json"});

      // Binary files
      for (const file of downloadedFiles) {
        archive.append(file.buffer, {name: `patient-export/${file.path}`});
      }

      archive.finalize();
    });

    // ── Upload ZIP and generate signed URL ──

    const timestamp = Date.now();
    const exportPath = `exports/${patientId}/patient-export-${timestamp}.zip`;
    const exportFile = bucket.file(exportPath);

    await exportFile.save(zipBuffer, {
      metadata: {contentType: "application/zip"},
    });

    const [signedUrl] = await exportFile.getSignedUrl({
      action: "read" as const,
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    logger.info("[AUDIT] Patient data export completed", {
      audit: true,
      actorId: patientId,
      action: "patient.export.completed",
      zipSizeBytes: zipBuffer.length,
      fileCount: downloadedFiles.length,
      filesSkipped,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      downloadUrl: signedUrl,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      filesSkipped,
    };
  } catch (error: any) {
    logger.error("Error exporting patient data:", {
      code: error.code,
      message: error.message,
    });
    return {
      success: false,
      error: error.message || "Failed to export data.",
      code: error.code || "EXPORT_FAILED",
    };
  }
});


// =============================================================================
// Google Calendar Integration
// =============================================================================

import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getFreeBusySlots,
  getChangedEvents,
  getSyncToken,
  saveSyncToken,
  hasCalendarConfigured,
} from './google-calendar';

/**
 * Firestore trigger: sync appointment changes → Google Calendar
 * Runs on every appointment create/update/delete.
 */
export const onAppointmentWrite = onDocumentWritten({
  document: 'appointments/{appointmentId}',
  secrets: [...SMS_SECRETS],
}, async (event) => {
    const appointmentId = event.params.appointmentId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Skip if change came from Calendar sync (prevent loop)
    if (after?.lastSyncSource === 'calendar') {
      logger.info(`Skipping Calendar sync for ${appointmentId} — change came from Calendar`);
      return;
    }

    try {
      // Fetch patient info for the event title
      const patientId = after?.patientId || before?.patientId;
      if (!patientId) return;

      const patientDoc = await db.collection('users').doc(patientId).get();
      const patientData = patientDoc.data();
      if (!patientData) {
        logger.warn(`Patient ${patientId} not found, skipping Calendar sync`);
        return;
      }

      const patientName = `${patientData.firstName || ''} ${patientData.lastName || ''}`.trim();
      const patientPhone = patientData.phoneNumber || '';

      // --- DELETE ---
      if (!after && before) {
        if (before.googleCalendarEventId) {
          await deleteCalendarEvent(before.googleCalendarEventId);
        }
        return;
      }

      // --- CREATE ---
      if (!before && after) {
        // Only create Calendar event if already confirmed (not for 'scheduled' — pending approval)
        if (after.status === 'confirmed') {
          // Auto-generate reminderMessage if not set
          const updateFields: Record<string, any> = {};
          if (!after.reminderMessage) {
            const defaultMsg = generateDefaultReminderMessage(after as any);
            updateFields.reminderMessage = defaultMsg;
            after.reminderMessage = defaultMsg;
          }

          const eventId = await createCalendarEvent(
            { id: appointmentId, ...after } as any,
            patientName,
            patientPhone
          );

          if (eventId) {
            updateFields.googleCalendarEventId = eventId;
            updateFields.lastSyncSource = 'app';
          }

          if (Object.keys(updateFields).length > 0) {
            await db.collection('appointments').doc(appointmentId).update(updateFields);
          }
        }
        return;
      }

      // --- UPDATE ---
      if (before && after) {
        const eventId = after.googleCalendarEventId || before.googleCalendarEventId;

        // If cancelled/rejected, delete the Calendar event and SMS the patient
        if (after.status === 'cancelled' && before.status !== 'cancelled') {
          if (eventId) {
            await deleteCalendarEvent(eventId);
            await db.collection('appointments').doc(appointmentId).update({
              googleCalendarEventId: admin.firestore.FieldValue.delete(),
              lastSyncSource: 'app',
            });
          }
          // SMS patient about rejection (only if was previously scheduled/confirmed, not from Calendar sync)
          if (before.status === 'scheduled' || before.status === 'confirmed') {
            await sendAppointmentStatusSMS(patientId, 'cancelled', after.appointmentDate, after.notes);
          }
          return;
        }

        // Just approved — create Calendar event and SMS the patient
        if (after.status === 'confirmed' && before.status === 'scheduled') {
          // Auto-generate reminderMessage if not set
          if (!after.reminderMessage) {
            const defaultMsg = generateDefaultReminderMessage(after as any);
            await db.collection('appointments').doc(appointmentId).update({
              reminderMessage: defaultMsg,
            });
            after.reminderMessage = defaultMsg;
          }

          await sendAppointmentStatusSMS(patientId, 'confirmed', after.appointmentDate);

          if (!eventId) {
            const newEventId = await createCalendarEvent(
              { id: appointmentId, ...after } as any,
              patientName,
              patientPhone
            );
            if (newEventId) {
              await db.collection('appointments').doc(appointmentId).update({
                googleCalendarEventId: newEventId,
                lastSyncSource: 'app',
              });
            }
          }
          return;
        }

        // If we have a Calendar event, update it
        if (eventId) {
          await updateCalendarEvent(
            eventId,
            { id: appointmentId, ...after } as any,
            patientName,
            patientPhone
          );
        } else if (after.status === 'confirmed') {
          // No Calendar event yet but confirmed — create one
          const newEventId = await createCalendarEvent(
            { id: appointmentId, ...after } as any,
            patientName,
            patientPhone
          );
          if (newEventId) {
            await db.collection('appointments').doc(appointmentId).update({
              googleCalendarEventId: newEventId,
              lastSyncSource: 'app',
            });
          }
        }
      }
    } catch (error: any) {
      logger.error(`Error syncing appointment ${appointmentId} to Calendar:`, {
        message: error.message,
      });
    }
  }
);

/**
 * Scheduled function: sync Google Calendar changes → Firestore
 * Polls every 5 minutes using incremental sync tokens.
 */
export const syncCalendarChanges = onSchedule({
  schedule: '*/5 * * * *',
  timeZone: process.env.TZ || 'America/Los_Angeles',
}, async () => {
  if (!(await hasCalendarConfigured())) {
    logger.info('Google Workspace calendar not configured, skipping Calendar sync');
    return;
  }

  try {
    const syncToken = await getSyncToken();
    const { events, nextSyncToken } = await getChangedEvents(syncToken || undefined);

    if (nextSyncToken) {
      await saveSyncToken(nextSyncToken);
    }

    if (events.length === 0) {
      logger.info('No calendar changes detected');
      return;
    }

    logger.info(`Processing ${events.length} changed calendar events`);

    for (const event of events) {
      try {
        const firestoreId = event.extendedProperties?.private?.firestoreId;
        if (!firestoreId) {
          // Event not created by our app — skip
          continue;
        }

        const appointmentRef = db.collection('appointments').doc(firestoreId);
        const appointmentDoc = await appointmentRef.get();

        if (!appointmentDoc.exists) {
          logger.warn(`Appointment ${firestoreId} not found for calendar event ${event.id}`);
          continue;
        }

        const appointment = appointmentDoc.data()!;

        // Skip if last sync was from the app (our own change echoing back)
        if (appointment.lastSyncSource === 'app') {
          // Reset sync source so future Calendar changes are picked up
          await appointmentRef.update({ lastSyncSource: admin.firestore.FieldValue.delete() });
          continue;
        }

        // Event cancelled or deleted in Calendar
        if (event.status === 'cancelled') {
          if (appointment.status !== 'cancelled') {
            await appointmentRef.update({
              status: 'cancelled',
              lastSyncSource: 'calendar',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            logger.info(`Appointment ${firestoreId} cancelled from Calendar`);

            // Create admin notification
            await db.collection('notifications').add({
              recipientRole: 'admin',
              type: 'appointment_cancelled',
              title: 'Appointment Cancelled from Calendar',
              message: `An appointment was cancelled directly in Google Calendar`,
              meta: { appointmentId: firestoreId, patientId: appointment.patientId },
              isRead: false,
              readBy: {},
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
          continue;
        }

        // Event time changed in Calendar
        if (event.start?.dateTime) {
          const newStart = new Date(event.start.dateTime);
          const currentStart = appointment.appointmentDate?.toDate?.();

          if (currentStart && Math.abs(newStart.getTime() - currentStart.getTime()) > 60000) {
            // More than 1 minute difference — update Firestore
            await appointmentRef.update({
              appointmentDate: admin.firestore.Timestamp.fromDate(newStart),
              lastSyncSource: 'calendar',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            logger.info(`Appointment ${firestoreId} rescheduled from Calendar to ${newStart.toISOString()}`);

            await db.collection('notifications').add({
              recipientRole: 'admin',
              type: 'appointment_booked',
              title: 'Appointment Rescheduled from Calendar',
              message: `Appointment moved to ${newStart.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' })} at ${newStart.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })}`,
              meta: { appointmentId: firestoreId, patientId: appointment.patientId },
              isRead: false,
              readBy: {},
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }
      } catch (eventError: any) {
        logger.error(`Error processing calendar event ${event.id}:`, {
          message: eventError.message,
        });
      }
    }

    logger.info('Calendar sync completed');
  } catch (error: any) {
    logger.error('Error in syncCalendarChanges:', { message: error.message });
  }
});

/**
 * Callable: get available time slots for a given date
 * Returns all 30-min slots from 9AM–5PM PST with availability status.
 */
export const getAvailableSlots = onCall({
  cors: corsOptions,
}, async (request) => {
  try {
    const context = request.auth;
    if (!context) {
      throw new Error('Authentication required');
    }

    const { date } = request.data;
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Valid date (YYYY-MM-DD) is required');
    }

    // Get busy times from Google Calendar (empty if integration not configured)
    const busySlots = await getFreeBusySlots(date);

    // Query a wide window (full day UTC) to catch all appointments for this date
    // regardless of PST/PDT offset. The overlap check below handles precision.
    const dayStartUTC = new Date(`${date}T00:00:00Z`);
    const dayEndUTC = new Date(`${date}T23:59:59Z`);

    const firestoreSnapshot = await db.collection('appointments')
      .where('appointmentDate', '>=', admin.firestore.Timestamp.fromDate(dayStartUTC))
      .where('appointmentDate', '<', admin.firestore.Timestamp.fromDate(dayEndUTC))
      .get();

    const firestoreBooked = firestoreSnapshot.docs
      .filter(doc => {
        const status = doc.data().status;
        return status !== 'cancelled' && status !== 'no-show';
      })
      .map(doc => {
        const data = doc.data();
        const start = data.appointmentDate.toDate();
        const duration = data.duration || 30;
        const end = new Date(start.getTime() + duration * 60 * 1000);
        return { start, end };
      });

    // Merge busy slots from both sources
    const allBusy = [...busySlots, ...firestoreBooked];

    // Determine PST vs PDT offset for the given date
    // DST in US: starts 2nd Sunday of March, ends 1st Sunday of November
    const [year, month, day] = date.split('-').map(Number);
    const isPDT = (() => {
      // March through October could be PDT
      if (month < 3 || month > 11) return false;
      if (month > 3 && month < 11) return true;
      // March: PDT starts 2nd Sunday
      if (month === 3) {
        const firstDay = new Date(year, 2, 1).getDay();
        const secondSunday = firstDay === 0 ? 8 : 15 - firstDay;
        return day >= secondSunday;
      }
      // November: PDT ends 1st Sunday
      const firstDay = new Date(year, 10, 1).getDay();
      const firstSunday = firstDay === 0 ? 1 : 8 - firstDay;
      return day < firstSunday;
    })();
    const offsetStr = isPDT ? '-07:00' : '-08:00';

    logger.info(`[getAvailableSlots] date=${date} offset=${offsetStr} firestoreBooked=${firestoreBooked.length} calendarBusy=${busySlots.length}`);
    for (const b of firestoreBooked) {
      logger.info(`[getAvailableSlots] booked: ${b.start.toISOString()} - ${b.end.toISOString()}`);
    }

    // Generate 20-min slots from 9:00 to 17:40
    const slots: { time: string; available: boolean }[] = [];
    for (let hour = 9; hour <= 17; hour++) {
      for (const minutes of [0, 20, 40]) {
        if (hour === 17 && minutes > 40) continue;
        if (hour === 18) continue;
        const slotTime = `${hour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        const slotStart = new Date(`${date}T${slotTime}:00${offsetStr}`);
        const slotEnd = new Date(slotStart.getTime() + 20 * 60 * 1000);

        // Check if slot overlaps with any busy period
        const isBooked = allBusy.some(busy =>
          slotStart < busy.end && slotEnd > busy.start
        );

        slots.push({ time: slotTime, available: !isBooked });
      }
    }

    return { success: true, slots };
  } catch (error: any) {
    logger.error('Error getting available slots:', { message: error.message });
    return { success: false, error: error.message, slots: [] };
  }
});

/**
 * Callable: validate a specific appointment slot before booking
 * Prevents race conditions when two patients book the same slot.
 */
export const validateAppointmentSlot = onCall({
  cors: corsOptions,
}, async (request) => {
  try {
    const context = request.auth;
    if (!context) {
      throw new Error('Authentication required');
    }

    const { appointmentDate, appointmentId } = request.data;
    if (!appointmentDate || typeof appointmentDate !== 'string') {
      throw new Error('appointmentDate (ISO string) is required');
    }

    const slotStart = new Date(appointmentDate);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

    // Check Google Calendar FreeBusy (getFreeBusySlots returns [] when unconfigured)
    {
      const dateStr = slotStart.toISOString().split('T')[0];
      const busySlots = await getFreeBusySlots(dateStr);
      const calendarConflict = busySlots.some(busy =>
        slotStart < busy.end && slotEnd > busy.start
      );

      if (calendarConflict) {
        return { available: false, reason: 'This time slot is already taken.' };
      }
    }

    // Check Firestore appointments
    const windowStart = admin.firestore.Timestamp.fromDate(slotStart);
    const windowEnd = admin.firestore.Timestamp.fromDate(slotEnd);

    const conflictSnapshot = await db.collection('appointments')
      .where('appointmentDate', '>=', windowStart)
      .where('appointmentDate', '<', windowEnd)
      .get();

    const hasConflict = conflictSnapshot.docs.some(doc => {
      const data = doc.data();
      // Skip cancelled/no-show and the appointment being edited
      if (data.status === 'cancelled' || data.status === 'no-show') return false;
      if (appointmentId && doc.id === appointmentId) return false;
      return true;
    });

    if (hasConflict) {
      return { available: false, reason: 'This time slot was just taken. Please choose another.' };
    }

    return { available: true };
  } catch (error: any) {
    logger.error('Error validating slot:', { message: error.message });
    return { available: false, reason: 'Unable to validate slot. Please try again.' };
  }
});


// =============================================================================
// Phone Verification (SignalWire SMS)
// =============================================================================

/**
 * Send a 6-digit verification code to a phone number via SignalWire SMS.
 * Stores hashed code in Firestore with 10-minute expiry.
 */
export const sendPhoneVerificationCode = onCall({
  cors: corsOptions,
  secrets: [...SMS_SECRETS],
}, async (request) => {
  try {
    const context = request.auth;
    if (!context) {
      throw new Error('Authentication required');
    }

    // Rate limit: 5 SMS per 10 minutes per user
    await checkRateLimit(context.uid, 'phoneVerify', 5, 10);

    const { phoneNumber } = request.data;
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new Error('Phone number is required');
    }

    const normalized = normalizePhoneNumber(phoneNumber);
    if (!/^\d{10}$/.test(normalized)) {
      throw new Error('Please enter a valid US phone number');
    }
    const wireTo = toE164(normalized);

    // Generate 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();

    // Hash before storing (don't store plain codes)
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    // Store in Firestore with 10-minute expiry
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.collection('phone-verifications').doc(context.uid).set({
      phoneNumber: normalized,
      codeHash,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      attempts: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const body = `Your ${FUNCTIONS_BRANDING.shortName} verification code is: ${code}`;
    const result = await sendSms({to: wireTo, body, kind: 'verification', context: 'phone-verify-otp'});
    if (!result.sent) throw new Error('SMS service not configured');

    logger.info(`Verification code ${result.sim ? 'recorded (sim)' : 'sent'}`, { uid: context.uid });
    return { success: true, message: 'Verification code sent' };
  } catch (error: any) {
    logger.error('Error sending verification code:', { message: error.message });
    return { success: false, error: error.message };
  }
});

/**
 * Verify a phone verification code.
 * On success, updates user's phoneNumber and phoneVerified fields.
 * If phone changed, updates all upcoming Calendar events with new phone.
 */
export const verifyPhoneCode = onCall({
  cors: corsOptions,
}, async (request) => {
  try {
    const context = request.auth;
    if (!context) {
      throw new Error('Authentication required');
    }

    const { code } = request.data;
    if (!code || typeof code !== 'string' || code.length !== 6) {
      throw new Error('Please enter a 6-digit verification code');
    }

    const verificationRef = db.collection('phone-verifications').doc(context.uid);
    const verificationDoc = await verificationRef.get();

    if (!verificationDoc.exists) {
      return { success: false, error: 'No verification pending. Please request a new code.' };
    }

    const data = verificationDoc.data()!;

    // Check expiry
    if (data.expiresAt.toDate() < new Date()) {
      await verificationRef.delete();
      return { success: false, error: 'Code expired. Please request a new one.' };
    }

    // Check attempts (max 5)
    if (data.attempts >= 5) {
      await verificationRef.delete();
      return { success: false, error: 'Too many attempts. Please request a new code.' };
    }

    // Increment attempts
    await verificationRef.update({ attempts: data.attempts + 1 });

    // Verify code
    const inputHash = crypto.createHash('sha256').update(code).digest('hex');
    if (inputHash !== data.codeHash) {
      return { success: false, error: 'Incorrect code. Please try again.' };
    }

    // Code matches — update user profile
    const userRef = db.collection('users').doc(context.uid);
    const userDoc = await userRef.get();
    const oldPhone = userDoc.data()?.phoneNumber || '';
    const newPhone = data.phoneNumber;

    // Check phone number uniqueness (skip if unchanged)
    if (oldPhone !== newPhone) {
      const existingUsers = await db.collection('users')
        .where('phoneNumber', '==', newPhone)
        .limit(1)
        .get();
      if (!existingUsers.empty) {
        await verificationRef.delete();
        return { success: false, error: 'This phone number is already associated with another account.' };
      }
    }

    await userRef.update({
      phoneNumber: newPhone,
      phoneVerified: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Clean up verification doc
    await verificationRef.delete();

    // If phone number actually changed, update upcoming Calendar events
    if (oldPhone !== newPhone && (await hasCalendarConfigured())) {
      await updateCalendarEventsForPhoneChange(context.uid, newPhone);
    }

    logger.info('Phone verified successfully', { uid: context.uid });
    return { success: true, phoneNumber: newPhone };
  } catch (error: any) {
    logger.error('Error verifying phone code:', { message: error.message });
    return { success: false, error: error.message };
  }
});

/**
 * Send a phone login OTP code (unauthenticated).
 * Rate limited by phone number to prevent abuse.
 */
export const sendPhoneLoginCode = onCall({
  cors: corsOptions,
  secrets: [...SMS_SECRETS],
}, async (request) => {
  try {
    const { phoneNumber } = request.data;
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new Error('Phone number is required');
    }

    const normalized = normalizePhoneNumber(phoneNumber);
    if (!/^\d{10}$/.test(normalized)) {
      throw new Error('Please enter a valid US phone number');
    }
    const wireTo = toE164(normalized);

    // Rate limit by phone number (protects the victim from SMS bombing) AND
    // by client IP (protects our SignalWire budget from an attacker cycling
    // through many different phone numbers). Both must pass.
    await checkRateLimit(normalized, 'phoneLogin', 5, 10);
    await checkRateLimit(clientIp(request), 'phoneLoginIp', 10, 10);

    // Generate 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    // Store in phone-login-codes with 5-minute expiry
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await db.collection('phone-login-codes').doc(normalized).set({
      phoneNumber: normalized,
      codeHash,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      attempts: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const body = `Your ${FUNCTIONS_BRANDING.shortName} login code is: ${code}`;
    const result = await sendSms({to: wireTo, body, kind: 'verification', context: 'phone-login-otp'});
    if (!result.sent) throw new Error('SMS service not configured');

    logger.info(`Phone login code ${result.sim ? 'recorded (sim)' : 'sent'}`, { phone: normalized.slice(-4) });
    return { success: true, message: 'Verification code sent' };
  } catch (error: any) {
    logger.error('Error sending phone login code:', { message: error.message });
    return { success: false, error: error.message };
  }
});

/**
 * Verify phone login OTP and return a Firebase custom token (unauthenticated).
 * If user exists by phone number, logs them in.
 * If new user, creates account and logs them in.
 * Respects registration toggle — if registration is disabled, only existing users can log in.
 */
export const verifyPhoneLogin = onCall({
  cors: corsOptions,
}, async (request) => {
  try {
    const { phoneNumber, code, firstName, lastName } = request.data;

    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new Error('Phone number is required');
    }
    if (!code || typeof code !== 'string' || code.length !== 6) {
      throw new Error('Please enter a 6-digit verification code');
    }

    const normalized = normalizePhoneNumber(phoneNumber);

    // Look up verification record
    const verificationRef = db.collection('phone-login-codes').doc(normalized);
    const verificationDoc = await verificationRef.get();

    if (!verificationDoc.exists) {
      return { success: false, error: 'No verification pending. Please request a new code.' };
    }

    const data = verificationDoc.data()!;

    // Check expiry
    if (data.expiresAt.toDate() < new Date()) {
      await verificationRef.delete();
      return { success: false, error: 'Code expired. Please request a new one.' };
    }

    // Check attempts (max 5)
    if (data.attempts >= 5) {
      await verificationRef.delete();
      return { success: false, error: 'Too many attempts. Please request a new code.' };
    }

    // Increment attempts
    await verificationRef.update({ attempts: data.attempts + 1 });

    // Verify code
    const inputHash = crypto.createHash('sha256').update(code).digest('hex');
    if (inputHash !== data.codeHash) {
      return { success: false, error: 'Incorrect code. Please try again.' };
    }

    // Code is valid — clean up
    await verificationRef.delete();

    // Look up existing user by phone number
    const usersSnapshot = await db.collection('users')
      .where('phoneNumber', '==', normalized)
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      // Existing user — create custom token and return
      const userDoc = usersSnapshot.docs[0];
      const userData = userDoc.data();

      if (!userData.isActive) {
        return { success: false, error: 'Your account is inactive. Please contact the office.' };
      }

      // Phone OTP is the weakest auth path we offer (SIM swap, SS7 intercept).
      // Don't mint admin tokens from it — those roles must re-auth
      // via Google OAuth or email link. Without this gate, an attacker who
      // ports an admin's phone number can inherit full admin access.
      if (userData.role !== 'patient') {
        logger.warn('Phone login refused for non-patient role', { uid: userDoc.id, role: userData.role });
        return {
          success: false,
          error: 'Staff accounts must sign in with email or Google.',
        };
      }

      // Update last login
      await userDoc.ref.update({
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const token = await admin.auth().createCustomToken(userDoc.id, { role: 'patient' });

      logger.info('Phone login successful (existing user)', { uid: userDoc.id });
      return { success: true, token, isNewUser: false };
    }

    // New user — check registration toggle
    const settingsDoc = await db.collection('system').doc('settings').get();
    const settings = settingsDoc.data();
    if (settings?.registrationEnabled === false) {
      return {
        success: false,
        error: 'New patient registration is currently closed. Please contact the office.',
      };
    }

    // Require name for new users
    if (!firstName || !lastName) {
      return { success: true, isNewUser: true, needsName: true };
    }

    const trimmedFirst = String(firstName).trim().slice(0, 100);
    const trimmedLast = String(lastName).trim().slice(0, 100);

    if (trimmedFirst.length < 2 || trimmedLast.length < 2) {
      return { success: false, error: 'First and last name must be at least 2 characters.' };
    }

    // Create Firebase Auth user (phone only, no email). Firebase Auth
    // requires E.164 for phoneNumber; Firestore stores the 10-digit form.
    const wirePhone = toE164(normalized);
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        phoneNumber: wirePhone,
        displayName: `${trimmedFirst} ${trimmedLast}`,
      });
    } catch (authError: any) {
      // Phone number might already be in Firebase Auth but not in our users collection
      if (authError.code === 'auth/phone-number-already-exists') {
        const existingAuth = await admin.auth().getUserByPhoneNumber(wirePhone);
        userRecord = existingAuth;
      } else {
        logger.error('Error creating phone user:', authError);
        return { success: false, error: 'Failed to create account. Please try again.' };
      }
    }

    // Set custom claims
    await admin.auth().setCustomUserClaims(userRecord.uid, { role: 'patient' });

    // Create Firestore user profile
    const userProfile = {
      firstName: trimmedFirst,
      lastName: trimmedLast,
      displayName: `${trimmedFirst} ${trimmedLast}`,
      role: 'patient',
      phoneNumber: normalized,
      phoneVerified: true,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('users').doc(userRecord.uid).set(userProfile);

    const token = await admin.auth().createCustomToken(userRecord.uid, { role: 'patient' });

    logger.info('Phone registration successful', { uid: userRecord.uid });

    // Audit log
    logger.info('[AUDIT]', {
      audit: true,
      actorId: userRecord.uid,
      actorRole: 'patient',
      action: 'user.phone_registered',
      resourceType: 'user',
      resourceId: userRecord.uid,
      timestamp: new Date().toISOString(),
    });

    return { success: true, token, isNewUser: true };
  } catch (error: any) {
    logger.error('Error verifying phone login:', { message: error.message });
    return { success: false, error: error.message };
  }
});

/**
 * Update all upcoming Calendar events when a patient's phone number changes.
 * The event title includes the phone number for SMS reminder compatibility.
 */
async function updateCalendarEventsForPhoneChange(patientId: string, newPhone: string): Promise<void> {
  try {
    const now = admin.firestore.Timestamp.now();

    // Find all upcoming, non-cancelled appointments for this patient
    const appointmentsSnapshot = await db.collection('appointments')
      .where('patientId', '==', patientId)
      .where('appointmentDate', '>=', now)
      .get();

    if (appointmentsSnapshot.empty) {
      logger.info('No upcoming appointments to update for phone change');
      return;
    }

    // Get patient name
    const patientDoc = await db.collection('users').doc(patientId).get();
    const patientData = patientDoc.data();
    const patientName = patientData
      ? `${patientData.firstName || ''} ${patientData.lastName || ''}`.trim()
      : 'Patient';

    let updated = 0;
    for (const doc of appointmentsSnapshot.docs) {
      const appointment = doc.data();
      if (appointment.status === 'cancelled' || appointment.status === 'no-show') continue;

      const eventId = appointment.googleCalendarEventId;
      if (!eventId) continue;

      const success = await updateCalendarEvent(
        eventId,
        { id: doc.id, ...appointment } as any,
        patientName,
        newPhone
      );

      if (success) updated++;
    }

    logger.info(`Updated ${updated} calendar events with new phone number for patient ${patientId}`);
  } catch (error: any) {
    logger.error('Error updating calendar events for phone change:', { message: error.message });
  }
}


// =============================================================================
// Appointment SMS Notifications (approve/reject)
// =============================================================================

/**
 * Generate default SMS reminder message for an appointment.
 * This becomes the Calendar event description and the SMS text sent by the reminder cron.
 */
function generateDefaultReminderMessage(appointment: {
  appointmentDate: admin.firestore.Timestamp;
  appointmentType?: string;
  specialistType?: string;
  isSpecialistReferral?: boolean;
  address?: string;
  reason?: string;
  notes?: string;
}): string {
  let typeLabel: string;
  if (appointment.isSpecialistReferral && appointment.specialistType) {
    typeLabel = appointment.specialistType.replace(/_/g, ' ');
    // Capitalize first letter of each word
    typeLabel = typeLabel.replace(/\b\w/g, c => c.toUpperCase());
    typeLabel += ' (Specialist Referral)';
  } else {
    typeLabel = appointment.appointmentType || 'Appointment';
    typeLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);
  }

  let msg = typeLabel;
  if (appointment.address) {
    msg += `\nLocation: ${appointment.address}`;
  }
  if (appointment.reason) {
    msg += `\nReason: ${appointment.reason}`;
  }
  return msg;
}

/**
 * Send SMS to patient when appointment is approved or rejected.
 * Called by the onAppointmentWrite trigger when status changes.
 */
async function sendAppointmentStatusSMS(
  patientId: string,
  status: 'confirmed' | 'cancelled',
  appointmentDate: admin.firestore.Timestamp,
  reason?: string
): Promise<void> {
  try {
    // Get patient phone number
    const patientDoc = await db.collection('users').doc(patientId).get();
    const patientData = patientDoc.data();
    const phone = patientData?.phoneNumber;
    if (!phone) return;

    const wireTo = toE164(phone);
    const date = appointmentDate.toDate();
    const dateStr = date.toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const timeStr = date.toLocaleTimeString('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
    });

    let message: string;
    if (status === 'confirmed') {
      message = `${FUNCTIONS_BRANDING.shortName}: Your appointment on ${dateStr} at ${timeStr} has been confirmed. We look forward to seeing you!`;
    } else {
      message = `${FUNCTIONS_BRANDING.shortName}: Your appointment request for ${dateStr} at ${timeStr} was not approved.`;
      if (reason) message += ` Reason: ${reason}`;
      message += ' Please contact us to reschedule.';
    }

    const result = await sendSms({to: wireTo, body: message, kind: 'admin', context: `appointment-${status}-sms`});
    if (result.sent) {
      logger.info(`Appointment ${status} SMS ${result.sim ? 'recorded (sim)' : 'sent'} to patient ${patientId}`);
    }

    // Also send email notification
    const email = patientData?.email;
    const patientName = [patientData?.firstName, patientData?.lastName]
      .filter(Boolean).join(' ') || 'Patient';
    if (email) {
      const template = status === 'confirmed'
        ? appointmentConfirmedEmail(patientName, dateStr, timeStr)
        : appointmentCancelledEmail(patientName, dateStr, timeStr);
      await sendTransactionalEmail({to: email, ...template});
    }
  } catch (error: any) {
    logger.error('Error sending appointment status notification:', { message: error.message });
  }
}


// =============================================================================
// Scheduled Cleanup
// =============================================================================

/**
 * Delete cancelled appointments older than 2 weeks.
 * Runs daily at 3 AM PST.
 */
export const cleanupCancelledAppointments = onSchedule({
  schedule: '0 3 * * *',
  timeZone: 'America/Los_Angeles',
}, async () => {
  try {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const snapshot = await db.collection('appointments')
      .where('status', '==', 'cancelled')
      .where('updatedAt', '<=', admin.firestore.Timestamp.fromDate(twoWeeksAgo))
      .get();

    if (snapshot.empty) {
      logger.info('No cancelled appointments to clean up');
      return;
    }

    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    logger.info(`Cleaned up ${snapshot.size} cancelled appointments older than 2 weeks`);
  } catch (error: any) {
    logger.error('Error cleaning up cancelled appointments:', { message: error.message });
  }
});


// =============================================================================
// Secure File Proxy
// =============================================================================

/**
 * Serves files from Cloud Storage after verifying the user has access.
 * Returns a short-lived signed URL (15 minutes) instead of a permanent download token.
 *
 * Usage: GET /serveFile?path=patients/{patientId}/documents/file.pdf
 *        Authorization: Bearer <firebase-id-token>
 */
export const serveFile = onRequest({
  cors: [...corsOptions, 'http://localhost:5173'],
}, async (req, res) => {
  try {
    // Verify auth token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const idToken = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const uid = decodedToken.uid;
    const filePath = req.query.path as string;

    if (!filePath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    // Access control based on file path
    const userDoc = await db.collection('users').doc(uid).get();
    const userRole = userDoc.data()?.role;
    const isAdmin = userRole === 'admin';

    // Patient documents: /patients/{patientId}/documents/...
    if (filePath.startsWith('patients/')) {
      const pathParts = filePath.split('/');
      const patientId = pathParts[1];

      if (uid !== patientId && !isAdmin) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
    }
    // Message attachments: /messages/{threadId}/attachments/...
    else if (filePath.startsWith('messages/')) {
      const pathParts = filePath.split('/');
      const threadId = pathParts[1];

      const threadDoc = await db.collection('message-threads').doc(threadId).get();
      if (!threadDoc.exists) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }

      const threadData = threadDoc.data()!;
      if (uid !== threadData.patientId && !isAdmin) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
    }
    else {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Generate a short-lived signed URL (15 minutes)
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);

    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

    res.json({ url: signedUrl });
  } catch (error: any) {
    logger.error('Error serving file:', { message: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});



// =============================================================================
// Sidecar Proxy (moved to proxy.ts — admin-authenticated fetch forwarder)
// =============================================================================
export {sidecarProxy} from "./proxy.js";


// =============================================================================
// Daily Sidecar Backup (FIFO, max 30)
// =============================================================================

/**
 * Creates a daily backup of the sidecar workspace via the sidecar API.
 * Keeps a maximum of 30 backups (FIFO — oldest deleted first).
 * Runs daily at 2 AM PST.
 */
const BACKUP_BUCKET = 'YOUR_BACKUP_BUCKET';
const MAX_CLOUD_BACKUPS = 30;

export const dailySidecarBackup = onSchedule({
  schedule: '0 2 * * *',
  timeZone: 'America/Los_Angeles',
  secrets: [SIDECAR_URL_SECRET, SIDECAR_API_KEY_SECRET],
}, async () => {
  const sidecarUrl = sidecarUrlEnv();
  const sidecarKey = sidecarApiKeyEnv();

  if (!sidecarKey) {
    logger.warn('SIDECAR_API_KEY not set, skipping backup');
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${sidecarKey}`,
  };

  try {
    // 1. Create backup on VPS
    const createRes = await fetch(`${sidecarUrl}/backup/create`, {
      method: 'POST',
      headers,
    });

    if (!createRes.ok) {
      logger.error('Failed to create sidecar backup:', await createRes.text());
      return;
    }

    const created = await createRes.json() as { name: string; sizeMb: number };
    logger.info(`Backup created on VPS: ${created.name} (${created.sizeMb}MB)`);

    // 2. Download backup from VPS
    const downloadRes = await fetch(`${sidecarUrl}/backup/${encodeURIComponent(created.name)}/download`, {
      headers: { 'Authorization': `Bearer ${sidecarKey}` },
    });

    if (!downloadRes.ok) {
      logger.error('Failed to download backup from VPS');
      return;
    }

    const backupData = Buffer.from(await downloadRes.arrayBuffer());

    // 3. Upload to Cloud Storage
    const bucket = admin.storage().bucket(BACKUP_BUCKET);
    const cloudFile = bucket.file(`openclaw/${created.name}`);
    await cloudFile.save(backupData, {
      contentType: 'application/gzip',
      metadata: {
        customMetadata: {
          sizeMb: String(created.sizeMb),
          source: 'daily-backup',
        },
      },
    });

    logger.info(`Backup uploaded to gs://${BACKUP_BUCKET}/openclaw/${created.name}`);

    // 4. Delete backup from VPS (cloud is the source of truth)
    await fetch(`${sidecarUrl}/backup/${encodeURIComponent(created.name)}`, {
      method: 'DELETE',
      headers,
    });
    logger.info('Backup removed from VPS');

    // 5. FIFO: trim cloud backups to MAX_CLOUD_BACKUPS
    const [files] = await bucket.getFiles({ prefix: 'openclaw/' });
    if (files.length > MAX_CLOUD_BACKUPS) {
      // Sort by creation time ascending (oldest first)
      files.sort((a, b) => {
        const aTime = new Date(a.metadata.timeCreated || 0).getTime();
        const bTime = new Date(b.metadata.timeCreated || 0).getTime();
        return aTime - bTime;
      });

      const toDelete = files.slice(0, files.length - MAX_CLOUD_BACKUPS);
      for (const file of toDelete) {
        await file.delete();
        logger.info(`Deleted old cloud backup: ${file.name}`);
      }
    }

    logger.info(`Daily backup complete. Cloud backups: ${Math.min(files.length, MAX_CLOUD_BACKUPS)}`);
  } catch (error: any) {
    logger.error('Daily sidecar backup failed:', { message: error.message });
  }
});


// =============================================================================
// Agent Chat Cleanup (trim to 500 messages at midnight)
// =============================================================================

/**
 * Trims agent-chat collection to the most recent 500 messages.
 * Runs daily at midnight PST.
 */
export const trimAgentChat = onSchedule({
  schedule: '0 0 * * *',
  timeZone: 'America/Los_Angeles',
}, async () => {
  try {
    const MAX_MESSAGES = 500;

    // Count total messages
    const countSnapshot = await db.collection('agent-chat')
      .orderBy('createdAt', 'desc')
      .get();

    const total = countSnapshot.size;
    if (total <= MAX_MESSAGES) {
      logger.info(`Agent chat has ${total} messages, under ${MAX_MESSAGES} limit`);
      return;
    }

    // Get docs beyond the limit (oldest ones to delete)
    const toDelete = countSnapshot.docs.slice(MAX_MESSAGES);
    
    // Batch delete in groups of 500 (Firestore limit)
    let deleted = 0;
    for (let i = 0; i < toDelete.length; i += 400) {
      const batch = db.batch();
      const chunk = toDelete.slice(i, i + 400);
      chunk.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      deleted += chunk.length;
    }

    logger.info(`Trimmed ${deleted} old agent chat messages (${total} → ${total - deleted})`);
  } catch (error: any) {
    logger.error('Error trimming agent chat:', { message: error.message });
  }
});


// Appointment reminder cron jobs moved to ./reminders.ts
// (calendarReminderScheduler, morningReminderScheduler)


// =============================================================================
// Google Workspace OAuth Integration
// =============================================================================

import {SignJWT, jwtVerify} from "jose";
import {encrypt} from "./encryption.js";
import {
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  resolveAccessToken,
  detectServices,
  verifyCalendarAccess,
  loadIntegration,
  allScopesForServices,
  getServiceAccountAccessToken,
  type GoogleService,
  type GoogleWorkspaceIntegration,
} from "./google-workspace.js";
import {
  setGoogleServiceAccountKey,
  deleteGoogleServiceAccountKey,
} from "./lib/secret-manager.js";
import {
  listInboxMessages,
  getFullMessage,
  sendEmail,
  replyToEmail,
} from "./gmail-workspace.js";
import {
  listEvents as wsListEvents,
  getEvent as wsGetEvent,
  createEvent as wsCreateEvent,
  updateEvent as wsUpdateEvent,
  deleteEvent as wsDeleteEvent,
} from "./google-calendar-workspace.js";
import {
  listFiles,
  getFile,
  getFileContent,
  createFile,
} from "./google-drive-workspace.js";

/**
 * googleWorkspaceAuthorize — Admin-only callable.
 * Starts the OAuth handshake (mode B). Refuses if a service-account
 * integration is already active — the admin must explicitly disconnect
 * first so the two modes remain mutually exclusive.
 *
 * `calendarId` is required: we don't want to mint tokens only to discover
 * later that the admin forgot to say which calendar to use. `services` is
 * the set of Google surfaces the agent should be granted — at minimum
 * Calendar must be present (reminders depend on it).
 */
export const googleWorkspaceAuthorize = onCall({}, async (request) => {
  const authContext = await requireAdmin(request);

  const services = ((request.data?.services as string) || 'gmail,calendar,drive')
    .split(',').filter(Boolean) as GoogleService[];
  const calendarId = (request.data?.calendarId as string || '').trim();
  const returnUrl = (request.data?.returnUrl as string) || null;

  if (!calendarId) throw new Error('calendarId is required');
  if (!services.includes('calendar')) {
    throw new Error('Calendar must be among the enabled services');
  }

  // Enforce mode exclusivity — refuse if a service-account integration
  // is already active. Disconnect-then-reconnect is the intended flow.
  const existing = await db.collection('integrations').doc('google-workspace').get();
  if (existing.exists && existing.data()?.authMode === 'service-account') {
    throw new Error('A service-account integration is already active. Disconnect it first.');
  }

  const encKey = process.env.GOOGLE_WORKSPACE_ENCRYPTION_KEY;
  if (!encKey) throw new Error('GOOGLE_WORKSPACE_ENCRYPTION_KEY not configured');
  const secret = new TextEncoder().encode(encKey);

  const state = await new SignJWT({
    userId: authContext.uid,
    services,
    calendarId,
    ...(returnUrl ? {returnUrl} : {}),
  })
    .setProtectedHeader({alg: 'HS256'})
    .setExpirationTime('10m')
    .sign(secret);

  const authUrl = getGoogleAuthUrl(state, services);
  return {url: authUrl};
});

/**
 * googleWorkspaceCallback — Public HTTPS endpoint (Google redirects here).
 * Validates the state JWT, exchanges the auth code for tokens, encrypts the
 * refresh token, and stores everything in Firestore integrations/google-workspace.
 * Then redirects the browser back to the admin UI.
 */
export const googleWorkspaceCallback = onRequest({
  cors: true,
}, async (req, res) => {
  // Redirect target: the configured portal URL in prod, local Vite in dev.
  const frontendUrl = isProduction()
    ? FUNCTIONS_BRANDING.portalUrl
    : 'http://localhost:3001';
  const redirectBase = `${frontendUrl}/admin/agent`;

  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const oauthError = req.query.error as string | undefined;

  if (oauthError) {
    res.redirect(`${redirectBase}?tab=integrations&gws_error=${encodeURIComponent(oauthError)}`);
    return;
  }

  if (!code || !state) {
    res.redirect(`${redirectBase}?tab=integrations&gws_error=missing_params`);
    return;
  }

  // Verify state JWT
  let userId: string;
  let requestedServices: GoogleService[];
  let calendarId: string;
  let returnUrl: string | null = null;
  try {
    const encKey = process.env.GOOGLE_WORKSPACE_ENCRYPTION_KEY;
    if (!encKey) throw new Error('Encryption key not configured');
    const secret = new TextEncoder().encode(encKey);
    const {payload} = await jwtVerify(state, secret);
    userId = payload.userId as string;
    requestedServices = (payload.services as GoogleService[]) || ['gmail'];
    calendarId = (payload.calendarId as string) || '';
    returnUrl = (payload.returnUrl as string) || null;
    if (!userId || !calendarId) throw new Error('Invalid state');
  } catch {
    res.redirect(`${redirectBase}?tab=integrations&gws_error=invalid_state`);
    return;
  }

  const finalRedirect = returnUrl ? `${frontendUrl}${returnUrl}` : redirectBase;

  try {
    const tokens = await exchangeCodeForTokens(code);

    // Determine which services were actually granted
    const grantedServices = detectServices(tokens.grantedScopes);
    const services = requestedServices.filter((s) => grantedServices.includes(s));
    if (services.length === 0) services.push(...grantedServices);

    // Verify the authorizing user can actually read the chosen calendar.
    // If not, the integration would look healthy but every reminder + agent
    // call would fail at runtime — better to refuse to save.
    try {
      await verifyCalendarAccess(tokens.accessToken, calendarId);
    } catch (err: any) {
      logger.warn('[google-workspace] Calendar access check failed:', err.message);
      res.redirect(
        `${finalRedirect}?tab=integrations&gws_error=${encodeURIComponent('calendar_not_shared')}`
      );
      return;
    }

    const encryptedCredentials = encrypt(
      JSON.stringify({refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt})
    );

    await db.collection('integrations').doc('google-workspace').set({
      provider: 'google-workspace',
      status: 'active',
      authMode: 'oauth',
      email: tokens.email,
      calendarId,
      refreshTokenCipher: encryptedCredentials,
      enabledServices: services,
      grantedScopes: tokens.grantedScopes,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      connectedBy: userId,
    });

    const params = new URLSearchParams({
      tab: 'integrations',
      gws_status: 'connected',
      gws_email: tokens.email,
      gws_services: services.join(','),
    });
    res.redirect(`${finalRedirect}?${params}`);
  } catch (error: any) {
    logger.error('[google-workspace] OAuth callback error:', error.message);
    res.redirect(
      `${finalRedirect}?tab=integrations&gws_error=${encodeURIComponent('Failed to connect Google Workspace')}`
    );
  }
});

/**
 * saveGoogleWorkspaceServiceAccount — Admin-only callable (mode A setup).
 *
 * Validates the uploaded service-account JSON key, tests that it can
 * impersonate the given subject and read the chosen calendar, then stores
 * the key in Secret Manager and the non-secret metadata on the
 * integration doc. Refuses if an OAuth integration is already active —
 * the two modes are mutually exclusive.
 */
export const saveGoogleWorkspaceServiceAccount = onCall({}, async (request) => {
  const authContext = await requireAdmin(request);

  const saKeyJson = (request.data?.saKeyJson as string) || '';
  const subject = ((request.data?.subject as string) || '').trim();
  const calendarId = ((request.data?.calendarId as string) || '').trim();
  const servicesIn = (request.data?.services as string[]) || ['gmail', 'calendar', 'drive'];

  if (!saKeyJson) throw new Error('Service-account JSON key is required');
  if (!subject) throw new Error('Subject email is required');
  if (!calendarId) throw new Error('calendarId is required');

  // Sanity-parse the key so we don't write garbage into Secret Manager.
  let saClientEmail: string;
  try {
    const key = JSON.parse(saKeyJson) as {client_email?: string; private_key?: string; type?: string};
    if (!key.client_email || !key.private_key) {
      throw new Error('Key is missing client_email or private_key');
    }
    if (key.type && key.type !== 'service_account') {
      throw new Error(`Key type must be 'service_account', got '${key.type}'`);
    }
    saClientEmail = key.client_email;
  } catch (err: any) {
    throw new Error(`Invalid service-account JSON: ${err.message}`);
  }

  // Enforce mode exclusivity
  const existing = await db.collection('integrations').doc('google-workspace').get();
  if (existing.exists && existing.data()?.authMode === 'oauth') {
    throw new Error('An OAuth integration is already active. Disconnect it first.');
  }

  const services = servicesIn as GoogleService[];
  if (!services.includes('calendar')) {
    throw new Error('Calendar must be among the enabled services');
  }

  // Stash the key FIRST so the access-token mint can find it. We'll roll
  // it back if the access check fails so no half-saved state lingers.
  await setGoogleServiceAccountKey(saKeyJson);

  try {
    const accessToken = await getServiceAccountAccessToken(subject, allScopesForServices(services));
    await verifyCalendarAccess(accessToken, calendarId);
  } catch (err: any) {
    await deleteGoogleServiceAccountKey().catch(() => {});
    throw new Error(`Service-account setup failed: ${err.message}`);
  }

  const doc: GoogleWorkspaceIntegration & Record<string, unknown> = {
    provider: 'google-workspace',
    status: 'active',
    authMode: 'service-account',
    saClientEmail,
    subject,
    calendarId,
    enabledServices: services,
    grantedScopes: allScopesForServices(services),
    connectedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    connectedBy: authContext.uid,
  };
  await db.collection('integrations').doc('google-workspace').set(doc);

  return {success: true, email: subject, services};
});

/**
 * disconnectGoogleWorkspace — Admin-only callable. Removes the integration
 * doc and, for service-account mode, deletes the Secret Manager secret so
 * a re-connect starts clean. OAuth mode stores the refresh-token cipher
 * in-doc, which goes away with the doc deletion.
 */
export const disconnectGoogleWorkspace = onCall({}, async (request) => {
  await requireAdmin(request);

  const ref = db.collection('integrations').doc('google-workspace');
  const snap = await ref.get();
  const mode = snap.exists ? (snap.data()?.authMode as string | undefined) : undefined;

  if (mode === 'service-account') {
    await deleteGoogleServiceAccountKey();
  }
  await ref.delete();
  return {success: true};
});

/**
 * googleWorkspaceProxy — API-key-authenticated HTTPS endpoint.
 * Called by the OpenClaw agent via curl. Routes to Gmail, Calendar, or Drive
 * handlers based on the {service, action} in the request body.
 */
export const googleWorkspaceProxy = onRequest({
  cors: true,
  timeoutSeconds: 60,
}, async (req, res) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    const expectedKey = process.env.GOOGLE_WORKSPACE_API_KEY;
    if (!apiKey || !expectedKey || apiKey !== expectedKey) {
      res.status(401).json({error: 'Missing or invalid X-Api-Key'});
      return;
    }

    // Resolve a bearer token via whichever auth mode is active
    // (service-account DWD or OAuth). `identity` is the email the token
    // operates as — used as the From: header on sendEmail/reply.
    const integration = await loadIntegration();
    if (!integration || integration.status !== 'active') {
      res.status(404).json({error: 'Google Workspace not connected'});
      return;
    }
    let accessToken: string;
    let identity: string;
    try {
      const resolved = await resolveAccessToken(integration);
      accessToken = resolved.accessToken;
      identity = resolved.identity;
    } catch (err: any) {
      logger.error('[gws-proxy] token resolution failed:', err.message);
      res.status(401).json({error: 'Google token not available — reconnect Google Workspace'});
      return;
    }

    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = req.body as Record<string, unknown>;
      if (!body || typeof body !== 'object') throw new Error('Invalid body');
    } catch {
      res.status(400).json({error: 'Invalid JSON body'});
      return;
    }

    const service = body.service as string;
    const action = body.action as string;

    // For calendar actions, default the calendarId to the one on the
    // integration doc. The agent can override per-request if it needs to
    // touch a different calendar (e.g. listing a shared room's schedule).
    const integrationCalendarId = integration.calendarId;

    switch (service) {
    case 'gmail':
      res.json(await handleGmailAction(accessToken, action, body, identity));
      break;
    case 'calendar':
      res.json(await handleCalendarAction(accessToken, action, body, integrationCalendarId));
      break;
    case 'drive':
      res.json(await handleDriveAction(accessToken, action, body));
      break;
    default:
      res.status(400).json({error: 'Invalid service. Use: gmail, calendar, drive'});
    }
  } catch (error: any) {
    logger.error('[gws-proxy] error:', error.message);
    res.status(500).json({error: error.message});
  }
});

async function handleGmailAction(
  accessToken: string,
  action: string,
  body: Record<string, unknown>,
  email: string,
) {
  switch (action) {
  case 'inbox': {
    const maxResults = Math.min((body.maxResults as number) ?? 10, 20);
    return {emails: await listInboxMessages(accessToken, maxResults)};
  }
  case 'read': {
    const messageId = body.messageId as string;
    if (!messageId) throw new Error('messageId required');
    const msg = await getFullMessage(accessToken, messageId);
    if (!msg) throw new Error('Message not found');
    return {email: msg};
  }
  case 'send': {
    const {to, subject, body: emailBody} = body as {
      to: string; subject: string; body: string;
    };
    if (!to || !subject || !emailBody) throw new Error('to, subject, and body required');
    return await sendEmail(accessToken, to, subject, emailBody, email);
  }
  case 'reply': {
    const {messageId, body: replyBody} = body as {messageId: string; body: string};
    if (!messageId || !replyBody) throw new Error('messageId and body required');
    return await replyToEmail(accessToken, messageId, replyBody, email);
  }
  default:
    throw new Error('Invalid Gmail action. Use: inbox, read, send, reply');
  }
}

async function handleCalendarAction(
  accessToken: string,
  action: string,
  body: Record<string, unknown>,
  defaultCalendarId: string,
) {
  const calendarId = (body.calendarId as string) || defaultCalendarId;
  switch (action) {
  case 'list': {
    const timeMin = (body.timeMin as string) || new Date().toISOString();
    const timeMax = (body.timeMax as string) || new Date(Date.now() + 7 * 86400000).toISOString();
    const maxResults = Math.min((body.maxResults as number) ?? 50, 100);
    return {events: await wsListEvents(accessToken, timeMin, timeMax, calendarId, maxResults)};
  }
  case 'get': {
    const eventId = body.eventId as string;
    if (!eventId) throw new Error('eventId required');
    const event = await wsGetEvent(accessToken, eventId, calendarId);
    if (!event) throw new Error('Event not found');
    return {event};
  }
  case 'create': {
    const event = body.event as Record<string, unknown>;
    if (!event) throw new Error('event object required');
    return {event: await wsCreateEvent(accessToken, event as Parameters<typeof wsCreateEvent>[1], calendarId)};
  }
  case 'update': {
    const eventId = body.eventId as string;
    const updates = body.updates as Record<string, unknown>;
    if (!eventId || !updates) throw new Error('eventId and updates required');
    return {event: await wsUpdateEvent(accessToken, eventId, updates, calendarId)};
  }
  case 'delete': {
    const eventId = body.eventId as string;
    if (!eventId) throw new Error('eventId required');
    await wsDeleteEvent(accessToken, eventId, calendarId);
    return {ok: true};
  }
  default:
    throw new Error('Invalid Calendar action. Use: list, get, create, update, delete');
  }
}

async function handleDriveAction(
  accessToken: string,
  action: string,
  body: Record<string, unknown>,
) {
  switch (action) {
  case 'list': {
    const query = body.query as string | undefined;
    const maxResults = Math.min((body.maxResults as number) ?? 20, 50);
    return {files: await listFiles(accessToken, query, maxResults)};
  }
  case 'get': {
    const fileId = body.fileId as string;
    if (!fileId) throw new Error('fileId required');
    const file = await getFile(accessToken, fileId);
    if (!file) throw new Error('File not found');
    return {file};
  }
  case 'read': {
    const fileId = body.fileId as string;
    if (!fileId) throw new Error('fileId required');
    const file = await getFile(accessToken, fileId);
    const content = await getFileContent(accessToken, fileId);
    return {file, content};
  }
  case 'create': {
    const {name, content, mimeType, folderId} = body as {
      name: string; content: string; mimeType?: string; folderId?: string;
    };
    if (!name || !content) throw new Error('name and content required');
    return {file: await createFile(accessToken, name, content, mimeType, folderId)};
  }
  default:
    throw new Error('Invalid Drive action. Use: list, get, read, create');
  }
}

// ── FCM Push Notifications ──────────────────────────────────────────
// Send a push notification when a patient-targeted notification is created
export const onNotificationCreated = onDocumentCreated({
  document: "notifications/{notificationId}",
}, async (event) => {
  const data = event.data?.data();
  if (!data) return;

  // Only push to patient-role notifications with a specific recipient
  if (data.recipientRole !== "patient" || !data.recipientId) return;

  const userDoc = await db.collection("users").doc(data.recipientId).get();
  const fcmToken = userDoc.data()?.fcmToken;
  if (!fcmToken) {
    logger.info(`No FCM token for user ${data.recipientId}, skipping push`);
    return;
  }

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: data.title ?? FUNCTIONS_BRANDING.shortName,
        body: data.message ?? "",
      },
      data: {
        type: data.type ?? "system",
        notificationId: event.params.notificationId,
        ...(data.meta?.threadId ? {threadId: data.meta.threadId} : {}),
      },
      android: {
        notification: {
          channelId: "patient_portal_default",
        },
        priority: "high" as const,
      },
      apns: {
        payload: {aps: {sound: "default", badge: 1}},
      },
    });
    logger.info(`Push sent to ${data.recipientId} for ${data.type}`);
  } catch (err: unknown) {
    const error = err as {code?: string};
    // Clean up invalid tokens
    if (error.code === "messaging/registration-token-not-registered" ||
        error.code === "messaging/invalid-registration-token") {
      await db.collection("users").doc(data.recipientId).update({
        fcmToken: admin.firestore.FieldValue.delete(),
      });
      logger.info(`Removed stale FCM token for ${data.recipientId}`);
    } else {
      logger.error("FCM send failed:", err);
    }
  }
});

// ── Refill status email ─────────────────────────────────────────────
// Email the patient when an admin flips a refill request to approved or
// denied. Transitions to completed/cancelled don't notify — admins
// already tell the patient out-of-band for those.
export const onRefillStatusChanged = onDocumentWritten({
  document: "prescription-refills/{refillId}",
}, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;

  const newStatus = after.status;
  if (newStatus !== "approved" && newStatus !== "denied") return;
  if (before.status === newStatus) return;

  const patientDoc = await db.collection("users").doc(after.patientId).get();
  const patient = patientDoc.data();
  const email = patient?.email;
  if (!email) return;

  const patientName = [patient?.firstName, patient?.lastName]
    .filter(Boolean).join(" ") || "Patient";
  const template = refillStatusEmail(
    patientName,
    after.medicationName || "your prescription",
    newStatus,
    after.doctorNotes || after.notes,
  );
  await sendTransactionalEmail({to: email, ...template});
});

// ─── DrChrono integration ───────────────────────────────────────────
export {
  drchronoSaveCredentials,
  drchronoAuthorize,
  drchronoCallback,
  drchronoSetEnabled,
  drchronoDisconnect,
} from "./drchrono.js";

// ─── Athenahealth integration ───────────────────────────────────────
export {
  athenaSaveCredentials,
  athenaAuthorize,
  athenaCallback,
  athenaSetEnabled,
  athenaDisconnect,
} from "./athena.js";

// ─── Elation Health integration ─────────────────────────────────────
export {
  elationSaveCredentials,
  elationAuthorize,
  elationCallback,
  elationSetEnabled,
  elationDisconnect,
} from "./elation.js";

// ─── eClinicalWorks (SMART-on-FHIR) integration ─────────────────────
export {
  ecwSaveCredentials,
  ecwAuthorize,
  ecwCallback,
  ecwSetEnabled,
  ecwDisconnect,
} from "./ecw.js";

// ─── NextGen Healthcare integration ─────────────────────────────────
export {
  nextgenSaveCredentials,
  nextgenAuthorize,
  nextgenCallback,
  nextgenSetEnabled,
  nextgenDisconnect,
} from "./nextgen.js";

// ─── Tebra (Kareo) integration ──────────────────────────────────────
export {
  tebraSaveCredentials,
  tebraAuthorize,
  tebraCallback,
  tebraSetEnabled,
  tebraDisconnect,
} from "./tebra.js";

// ─── Greenway Health integration ────────────────────────────────────
export {
  greenwaySaveCredentials,
  greenwayAuthorize,
  greenwayCallback,
  greenwaySetEnabled,
  greenwayDisconnect,
} from "./greenway.js";

// ─── Practice Fusion integration ────────────────────────────────────
export {
  pfusionSaveCredentials,
  pfusionAuthorize,
  pfusionCallback,
  pfusionSetEnabled,
  pfusionDisconnect,
} from "./pfusion.js";

// ─── Cerner / Oracle Health (SMART-on-FHIR) integration ─────────────
export {
  cernerSaveCredentials,
  cernerAuthorize,
  cernerCallback,
  cernerSetEnabled,
  cernerDisconnect,
} from "./cerner.js";

// ─── Epic (SMART-on-FHIR) integration ───────────────────────────────
export {
  epicSaveCredentials,
  epicAuthorize,
  epicCallback,
  epicSetEnabled,
  epicDisconnect,
} from "./epic.js";

// ─── Super-admin impersonation ───────────────────────────────────────
/**
 * impersonateUser — super-admin-only callable.
 * Returns a Firebase custom token for the target UID so the super admin
 * can sign in as that user in the browser.
 */
export const impersonateUser = onCall(async (request) => {
  const context = requireSuperAdmin(request);
  const {targetUid} = request.data as {targetUid?: string};
  if (!targetUid || typeof targetUid !== 'string') {
    throw new Error('targetUid is required');
  }
  const token = await admin.auth().createCustomToken(targetUid);
  logger.info('super admin impersonation', {
    superAdminUid: context.uid,
    targetUid,
  });
  return {token};
});


// ─── Prior Authorization subsystem ──────────────────────────────────
export {
  policyFetcherCron,
  triggerPolicyRefresh,
  createPriorAuth,
  updatePriorAuthStatus,
  submitPolicyReview,
  runChartGapCheck,
  onPriorAuthWrite,
  paFollowupCron,
  extractTopPayers,
  seedPaData,
} from "./pa/index.js";


// ─── SignalWire fax — inbound webhook, retry cron, actions, outbound ───
export {signalwireFaxWebhook} from "./signalwire-webhook.js";
export {retryFailedFaxes} from "./signalwire-fax-retry.js";
export {sendFaxEmail, reprocessFax, updateFaxDraft, markFaxJunk, attachFaxToDrChrono, detachFaxFromDrChrono, deleteFax, getFaxPdfUrl} from "./signalwire-fax-actions.js";
export {sendOutboundFax, signalwireFaxStatusWebhook, deleteOutboundFax} from "./signalwire-fax-send.js";
