import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { resetPassword } from '../../lib/firebase';
import { emailField } from '../../lib/validation';
import { BRANDING } from '../../config/branding';
import logger from '../../lib/logger';

const forgotPasswordSchema = z.object({
  email: emailField({ required: false }),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

interface ForgotPasswordFormProps {
  onBack: () => void;
}

export const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({
  onBack,
}) => {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string>('');

  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setLoading(true);
    setError('');

    try {
      await resetPassword(data.email);
      setSuccess(true);
    } catch (error: any) {
      logger.error('Password reset error:', error);
      setError(
        error.code === 'auth/user-not-found'
          ? 'No account found with this email address'
          : error.message || 'Failed to send reset email'
      );
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="space-y-6 text-center">
        <div className="flex justify-center">
          <CheckCircle className="h-16 w-16 text-green-500" />
        </div>

        <div>
          <h2 className="text-3xl font-bold text-secondary-900">Check your email</h2>
          <p className="mt-2 text-secondary-600">
            We've sent a password reset link to
          </p>
          <p className="font-medium text-secondary-900">{getValues('email')}</p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-amber-900 mb-1">Can't find the email?</h4>
          <p className="text-sm text-amber-700">
            Check your <strong>spam or junk folder</strong> — emails from <strong>{BRANDING.fromEmail}</strong> sometimes end up there.
          </p>
        </div>

        <div className="space-y-4">

          <Button
            variant="secondary"
            onClick={() => setSuccess(false)}
            className="w-full"
          >
            Try different email
          </Button>

          <button
            onClick={onBack}
            className="flex items-center justify-center w-full text-sm text-primary-600 hover:text-primary-500 font-medium"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={onBack}
          className="flex items-center text-sm text-primary-600 hover:text-primary-500 font-medium mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to sign in
        </button>

        <div className="text-center">
          <h2 className="text-3xl font-bold text-secondary-900">Reset your password</h2>
          <p className="mt-2 text-secondary-600">
            Enter your email address and we'll send you a link to reset your password
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <ErrorAlert message={error} />

        <div className="relative">
          <Mail className="absolute left-3 top-3 text-secondary-400 h-5 w-5" />
          <Input
            {...register('email')}
            type="email"
            placeholder="Enter your email address"
            className="pl-10"
            error={errors.email?.message}
          />
        </div>

        <Button type="submit" className="w-full" loading={loading}>
          Send reset link
        </Button>
      </form>

      <div className="text-center">
        <p className="text-sm text-secondary-600">
          Remember your password?{' '}
          <button
            onClick={onBack}
            className="text-primary-600 hover:text-primary-500 font-medium"
          >
            Sign in here
          </button>
        </p>
      </div>
    </div>
  );
};
