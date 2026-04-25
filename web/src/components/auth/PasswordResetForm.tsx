import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Card } from '../ui/Card';
import { CheckCircle2, Lock, Eye, EyeOff } from 'lucide-react';
import { confirmPasswordReset } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { errorCode } from '../../lib/errors';
import logger from '../../lib/logger';

const passwordResetSchema = z.object({
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase letter, one uppercase letter, and one number'),
  confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type PasswordResetFormData = z.infer<typeof passwordResetSchema>;

interface PasswordResetFormProps {
  oobCode: string;
}

export const PasswordResetForm: React.FC<PasswordResetFormProps> = ({ oobCode }) => {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PasswordResetFormData>({
    resolver: zodResolver(passwordResetSchema),
  });

  const onSubmit = async (data: PasswordResetFormData) => {
    setLoading(true);
    setError('');

    try {
      await confirmPasswordReset(auth, oobCode, data.newPassword);
      setSuccess(true);
      logger.info('Password reset successful');

      // Redirect to login after a short delay
      setTimeout(() => {
        navigate('/auth?message=Password reset successful. Please log in with your new password.');
      }, 2000);
    } catch (error: unknown) {
      logger.error('Password reset error:', error);

      switch (errorCode(error)) {
        case 'auth/expired-action-code':
          setError('Password reset link has expired. Please request a new one.');
          break;
        case 'auth/invalid-action-code':
          setError('Invalid password reset link. Please request a new one.');
          break;
        case 'auth/weak-password':
          setError('Password is too weak. Please choose a stronger password.');
          break;
        default:
          setError('Failed to reset password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50 py-12 px-4 sm:px-6 lg:px-8">
        <Card className="max-w-md w-full space-y-8 p-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-secondary-900 mb-2">
              Password Reset Successful
            </h2>
            <p className="text-secondary-600">
              Your password has been updated successfully. You will be redirected to the login page.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary-50 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="max-w-md w-full space-y-8 p-8">
        <div>
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-primary-100 mb-4">
            <Lock className="h-6 w-6 text-primary-600" />
          </div>
          <h2 className="text-center text-2xl font-bold text-secondary-900">
            Reset Your Password
          </h2>
          <p className="mt-2 text-center text-sm text-secondary-600">
            Enter your new password below
          </p>
        </div>

        <ErrorAlert message={error} />

        <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-secondary-700 mb-2">
              New Password
            </label>
            <div className="relative">
              <input
                {...register('newPassword')}
                type={showPassword ? 'text' : 'password'}
                className="input w-full pr-10"
                placeholder="Enter your new password"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5 text-secondary-400" />
                ) : (
                  <Eye className="h-5 w-5 text-secondary-400" />
                )}
              </button>
            </div>
            {errors.newPassword && (
              <p className="mt-1 text-sm text-red-600">{errors.newPassword.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-secondary-700 mb-2">
              Confirm New Password
            </label>
            <div className="relative">
              <input
                {...register('confirmPassword')}
                type={showConfirmPassword ? 'text' : 'password'}
                className="input w-full pr-10"
                placeholder="Confirm your new password"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-5 w-5 text-secondary-400" />
                ) : (
                  <Eye className="h-5 w-5 text-secondary-400" />
                )}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="mt-1 text-sm text-red-600">{errors.confirmPassword.message}</p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            loading={loading}
            disabled={loading}
          >
            Reset Password
          </Button>
        </form>

        <div className="text-center">
          <button
            onClick={() => navigate('/auth')}
            className="text-sm text-primary-600 hover:text-primary-500"
          >
            Back to Login
          </button>
        </div>
      </Card>
    </div>
  );
};
