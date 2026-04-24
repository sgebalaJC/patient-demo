import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Lock, Eye, EyeOff, User, Phone } from 'lucide-react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { OAuthButtons } from './OAuthButtons';
import { signUpWithEmail } from '../../lib/firebase';
import { emailField, firstNameField, lastNameField, passwordField, phoneField } from '../../lib/validation';
import logger from "../../lib/logger";

const signupSchema = z.object({
  firstName: firstNameField(),
  lastName: lastNameField(),
  phoneNumber: phoneField({ required: true })
    .refine(
      (val) => /^\+?[\d\s\-\(\)]{10,}$/.test(val.replace(/\s/g, '')),
      'Please enter a valid phone number'
    ),
  email: emailField(),
  password: passwordField()
    .regex(/(?=.*[a-z])/, 'Password must contain at least one lowercase letter')
    .regex(/(?=.*[A-Z])/, 'Password must contain at least one uppercase letter')
    .regex(/(?=.*\d)/, 'Password must contain at least one number'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
  acceptTerms: z.boolean().refine(val => val === true, 'You must accept the terms and conditions'),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SignupFormData = z.infer<typeof signupSchema>;

interface SignupFormProps {
  onSuccess: () => void;
  onSwitchToLogin: () => void;
  onOpenLegal?: (type: 'terms' | 'privacy') => void;
}

export const SignupForm: React.FC<SignupFormProps> = ({
  onSuccess,
  onSwitchToLogin,
  onOpenLegal,
}) => {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authError, setAuthError] = useState<string>('');
  const [showExistingAccountHint, setShowExistingAccountHint] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    mode: 'onSubmit', // Only validate on submit
    defaultValues: {
      firstName: '',
      lastName: '',
      phoneNumber: '',
      email: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false,
    },
  });

  // Debug: watch all form values
  const watchedValues = watch();
  logger.debug('Current form values:', watchedValues);
  logger.debug('Form errors:', errors);

  const onSubmit = async (data: SignupFormData) => {
    logger.debug('Form data:', data); // Debug log to see what data is being submitted
    
    // Defensive check: ensure terms are accepted before proceeding
    // This prevents account creation if validation is somehow bypassed
    if (!data.acceptTerms) {
      setAuthError('You must accept the terms and conditions to create an account');
      return;
    }
    
    setLoading(true);
    setAuthError('');

    try {
      await signUpWithEmail(data.email, data.password, {
        firstName: data.firstName,
        lastName: data.lastName,
        phoneNumber: data.phoneNumber,
        role: 'patient' // Default role, can be changed later
      });
      onSuccess();
    } catch (error: any) {
      logger.error('Signup error:', error);
      if (error.code === 'auth/email-already-in-use') {
        setShowExistingAccountHint(true);
        setAuthError('An account with this email already exists. Please sign in instead — you can use Google sign-in, email link, or phone login.');
      } else {
        setShowExistingAccountHint(false);
        setAuthError(error.message || 'Failed to create account');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-secondary-900">Create your account</h2>
        <p className="mt-2 text-secondary-600">
          Join our doctor-patient portal today
        </p>
      </div>

      <OAuthButtons onSuccess={onSuccess} />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-secondary-300" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-surface-card text-secondary-500">Or register with email</span>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <ErrorAlert message={authError} />
        {showExistingAccountHint && (
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
            <p className="text-sm text-primary-800 mb-3">
              Your account may have been set up by the practice. Try signing in with one of these methods:
            </p>
            <Button
              type="button"
              onClick={onSwitchToLogin}
              className="w-full"
              size="sm"
            >
              Go to Sign In
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="relative">
            <User className="absolute left-3 top-3 text-secondary-400 h-5 w-5" />
            <Input
              {...register('firstName')}
              type="text"
              placeholder="First name"
              className="pl-10"
              error={errors.firstName?.message}
            />
          </div>
          <div className="relative">
            <User className="absolute left-3 top-3 text-secondary-400 h-5 w-5" />
            <Input
              {...register('lastName')}
              type="text"
              placeholder="Last name"
              className="pl-10"
              error={errors.lastName?.message}
            />
          </div>
        </div>

        <div className="relative">
          <Phone className="absolute left-3 top-3 text-secondary-400 h-5 w-5" />
          <Input
            {...register('phoneNumber')}
            type="tel"
            placeholder="Phone number"
            className="pl-10"
            error={errors.phoneNumber?.message}
          />
        </div>

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
            placeholder="Create password"
            className="pl-10 pr-10"
            error={errors.password?.message}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-3 text-secondary-400 hover:text-secondary-600"
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>

        <div className="relative">
          <Lock className="absolute left-3 top-3 text-secondary-400 h-5 w-5" />
          <Input
            {...register('confirmPassword')}
            type={showConfirmPassword ? 'text' : 'password'}
            placeholder="Confirm password"
            className="pl-10 pr-10"
            error={errors.confirmPassword?.message}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute right-3 top-3 text-secondary-400 hover:text-secondary-600"
          >
            {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>

        <div className="flex items-start">
          <div className="flex items-center h-5">
            <input
              {...register('acceptTerms')}
              id="accept-terms"
              type="checkbox"
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300 rounded"
            />
          </div>
          <div className="ml-3 text-sm">
            <label htmlFor="accept-terms" className="text-secondary-700">
              I agree to the{' '}
              <button type="button" onClick={() => onOpenLegal?.('terms')} className="text-primary-600 hover:text-primary-500 font-medium underline">
                Terms of Service
              </button>{' '}
              and{' '}
              <button type="button" onClick={() => onOpenLegal?.('privacy')} className="text-primary-600 hover:text-primary-500 font-medium underline">
                Privacy Policy
              </button>
            </label>
            {errors.acceptTerms && (
              <p className="text-red-600 text-sm mt-1">{errors.acceptTerms.message}</p>
            )}
          </div>
        </div>

        <Button type="submit" className="w-full" loading={loading}>
          Create account
        </Button>

        <div className="text-center">
          <span className="text-sm text-secondary-600">Already have an account? </span>
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-sm text-primary-600 hover:text-primary-500 font-medium"
          >
            Sign in here
          </button>
        </div>
      </form>
    </div>
  );
};
