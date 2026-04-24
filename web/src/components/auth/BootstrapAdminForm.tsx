import React, { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Shield, UserPlus, AlertTriangle } from 'lucide-react';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, setDoc, onSnapshot, serverTimestamp, deleteDoc, Unsubscribe } from 'firebase/firestore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ErrorAlert } from '../ui/ErrorAlert';
import { auth, db } from '../../lib/firebase';
import { emailField, firstNameField, lastNameField, phoneField } from '../../lib/validation';
import { normalizePhoneNumber, InvalidPhoneError } from '../../lib/phone';
import { BRANDING } from '../../config/branding';
import logger from '../../lib/logger';

const bootstrapSchema = z.object({
  email: emailField(),
  firstName: firstNameField(),
  lastName: lastNameField(),
  phoneNumber: phoneField().optional(),
});

type BootstrapFormData = z.infer<typeof bootstrapSchema>;

/**
 * First-run setup form. Rendered by `AuthPage` when `system/settings.bootstrapped`
 * is false. Creates the very first administrator and signs them in immediately
 * via a Firebase custom token (no email round-trip).
 *
 * Uses a Firestore-trigger bootstrap flow (NOT an unauthenticated callable)
 * so it works under GCP orgs that block public Cloud Run invocation via the
 * `iam.allowedPolicyMemberDomains` org policy. Flow:
 *
 *   1. Write a request doc to `bootstrap-requests/{uuid}` with status 'pending'.
 *      Firestore rules only allow this when `system/settings.bootstrapped` is
 *      false.
 *   2. The `onBootstrapRequestCreated` Cloud Function fires (running as the
 *      function's service account, not as `allUsers`), processes the request,
 *      and writes the token back to the same doc with `status: 'ready'`.
 *   3. We `onSnapshot` the same doc and pick up the token, then sign in.
 *   4. Delete the request doc on success (best-effort cleanup).
 *
 * The doc ID is a 128-bit crypto-random UUID; Firestore rules deny `list`, so
 * an attacker cannot enumerate pending requests to steal tokens.
 */
const BOOTSTRAP_TIMEOUT_MS = 20_000;

const makeRequestId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: use getRandomValues for older browsers
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
};

interface BootstrapAdminFormProps {
  /**
   * Called the moment the user clicks submit, BEFORE any async work begins.
   * The parent uses this to latch a "bootstrap in flight" flag that keeps
   * this form mounted even after `system/settings.bootstrapped` flips to
   * true — without which the form would unmount mid-flow and the onSnapshot
   * listener would miss the token the trigger writes back.
   */
  onSubmitStart?: () => void;
}

export const BootstrapAdminForm: React.FC<BootstrapAdminFormProps> = ({ onSubmitStart }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useEffect(() => cleanup, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BootstrapFormData>({
    resolver: zodResolver(bootstrapSchema),
  });

  const onSubmit = async (data: BootstrapFormData) => {
    onSubmitStart?.();
    setLoading(true);
    setError('');
    cleanup();

    const requestId = makeRequestId();
    const requestRef = doc(db, 'bootstrap-requests', requestId);

    let normalizedPhone = '';
    try {
      normalizedPhone = normalizePhoneNumber(data.phoneNumber);
    } catch (err) {
      if (err instanceof InvalidPhoneError) {
        setError('Please enter a valid 10-digit US phone number, or leave it blank.');
        setLoading(false);
        return;
      }
      throw err;
    }

    try {
      // Step 1: write the request doc. Firestore rules reject this if
      // `system/settings.bootstrapped` is already true.
      await setDoc(requestRef, {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phoneNumber: normalizedPhone,
        status: 'pending',
        createdAt: serverTimestamp(),
      });

      // Step 2: listen for the trigger's response
      const completed = new Promise<{ token?: string; error?: string }>((resolve) => {
        unsubscribeRef.current = onSnapshot(
          requestRef,
          (snap) => {
            const snapData = snap.data();
            if (!snapData) return;
            if (snapData.status === 'ready' && snapData.token) {
              resolve({ token: snapData.token });
            } else if (snapData.status === 'error') {
              resolve({ error: snapData.error || 'Failed to create administrator' });
            }
          },
          (err) => {
            logger.error('Bootstrap snapshot error:', err);
            resolve({ error: 'Unable to read bootstrap response' });
          },
        );

        timeoutRef.current = setTimeout(() => {
          resolve({ error: 'Timed out waiting for the server. Please try again.' });
        }, BOOTSTRAP_TIMEOUT_MS);
      });

      const result = await completed;
      cleanup();

      if (result.error || !result.token) {
        setError(result.error || 'Failed to create administrator');
        return;
      }

      // Step 3: sign in with the custom token written by the trigger
      await signInWithCustomToken(auth, result.token);

      // Step 4: best-effort cleanup of the request doc. Don't block sign-in on this.
      deleteDoc(requestRef).catch((delErr) => {
        logger.warn('Failed to delete bootstrap request doc:', delErr);
      });
      // AuthContext picks up the auth state change and routes to /admin
    } catch (err: any) {
      cleanup();
      logger.error('Bootstrap error:', err);
      if (err?.code === 'permission-denied') {
        setError('This system has already been set up. Please ask an administrator to invite you.');
      } else {
        setError(err?.message || 'An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-full bg-primary-100 mb-4">
          <Shield className="h-7 w-7 text-primary-600" />
        </div>
        <h2 className="text-2xl font-bold text-secondary-900">Welcome to {BRANDING.shortName}</h2>
        <p className="mt-2 text-secondary-600 text-sm">
          No administrator exists yet. Create the first one to set up your installation.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start space-x-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-medium mb-1">One-time setup</p>
          <p className="text-amber-700">
            This form disappears once the first administrator is created. After that, all new accounts must be created from the admin panel.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <ErrorAlert message={error} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-1">First name</label>
            <Input {...register('firstName')} error={errors.firstName?.message} />
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-1">Last name</label>
            <Input {...register('lastName')} error={errors.lastName?.message} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">Email address</label>
          <Input {...register('email')} type="email" error={errors.email?.message} />
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            Phone number <span className="text-secondary-400 font-normal">(optional)</span>
          </label>
          <Input {...register('phoneNumber')} type="tel" placeholder="(555) 123-4567" error={errors.phoneNumber?.message} />
        </div>

        <Button type="submit" className="w-full" loading={loading}>
          <UserPlus className="h-4 w-4 mr-2" />
          Create administrator & sign in
        </Button>

        <p className="text-xs text-center text-secondary-500">
          You'll be signed in automatically — no email confirmation needed.
        </p>
      </form>
    </div>
  );
};
