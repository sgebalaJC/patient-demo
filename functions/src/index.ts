/**
 * Cloud Functions for Patient Portal
 * - Admin todo SMS reminders (Twilio)
 * - User management (Auth + Firestore)
 * - Google Calendar bidirectional sync
 * - Appointment availability checking
 * - Stripe subscription billing
 */

// Stripe subscription billing
export {
  createCheckoutSession,
  cancelSubscription,
  stripeWebhook,
} from "./stripe.js";

import {FUNCTIONS_BRANDING} from "./branding.js";
import {sendEmail as sendTransactionalEmail, appointmentConfirmedEmail, appointmentCancelledEmail, welcomeEmail} from "./email.js";
import {setGlobalOptions} from "firebase-functions/v2";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {onCall, onRequest} from "firebase-functions/v2/https";
import {onDocumentWritten, onDocumentCreated} from "firebase-functions/v2/firestore";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

// Pin all functions to us-west1 to match Firestore + Storage regions.
// Change this per-customer if using a different region.
setGlobalOptions({region: "us-west1"});

// Google Workspace service account JSON is passed via the GOOGLE_SA_KEY
// environment variable (set in functions/.env for local emulator or via
// `firebase functions:config:set` / runtime env for production). Switch to
// `defineSecret` + Secret Manager once you're ready to accept the
// per-secret-version monthly cost.

// Environment variables are automatically available in Firebase Functions
// No need to load from .env files since we use runtime detection

// Initialize Firebase Admin
admin.initializeApp();

// Initialize Firestore
const db = admin.firestore();

// Twilio client
const twilio = require("twilio");

// Simple environment detection for Firebase Functions
const isProduction = () => {
  const isEmulator = !!(process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR);
  const projectId = process.env.GCLOUD_PROJECT;

  // Production if: real project ID and not running in emulator
  return projectId === 'YOUR_FIREBASE_PROJECT' && !isEmulator;
};

// Configure CORS based on environment
const corsOptions = isProduction()
  ? ['https://patient.example.com']
  : ['http://localhost:3001', 'https://localhost:3001'];

// Field length limits — must match web/src/lib/validation.ts
const FIELD_LIMITS = {
  firstName: { min: 2, max: 100 },
  lastName: { min: 2, max: 100 },
  email: { max: 254 },
  phoneNumber: { max: 20 },
  password: { max: 128 },
  role: { max: 20 },
} as const;

const VALID_ROLES = ['patient', 'assistant', 'admin'] as const;

function validateStringField(value: unknown, fieldName: string, limits: { min?: number; max?: number }): string {
  if (typeof value !== 'string') throw new Error(`${fieldName} must be a string`);
  const trimmed = value.trim();
  if (limits.min && trimmed.length < limits.min) throw new Error(`${fieldName} must be at least ${limits.min} characters`);
  if (limits.max && trimmed.length > limits.max) throw new Error(`${fieldName} must be less than ${limits.max} characters`);
  return trimmed;
}

/**
 * Simple rate limiter using Firestore.
 * Tracks calls per uid per action within a time window.
 */
async function checkRateLimit(uid: string, action: string, maxCalls: number, windowMinutes: number): Promise<void> {
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const rateLimitRef = db.collection('rate-limits').doc(`${uid}_${action}`);

  const doc = await rateLimitRef.get();
  if (doc.exists) {
    const data = doc.data()!;
    const windowStart = data.windowStart?.toMillis?.() || data.windowStart || 0;
    const count = data.count || 0;

    if (now - windowStart < windowMs) {
      if (count >= maxCalls) {
        throw new Error(`Rate limit exceeded. Please wait before trying again.`);
      }
      await rateLimitRef.update({ count: count + 1 });
      return;
    }
  }

  // New window
  await rateLimitRef.set({
    windowStart: admin.firestore.Timestamp.fromMillis(now),
    count: 1,
  });
}

interface TodoItem {
    id: string;
    adminId: string;
    title: string;
    description?: string;
    scheduledDateTime: admin.firestore.Timestamp;
    isCompleted: boolean;
    isReminderSent: boolean;
    reminderSentAt?: admin.firestore.Timestamp;
    priority: 'low' | 'medium' | 'high';
    category?: string;
    createdAt: admin.firestore.Timestamp;
    updatedAt: admin.firestore.Timestamp;
    isActive: boolean;
}

interface AdminUser {
    id: string;
    phoneNumber?: string;
    displayName: string;
    role: string;
}

/**
 * Get pending todo reminders that need to be sent
 */
async function getPendingTodoReminders(): Promise<TodoItem[]> {
    try {
        const now = new Date();
        const roundedNow = new Date(now);
        roundedNow.setSeconds(0, 0);
        const thirtyMinutesAgo = new Date(roundedNow.getTime() - 30 * 60 * 1000);

        logger.info(`Checking for todos scheduled between ${thirtyMinutesAgo.toISOString()} and ${now.toISOString()}`);

        const todosRef = db.collection('admin-todos');
        const snapshot = await todosRef
            .where('isActive', '==', true)
            .where('isCompleted', '==', false)
            .where('isReminderSent', '==', false)
            .where('enableSmsReminder', '==', true)
            .where('scheduledDateTime', '<=', admin.firestore.Timestamp.fromDate(roundedNow))
            .where('scheduledDateTime', '>', admin.firestore.Timestamp.fromDate(thirtyMinutesAgo))
            .get();

        const todos: TodoItem[] = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            todos.push({ 
                ...data,
                id: doc.id  // Override any existing id with the document id
            } as TodoItem);
        });

        logger.info(`Found ${todos.length} pending todo reminders`);
        return todos;
    } catch (error) {
        logger.error("Error fetching pending todo reminders:", error);
        return [];
    }
}

/**
 * Get all admin users information including phone numbers
 */
async function getAdminUsers(): Promise<AdminUser[]> {
    try {
        const usersSnapshot = await db.collection('users')
            .where('role', '==', 'admin')
            .where('isActive', '==', true)
            .get();

        if (usersSnapshot.empty) {
            logger.warn('No active admin users found');
            return [];
        }

        const adminUsers: AdminUser[] = [];

        usersSnapshot.forEach(doc => {
            const userData = doc.data() as AdminUser;

            // Only include admins with phone numbers for SMS
            if (userData.phoneNumber && userData.phoneNumber.trim()) {
                adminUsers.push({
                    ...userData,
                    id: doc.id  // Override any existing id with the document id
                });
            } else {
                logger.warn(`Admin user ${doc.id} (${userData.displayName}) has no phone number set`);
            }
        });

        logger.info(`Found ${adminUsers.length} admin users with phone numbers out of ${usersSnapshot.size} total admins`);
        return adminUsers;
    } catch (error) {
        logger.error('Error fetching admin users:', error);
        return [];
    }
}

/**
 * Format phone number for SMS (ensure +1 prefix for US numbers)
 */
function formatPhoneNumber(phoneNumber: string): string {
    // Remove all non-digits
    const digits = phoneNumber.replace(/\D/g, '');

    // If it's 10 digits, assume US and add +1
    if (digits.length === 10) {
        return `+1${digits}`;
    }

    // If it's 11 digits and starts with 1, add +
    if (digits.length === 11 && digits.startsWith('1')) {
        return `+${digits}`;
    }

    // If it already starts with +, return as is
    if (phoneNumber.startsWith('+')) {
        return phoneNumber;
    }

    // Default: add + prefix
    return `+${digits}`;
}

/**
 * Send SMS reminder using Twilio
 */
async function sendTodoSMSReminder(phoneNumber: string, todoTitle: string, todoDescription: string, priority: string) {
    try {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;

        if (!accountSid || !authToken || !fromNumber) {
            logger.error("Twilio credentials not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER");
            return false;
        }

        const client = twilio(accountSid, authToken);
        const formattedPhone = formatPhoneNumber(phoneNumber);

        // Create reminder message
        const priorityEmoji = priority === 'high' ? '🔥' : priority === 'medium' ? '⚠️' : 'ℹ️';
        let message = `${priorityEmoji} Todo Reminder: ${todoTitle}`;

        if (todoDescription && todoDescription.trim()) {
            message += `\n\n${todoDescription}`;
        }

        message += `\n\n- ${FUNCTIONS_BRANDING.adminSignatureName}`;

        await client.messages.create({
            body: message,
            from: fromNumber,
            to: formattedPhone,
        });

        logger.info(`SMS sent successfully to ${formattedPhone} for todo: ${todoTitle}`);
        return true;
    } catch (error: any) {
        logger.error(`Error sending SMS to ${phoneNumber}:`, {
            message: error.message,
            code: error.code,
            status: error.status
        });
        return false;
    }
}

/**
 * Mark todo reminder as sent
 */
async function markTodoReminderSent(todoId: string) {
    try {
        await db.collection('admin-todos').doc(todoId).update({
            isReminderSent: true,
            reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        logger.info(`Marked todo ${todoId} reminder as sent`);
    } catch (error) {
        logger.error(`Error marking todo ${todoId} reminder as sent:`, error);
    }
}

/**
 * Modified scheduler to send to all admins instead of todo owner
 */
export const todoReminderScheduler = onSchedule({
    schedule: "*/30 * * * *", // Every 30 minutes
    timeZone: process.env.TZ || "America/Los_Angeles",
}, async (event) => {
    logger.info("Todo reminder scheduler started");

    try {
        // Get pending todo reminders
        const pendingTodos = await getPendingTodoReminders();

        if (pendingTodos.length === 0) {
            logger.info("No pending todo reminders found");
            return;
        }

        // Get all admin users
        const adminUsers = await getAdminUsers();

        if (adminUsers.length === 0) {
            logger.warn("No admin users with phone numbers found - cannot send SMS reminders");
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        // Process each todo reminder
        for (const todo of pendingTodos) {
            logger.info(`Processing todo reminder: ${todo.title} - sending to ${adminUsers.length} admin(s)`);

            // Send SMS reminder to all admins
            for (const adminUser of adminUsers) {
                logger.info(`Sending reminder for "${todo.title}" to admin: ${adminUser.displayName} (${adminUser.phoneNumber})`);

                const smsSuccess = await sendTodoSMSReminder(
                    adminUser.phoneNumber!,
                    todo.title,
                    todo.description || '',
                    todo.priority
                );

                if (smsSuccess) {
                    successCount++;
                    logger.info(`Successfully sent reminder for todo: ${todo.title} to ${adminUser.displayName}`);
                } else {
                    errorCount++;
                    logger.error(`Failed to send reminder for todo: ${todo.title} to ${adminUser.displayName}`);
                }
            }

            // Mark reminder as sent regardless of SMS success/failure
            // This prevents the same todo from being processed again
            await markTodoReminderSent(todo.id);
        }

        logger.info(`Todo reminder scheduler completed: ${successCount} SMS sent successfully, ${errorCount} SMS failed across ${pendingTodos.length} todos to ${adminUsers.length} admin(s)`);
    } catch (error) {
        logger.error("Error in todo reminder scheduler:", error);
    }
});

/**
 * Update existing user with Firebase Auth
 */
export const updateUserAuth = onCall({
  cors: corsOptions
}, async (request) => {
  try {
    logger.info('updateUserAuth called');

    const context = request.auth;
    if (!context) {
      throw new Error('Authentication required');
    }

    // Rate limit: 20 updates per 10 minutes per admin
    await checkRateLimit(context.uid, 'updateUser', 20, 10);

    // Verify admin role
    const callerDoc = await db.collection('users').doc(context.uid).get();
    const callerData = callerDoc.data();
    if (!callerDoc.exists || callerData?.role !== 'admin' || callerData?.isActive === false) {
      throw new Error('Admin privileges required');
    }

    const { uid } = request.data;
    if (!uid || typeof uid !== 'string') {
      throw new Error('User UID is required for updates');
    }

    // Validate and sanitize optional fields
    const email = request.data.email
      ? validateStringField(request.data.email, 'email', { max: FIELD_LIMITS.email.max })
      : undefined;
    const firstName = request.data.firstName
      ? validateStringField(request.data.firstName, 'firstName', FIELD_LIMITS.firstName)
      : undefined;
    const lastName = request.data.lastName
      ? validateStringField(request.data.lastName, 'lastName', FIELD_LIMITS.lastName)
      : undefined;
    const role = request.data.role
      ? validateStringField(request.data.role, 'role', FIELD_LIMITS.role)
      : undefined;
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
    const context = request.auth;
    if (!context) {
      throw new Error('Authentication required');
    }

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
  cors: corsOptions
}, async (request) => {
  try {
    logger.info('createUserWithAuth called');

    const context = request.auth;
    if (!context) {
      throw new Error('Authentication required');
    }

    // Rate limit: 10 creates per 10 minutes per admin
    await checkRateLimit(context.uid, 'createUser', 10, 10);

    // Verify admin role
    const callerDoc = await db.collection('users').doc(context.uid).get();
    const callerData = callerDoc.data();
    if (!callerDoc.exists || callerData?.role !== 'admin' || callerData?.isActive === false) {
      throw new Error('Admin privileges required');
    }

    // Validate and sanitize input
    const email = validateStringField(request.data.email, 'email', { max: FIELD_LIMITS.email.max });
    const firstName = validateStringField(request.data.firstName, 'firstName', FIELD_LIMITS.firstName);
    const lastName = validateStringField(request.data.lastName, 'lastName', FIELD_LIMITS.lastName);
    const role = validateStringField(request.data.role, 'role', FIELD_LIMITS.role);
    const rawPhoneNumber = request.data.phoneNumber
      ? validateStringField(request.data.phoneNumber, 'phoneNumber', { max: FIELD_LIMITS.phoneNumber.max })
      : '';
    const sendWelcomeSms = request.data.sendWelcomeSms === true;

    if (!VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
      throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
    }

    // Normalize phone to the canonical +1XXXXXXXXXX format so later phone-OTP
    // sign-ins can match on users.where('phoneNumber', '==', ...).
    const phoneNumber = rawPhoneNumber ? formatPhoneNumber(rawPhoneNumber) : '';

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

    // Optional welcome SMS via Twilio (best-effort, non-fatal on failure)
    let smsSent = false;
    if (sendWelcomeSms && phoneNumber) {
      try {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;
        if (accountSid && authToken && fromNumber) {
          const client = twilio(accountSid, authToken);
          const formattedTo = phoneNumber.startsWith('+')
            ? phoneNumber
            : formatPhoneNumber(phoneNumber);
          await client.messages.create({
            body: `Welcome to ${FUNCTIONS_BRANDING.shortName}, ${firstName}! Check your email for a sign-in link to access your account.`,
            from: fromNumber,
            to: formattedTo,
          });
          smsSent = true;
        } else {
          logger.warn('Welcome SMS requested but Twilio not configured');
        }
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
  region: 'us-central1',
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
      email = validateStringField(data.email, 'email', { max: FIELD_LIMITS.email.max });
      firstName = validateStringField(data.firstName, 'firstName', FIELD_LIMITS.firstName);
      lastName = validateStringField(data.lastName, 'lastName', FIELD_LIMITS.lastName);
      phoneNumber = data.phoneNumber
        ? validateStringField(data.phoneNumber, 'phoneNumber', { max: FIELD_LIMITS.phoneNumber.max })
        : '';
    } catch (validationErr: any) {
      await writeError('VALIDATION_FAILED', validationErr.message || 'Invalid input');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await writeError('INVALID_EMAIL', 'Invalid email address');
      return;
    }

    // Normalize phone number to the canonical +1XXXXXXXXXX format so that
    // later phone-OTP sign-ins can match. formatPhoneNumber handles raw
    // digits, leading 1, already-formatted, etc.
    const normalizedPhone = phoneNumber ? formatPhoneNumber(phoneNumber) : '';

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
    const context = request.auth;
    if (!context) {
      throw new Error('Authentication required');
    }

    const { targetUserId } = request.data;
    const uidToDelete = targetUserId || context.uid;

    // Only allow self-deletion or admin-initiated deletion
    if (uidToDelete !== context.uid) {
      const callerDoc = await db.collection('users').doc(context.uid).get();
      if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
        throw new Error('You can only delete your own account');
      }
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
} from './google-calendar';

/**
 * Firestore trigger: sync appointment changes → Google Calendar
 * Runs on every appointment create/update/delete.
 */
export const onAppointmentWrite = onDocumentWritten({
  document: 'appointments/{appointmentId}',
}, async (event) => {
    const appointmentId = event.params.appointmentId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Skip if Calendar ID not configured
    if (!process.env.GOOGLE_CALENDAR_ID) {
      return;
    }

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
  if (!process.env.GOOGLE_CALENDAR_ID) {
    logger.info('GOOGLE_CALENDAR_ID not set, skipping Calendar sync');
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

    // Get busy times from Google Calendar
    let busySlots: { start: Date; end: Date }[] = [];
    if (process.env.GOOGLE_CALENDAR_ID) {
      busySlots = await getFreeBusySlots(date);
    }

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

    // Check Google Calendar FreeBusy
    if (process.env.GOOGLE_CALENDAR_ID) {
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
// Phone Verification (Twilio SMS)
// =============================================================================

/**
 * Send a 6-digit verification code to a phone number via Twilio SMS.
 * Stores hashed code in Firestore with 10-minute expiry.
 */
export const sendPhoneVerificationCode = onCall({
  cors: corsOptions,
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

    const formatted = formatPhoneNumber(phoneNumber);
    if (!/^\+1\d{10}$/.test(formatted)) {
      throw new Error('Please enter a valid US phone number');
    }

    // Generate 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();

    // Hash before storing (don't store plain codes)
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    // Store in Firestore with 10-minute expiry
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.collection('phone-verifications').doc(context.uid).set({
      phoneNumber: formatted,
      codeHash,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      attempts: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send SMS via Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      throw new Error('SMS service not configured');
    }

    const client = twilio(accountSid, authToken);
    await client.messages.create({
      body: `Your ${FUNCTIONS_BRANDING.shortName} verification code is: ${code}`,
      from: fromNumber,
      to: formatted,
    });

    logger.info('Verification code sent', { uid: context.uid });
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
    if (oldPhone !== newPhone && process.env.GOOGLE_CALENDAR_ID) {
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
}, async (request) => {
  try {
    const { phoneNumber } = request.data;
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new Error('Phone number is required');
    }

    const formatted = formatPhoneNumber(phoneNumber);
    if (!/^\+1\d{10}$/.test(formatted)) {
      throw new Error('Please enter a valid US phone number');
    }

    // Rate limit by phone number (5 per 10 min)
    await checkRateLimit(formatted, 'phoneLogin', 5, 10);

    // Generate 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    // Store in phone-login-codes with 5-minute expiry
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await db.collection('phone-login-codes').doc(formatted).set({
      phoneNumber: formatted,
      codeHash,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      attempts: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send SMS via Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      throw new Error('SMS service not configured');
    }

    const client = twilio(accountSid, authToken);
    await client.messages.create({
      body: `Your ${FUNCTIONS_BRANDING.shortName} login code is: ${code}`,
      from: fromNumber,
      to: formatted,
    });

    logger.info('Phone login code sent', { phone: formatted.slice(-4) });
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

    const formatted = formatPhoneNumber(phoneNumber);

    // Look up verification record
    const verificationRef = db.collection('phone-login-codes').doc(formatted);
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
      .where('phoneNumber', '==', formatted)
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      // Existing user — create custom token and return
      const userDoc = usersSnapshot.docs[0];
      const userData = userDoc.data();

      if (!userData.isActive) {
        return { success: false, error: 'Your account is inactive. Please contact the office.' };
      }

      // Update last login
      await userDoc.ref.update({
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const token = await admin.auth().createCustomToken(userDoc.id, { role: userData.role });

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

    // Create Firebase Auth user (phone only, no email)
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        phoneNumber: formatted,
        displayName: `${trimmedFirst} ${trimmedLast}`,
      });
    } catch (authError: any) {
      // Phone number might already be in Firebase Auth but not in our users collection
      if (authError.code === 'auth/phone-number-already-exists') {
        const existingAuth = await admin.auth().getUserByPhoneNumber(formatted);
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
      phoneNumber: formatted,
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
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) return;

    // Get patient phone number
    const patientDoc = await db.collection('users').doc(patientId).get();
    const patientData = patientDoc.data();
    const phone = patientData?.phoneNumber;
    if (!phone) return;

    const formatted = formatPhoneNumber(phone);
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

    const client = twilio(accountSid, authToken);
    await client.messages.create({
      body: message,
      from: fromNumber,
      to: formatted,
    });

    logger.info(`Appointment ${status} SMS sent to patient ${patientId}`);

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
// Sidecar Proxy (keeps API key server-side)
// =============================================================================

const SIDECAR_URL = process.env.SIDECAR_URL || 'http://YOUR_VPS_IP:8081';
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || '';

/**
 * HTTP proxy for the sidecar API. Admin-only.
 * Client sends: GET/POST/PUT/DELETE /sidecarProxy?path=/chat
 *   Authorization: Bearer <firebase-id-token>
 * Proxy forwards to sidecar with the server-side API key.
 */
export const sidecarProxy = onRequest({
  cors: corsOptions,
  timeoutSeconds: 120,
  memory: '512MiB',
}, async (req, res) => {
  try {
    // Verify Firebase auth
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    // Look up user — allow admin, assistant, and active patients
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    if (!userDoc.exists) {
      res.status(403).json({ error: 'User not found' });
      return;
    }

    const userData = userDoc.data()!;
    const userRole = userData.role as string;
    const isActive = userData.isActive !== false;

    if (!isActive) {
      res.status(403).json({ error: 'Account is inactive' });
      return;
    }

    // Patients can only access /chat and /healthz
    const sidecarPath = (req.query.path as string) || '/healthz';
    const patientAllowed = ['/chat', '/healthz'];
    if (userRole === 'patient' && !patientAllowed.includes(sidecarPath)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Special case: /slack/auth-test — handled locally, NOT forwarded to the
    // sidecar. Slack's Web API rejects browser preflight requests that carry
    // an Authorization header, so the browser cannot call auth.test directly.
    // We proxy it here (admin-only) where there is no CORS restriction.
    if (sidecarPath === '/slack/auth-test') {
      if (userRole !== 'admin') {
        res.status(403).json({ error: 'Admin access required' });
        return;
      }
      const botToken = (req.body as { botToken?: string })?.botToken;
      if (!botToken || typeof botToken !== 'string') {
        res.status(400).json({ error: 'botToken required' });
        return;
      }
      try {
        const slackRes = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: { Authorization: `Bearer ${botToken}` },
        });
        const data = (await slackRes.json()) as {
          ok: boolean;
          team?: string;
          team_id?: string;
          error?: string;
        };
        res.status(200).json(data);
      } catch (err: any) {
        logger.error('slack auth.test failed:', { message: err.message });
        res.status(502).json({ error: `Could not reach Slack: ${err.message}` });
      }
      return;
    }

    if (!SIDECAR_API_KEY) {
      res.status(503).json({ error: 'Sidecar not configured' });
      return;
    }

    const userName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Unknown';

    // Forward request to sidecar with user context headers
    const sidecarRes = await fetch(`${SIDECAR_URL}${sidecarPath}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SIDECAR_API_KEY}`,
        'X-User-Uid': decodedToken.uid,
        'X-User-Role': userRole,
        'X-User-Name': userName,
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    });

    const contentType = sidecarRes.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await sidecarRes.json();
      res.status(sidecarRes.status).json(data);
    } else {
      const text = await sidecarRes.text();
      res.status(sidecarRes.status).send(text);
    }
  } catch (error: any) {
    logger.error('Sidecar proxy error:', {
      message: error.message,
      code: error.code,
      cause: error.cause?.message,
      stack: error.stack?.slice(0, 200),
      sidecarUrl: SIDECAR_URL,
    });
    res.status(502).json({ error: `Sidecar unreachable: ${error.message}` });
  }
});


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
}, async () => {
  const sidecarUrl = process.env.SIDECAR_URL || 'http://YOUR_VPS_IP:8081';
  const sidecarKey = process.env.SIDECAR_API_KEY || '';

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


// =============================================================================
// Appointment Reminder Cron Jobs
// =============================================================================

/**
 * Extract phone number from Calendar event title.
 * Title format: "FirstName LastName 949-284-5733"
 */
function extractPhoneFromTitle(title: string): string | null {
  if (!title) return null;
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?([2-9][0-9]{2})\)?[-.\s]?([2-9][0-9]{2})[-.\s]?([0-9]{4})/;
  const match = title.match(phoneRegex);
  return match ? `+1${match[1]}${match[2]}${match[3]}` : null;
}

/**
 * Format event date/time like "Aug 8, 9:00 AM" in PST.
 */
function formatReminderTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Get Calendar client for read-only access (reminder cron).
 * Uses SA with domain-wide delegation (same as createCalendarEvent).
 */
async function getReminderCalendarClient() {
  const subject = process.env.GOOGLE_CALENDAR_SUBJECT;
  const saKeyJson = process.env.GOOGLE_SA_KEY;

  if (subject && saKeyJson) {
    try {
      const key = JSON.parse(saKeyJson);
      const { google } = await import('googleapis');
      const jwtClient = new google.auth.JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        subject,
      });
      await jwtClient.authorize();
      return google.calendar({ version: 'v3', auth: jwtClient });
    } catch (err: any) {
      logger.error('Reminder Calendar auth failed:', err.message);
    }
  }

  // Fallback: plain ADC
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  const authClient = await auth.getClient();
  return google.calendar({ version: 'v3', auth: authClient as any });
}

/**
 * Send an SMS via Twilio (for reminders).
 */
async function sendReminderSMS(phoneNumber: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return;

  try {
    const client = twilio(accountSid, authToken);
    await client.messages.create({ body, from: fromNumber, to: phoneNumber });
    logger.info(`Reminder SMS sent to ${phoneNumber}`);
  } catch (error: any) {
    logger.error(`Error sending reminder SMS to ${phoneNumber}:`, error.message);
  }
}

// Default SMS templates (used if Firestore doc not found)
const DEFAULT_SMS_TEMPLATES = {
  reminder24h: `This is an automated reminder from ${FUNCTIONS_BRANDING.shortName} of your appointment on: {content}\nScheduled for tomorrow at {time}. Don't forget!`,
  reminderMorning: `This is an automated reminder from ${FUNCTIONS_BRANDING.shortName} of your appointment on: {content}\nScheduled for today at {time}. Don't forget!`,
};

/**
 * Load SMS templates from Firestore, falling back to defaults.
 */
async function loadSmsTemplates(): Promise<typeof DEFAULT_SMS_TEMPLATES> {
  try {
    const doc = await db.collection('system').doc('sms-templates').get();
    if (doc.exists) {
      const data = doc.data();
      return {
        reminder24h: data?.reminder24h || DEFAULT_SMS_TEMPLATES.reminder24h,
        reminderMorning: data?.reminderMorning || DEFAULT_SMS_TEMPLATES.reminderMorning,
      };
    }
  } catch (err: any) {
    logger.warn('Failed to load SMS templates, using defaults:', err.message);
  }
  return { ...DEFAULT_SMS_TEMPLATES };
}

/**
 * Apply template by replacing {content} and {time} placeholders.
 */
function applyTemplate(template: string, content: string, time: string): string {
  return template.replace(/\{content\}/g, content).replace(/\{time\}/g, time);
}

/**
 * Appointment reminder — runs every 5 minutes.
 * Reads Google Calendar events starting ~24 hours from now,
 * sends an immediate 24-hour advance SMS, and queues an 8 AM same-day reminder.
 */
export const calendarReminderScheduler = onSchedule({
  schedule: '*/5 * * * *',
  timeZone: 'America/Los_Angeles',
}, async () => {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    logger.info('GOOGLE_CALENDAR_ID not set, skipping reminder scheduler');
    return;
  }

  try {
    const calendar = await getReminderCalendarClient();
    const templates = await loadSmsTemplates();

    // Window: events starting between 23h55m and 24h from now
    const now = new Date();
    now.setSeconds(0, 0);
    const exactlyOneDayAhead = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const windowStart = new Date(exactlyOneDayAhead.getTime() - 5 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId,
      timeMin: windowStart.toISOString(),
      timeMax: exactlyOneDayAhead.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (response.data.items || []).filter((ev: any) => {
      const start = new Date(ev.start?.dateTime || ev.start?.date);
      return start >= windowStart && start <= exactlyOneDayAhead;
    });

    logger.info(`Reminder cron: ${events.length} events in 24h window`);

    for (const ev of events) {
      const phone = extractPhoneFromTitle(ev.summary || '');
      if (!phone) continue;

      const startStr = ev.start?.dateTime || ev.start?.date || '';
      const formattedTime = formatReminderTime(startStr);
      const content = ev.description || 'your upcoming visit';

      // Send 24-hour advance SMS
      await sendReminderSMS(
        phone,
        applyTemplate(templates.reminder24h, content, formattedTime)
      );

      // Queue 8 AM same-day reminder
      const eventDate = new Date(startStr).toISOString().split('T')[0];
      const reminderDoc = db.collection('daily-reminders').doc(eventDate);

      await db.runTransaction(async (tx) => {
        const doc = await tx.get(reminderDoc);
        const msg = { phoneNumber: phone, content, formattedTime };
        if (doc.exists) {
          const data = doc.data();
          tx.update(reminderDoc, { messages: [...(data?.messages || []), msg] });
        } else {
          tx.set(reminderDoc, { date: eventDate, messages: [msg] });
        }
      });
    }

    logger.info('Reminder cron completed');
  } catch (error: any) {
    logger.error('Error in reminder cron:', error.message);
  }
});

/**
 * Morning reminder — runs daily at 8 AM PST.
 * Sends all queued same-day reminders and cleans up.
 */
export const morningReminderScheduler = onSchedule({
  schedule: '0 8 * * *',
  timeZone: 'America/Los_Angeles',
}, async () => {
  try {
    const pstDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    logger.info(`Morning reminders for ${pstDate}`);

    const reminderDoc = await db.collection('daily-reminders').doc(pstDate).get();
    if (!reminderDoc.exists) {
      logger.info(`No reminders for ${pstDate}`);
      return;
    }

    const data = reminderDoc.data();
    const messages: Array<{ phoneNumber: string; content: string; formattedTime: string }> =
      data?.messages || [];

    logger.info(`Sending ${messages.length} morning reminders`);

    const templates = await loadSmsTemplates();

    for (const msg of messages) {
      await sendReminderSMS(
        msg.phoneNumber,
        applyTemplate(templates.reminderMorning, msg.content, msg.formattedTime)
      );
    }

    // Clean up
    await db.collection('daily-reminders').doc(pstDate).delete();
    logger.info(`Morning reminders done, cleaned up ${pstDate}`);
  } catch (error: any) {
    logger.error('Error in morning reminder:', error.message);
  }
});


// =============================================================================
// Google Workspace OAuth Integration
// =============================================================================

import {SignJWT, jwtVerify} from "jose";
import {encrypt} from "./encryption.js";
import {
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  detectServices,
  type GoogleService,
} from "./google-workspace.js";
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
 * googleWorkspaceAuthorize — Admin-only callable function.
 * Returns a Google OAuth URL for the requested services.
 * Creates a signed JWT "state" param so the callback can validate the round-trip.
 */
export const googleWorkspaceAuthorize = onCall({}, async (request) => {
  // Admin-only
  if (!request.auth) throw new Error('Authentication required');
  const userDoc = await db.collection('users').doc(request.auth.uid).get();
  if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
    throw new Error('Admin access required');
  }

  const services = ((request.data?.services as string) || 'gmail')
    .split(',').filter(Boolean) as GoogleService[];
  const returnUrl = (request.data?.returnUrl as string) || null;

  // Create signed state JWT (10 min expiry)
  const encKey = process.env.GOOGLE_WORKSPACE_ENCRYPTION_KEY;
  if (!encKey) throw new Error('GOOGLE_WORKSPACE_ENCRYPTION_KEY not configured');
  const secret = new TextEncoder().encode(encKey);

  const state = await new SignJWT({
    userId: request.auth.uid,
    services,
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
  // Determine the frontend URL for redirects
  const frontendUrl = isProduction()
    ? 'https://patient.example.com'
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
  let returnUrl: string | null = null;
  try {
    const encKey = process.env.GOOGLE_WORKSPACE_ENCRYPTION_KEY;
    if (!encKey) throw new Error('Encryption key not configured');
    const secret = new TextEncoder().encode(encKey);
    const {payload} = await jwtVerify(state, secret);
    userId = payload.userId as string;
    requestedServices = (payload.services as GoogleService[]) || ['gmail'];
    returnUrl = (payload.returnUrl as string) || null;
    if (!userId) throw new Error('Invalid state');
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

    // Encrypt refresh token and store in Firestore
    const encryptedCredentials = encrypt(
      JSON.stringify({refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt})
    );

    await db.collection('integrations').doc('google-workspace').set({
      provider: 'google-workspace',
      status: 'active',
      email: tokens.email,
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

    // Read integration from Firestore
    const integrationDoc = await db.collection('integrations').doc('google-workspace').get();
    if (!integrationDoc.exists || integrationDoc.data()?.status !== 'active') {
      res.status(404).json({error: 'Google Workspace not connected'});
      return;
    }

    const integration = integrationDoc.data()!;

    // Refresh access token
    let accessToken: string;
    try {
      const result = await refreshAccessToken(integration.refreshTokenCipher);
      accessToken = result.accessToken;
    } catch {
      res.status(401).json({error: 'Google token expired — reconnect Google Workspace'});
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

    switch (service) {
    case 'gmail':
      res.json(await handleGmailAction(accessToken, action, body, integration.email));
      break;
    case 'calendar':
      res.json(await handleCalendarAction(accessToken, action, body));
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
) {
  const calendarId = (body.calendarId as string) || 'primary';
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

// ─── DrChrono integration ───────────────────────────────────────────
export {
  drchronoSaveCredentials,
  drchronoAuthorize,
  drchronoCallback,
  drchronoSetEnabled,
} from "./drchrono.js";

export {
  drchronoLookupStart,
  drchronoLookupKickoff,
  drchronoLookupContinue,
} from "./drchrono-lookup.js";
