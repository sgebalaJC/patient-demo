import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Send, CheckCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { OAuthButtons } from './OAuthButtons';
import { sendLoginLink } from '../../lib/firebase';
import { BRANDING } from '../../config/branding';
import logger from '../../lib/logger';

const emailLinkSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
});

type EmailLinkFormData = z.infer<typeof emailLinkSchema>;

interface EmailLinkLoginFormProps {
  onSuccess: () => void;
  onSwitchToSignup: () => void;
  onSwitchToTraditional: () => void;
  onSwitchToPhone?: () => void;
}

export const EmailLinkLoginForm: React.FC<EmailLinkLoginFormProps> = ({
  onSuccess,
  onSwitchToSignup,
  onSwitchToTraditional,
  onSwitchToPhone,
}) => {
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [authError, setAuthError] = useState<string>('');

  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<EmailLinkFormData>({
    resolver: zodResolver(emailLinkSchema),
  });

  const onSubmit = async (data: EmailLinkFormData) => {
    setLoading(true);
    setAuthError('');

    try {
      await sendLoginLink(data.email);
      setEmailSent(true);
    } catch (error: any) {
      logger.error('Send login link error:', error);
      setAuthError(
        error.code === 'auth/invalid-email'
          ? 'Please enter a valid email address'
          : error.message || 'Failed to send login link'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleTryAgain = () => {
    setEmailSent(false);
    setAuthError('');
  };

  if (emailSent) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          <h2 className="text-3xl font-bold text-secondary-900">Check your email</h2>
          <p className="mt-2 text-secondary-600">
            We've sent a sign-in link to
          </p>
          <p className="font-medium text-secondary-900">{getValues('email')}</p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-amber-900 mb-1">Can't find the email?</h4>
          <p className="text-sm text-amber-700">
            Check your <strong>spam or junk folder</strong> — emails from <strong>noreply@example.com</strong> sometimes end up there.
          </p>
        </div>

        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-primary-900 mb-2">What's next?</h4>
          <ul className="text-sm text-primary-700 space-y-1">
            <li>• Click the "Sign in to {BRANDING.shortName}" link in the email</li>
            <li>• You'll be automatically signed in</li>
            <li>• The link expires in 1 hour for security</li>
          </ul>
        </div>

        <div className="space-y-3">
          <Button
            variant="secondary"
            onClick={handleTryAgain}
            className="w-full"
          >
            Try different email
          </Button>

          <div className="text-center">
            <span className="text-sm text-secondary-600">Don't have an account? </span>
            <button
              onClick={onSwitchToSignup}
              className="text-sm text-primary-600 hover:text-primary-500 font-medium"
            >
              Sign up here
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-secondary-900">Welcome back</h2>
        <p className="mt-2 text-secondary-600">
          Enter your email to receive a secure sign-in link
        </p>
      </div>

      <OAuthButtons onSuccess={onSuccess} />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-secondary-300" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-surface-card text-secondary-500">Or sign in with email</span>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <ErrorAlert message={authError} />

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
          <Send className="h-4 w-4 mr-2" />
          Send sign-in link
        </Button>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-green-900 mb-2">🔐 Passwordless & Secure</h4>
          <p className="text-sm text-green-700">
            No passwords to remember! We'll send you a secure link that signs you in automatically.
          </p>
        </div>

        <div className="text-center space-y-2">
          <p className="text-sm text-secondary-600">
            Don't have an account?{' '}
            <button
              onClick={onSwitchToSignup}
              className="text-primary-600 hover:text-primary-500 font-medium"
            >
              Sign up here
            </button>
          </p>

          <p className="text-sm text-secondary-600">
            Prefer a password?{' '}
            <button
              onClick={onSwitchToTraditional}
              className="text-primary-600 hover:text-primary-500 font-medium"
            >
              Use traditional login
            </button>
          </p>

          {onSwitchToPhone && (
            <p className="text-sm text-secondary-600">
              No email?{' '}
              <button
                onClick={onSwitchToPhone}
                className="text-primary-600 hover:text-primary-500 font-medium"
              >
                Sign in with phone
              </button>
            </p>
          )}
        </div>
      </form>
    </div>
  );
};
