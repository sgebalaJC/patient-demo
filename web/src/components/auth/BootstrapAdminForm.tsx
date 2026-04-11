import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Shield, UserPlus, AlertTriangle } from 'lucide-react';
import { signInWithCustomToken } from 'firebase/auth';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ErrorAlert } from '../ui/ErrorAlert';
import { auth, firebaseService } from '../../lib/firebase';
import { FIELD_LIMITS } from '../../lib/validation';
import { BRANDING } from '../../config/branding';
import logger from '../../lib/logger';

const bootstrapSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email').max(FIELD_LIMITS.email.max),
  firstName: z.string().min(FIELD_LIMITS.firstName.min, `First name must be at least ${FIELD_LIMITS.firstName.min} characters`).max(FIELD_LIMITS.firstName.max),
  lastName: z.string().min(FIELD_LIMITS.lastName.min, `Last name must be at least ${FIELD_LIMITS.lastName.min} characters`).max(FIELD_LIMITS.lastName.max),
  phoneNumber: z.string().max(FIELD_LIMITS.phoneNumber.max).optional(),
});

type BootstrapFormData = z.infer<typeof bootstrapSchema>;

/**
 * First-run setup form. Rendered by `AuthPage` when `system/settings.bootstrapped`
 * is false. Creates the very first administrator and signs them in immediately
 * via a Firebase custom token (no email round-trip).
 *
 * The Cloud Function rejects if any active admin already exists, so this form
 * is safe to expose at /auth.
 */
export const BootstrapAdminForm: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BootstrapFormData>({
    resolver: zodResolver(bootstrapSchema),
  });

  const onSubmit = async (data: BootstrapFormData) => {
    setLoading(true);
    setError('');
    try {
      const result = await firebaseService.bootstrapFirstAdmin({
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phoneNumber: data.phoneNumber || undefined,
      });

      if (!result.success || !result.token) {
        setError(result.error || 'Failed to create administrator');
        return;
      }

      // Sign in immediately using the custom token from the function
      await signInWithCustomToken(auth, result.token);
      // AuthContext picks up the auth state change and routes to /admin
    } catch (err: any) {
      logger.error('Bootstrap error:', err);
      setError(err.message || 'An unexpected error occurred');
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
          <Input {...register('phoneNumber')} type="tel" placeholder="+1 (555) 123-4567" error={errors.phoneNumber?.message} />
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
