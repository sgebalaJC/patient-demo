import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { OAuthButtons } from './OAuthButtons';
import { signInWithEmail } from '../../lib/firebase';
import logger from "../../lib/logger";

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
  onSuccess: () => void;
  onForgotPassword: () => void;
  onSwitchToSignup: () => void;
  onSwitchToEmailLink?: () => void;
  /** When false, the "Sign up here" prompt is hidden (registration disabled). */
  allowSignup?: boolean;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  onSuccess,
  onForgotPassword,
  onSwitchToSignup,
  onSwitchToEmailLink,
  allowSignup = true,
}) => {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string>('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    setAuthError('');

    try {
      await signInWithEmail(data.email, data.password);
      onSuccess();
    } catch (error: any) {
      logger.error('Login error:', error);
      setAuthError(
        error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password'
          ? 'Invalid email or password'
          : error.message || 'Failed to sign in'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-secondary-900">Welcome back</h2>
        <p className="mt-2 text-secondary-600">
          Sign in to your doctor-patient portal account
        </p>
      </div>

      <OAuthButtons onSuccess={onSuccess} />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-secondary-300" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-surface-card text-secondary-500">Or continue with</span>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <ErrorAlert message={authError} />

        <div className="relative">
          <Mail className="absolute left-3 top-3 text-secondary-400 h-5 w-5" />
          <Input
            {...register('email')}
            type="email"
            placeholder="Enter your email"
            className="pl-10"
            error={errors.email?.message}
          />
        </div>

        <div className="relative">
          <Lock className="absolute left-3 top-3 text-secondary-400 h-5 w-5" />
          <Input
            {...register('password')}
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter your password"
            className="pl-10 pr-10"
            error={errors.password?.message}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-3 text-secondary-400 hover:text-secondary-600"
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <input
              id="remember-me"
              name="remember-me"
              type="checkbox"
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300 rounded"
            />
            <label htmlFor="remember-me" className="ml-2 block text-sm text-secondary-700">
              Remember me
            </label>
          </div>

          <button
            type="button"
            onClick={onForgotPassword}
            className="text-sm text-primary-600 hover:text-primary-500 font-medium"
          >
            Forgot your password?
          </button>
        </div>

        <Button type="submit" className="w-full" loading={loading}>
          Sign in
        </Button>

        <div className="text-center space-y-2">
          {allowSignup && (
            <p className="text-sm text-secondary-600">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={onSwitchToSignup}
                className="text-primary-600 hover:text-primary-500 font-medium"
              >
                Sign up here
              </button>
            </p>
          )}

          {onSwitchToEmailLink && (
            <p className="text-sm text-secondary-600">
              Prefer passwordless login?{' '}
              <button
                type="button"
                onClick={onSwitchToEmailLink}
                className="text-primary-600 hover:text-primary-500 font-medium"
              >
                Use email link instead
              </button>
            </p>
          )}
        </div>
      </form>
    </div>
  );
};
