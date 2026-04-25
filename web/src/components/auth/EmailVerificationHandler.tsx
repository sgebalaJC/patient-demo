import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/Card';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { applyActionCode } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { errorCode } from '../../lib/errors';
import logger from '../../lib/logger';

interface EmailVerificationHandlerProps {
  oobCode: string;
}

export const EmailVerificationHandler: React.FC<EmailVerificationHandlerProps> = ({ oobCode }) => {
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string>('');
  const navigate = useNavigate();

  useEffect(() => {
    const verifyEmail = async () => {
      try {
        await applyActionCode(auth, oobCode);
        setSuccess(true);
        logger.info('Email verification successful');

        // Redirect to dashboard after a short delay
        setTimeout(() => {
          navigate('/dashboard');
        }, 3000);
      } catch (error: unknown) {
        logger.error('Email verification error:', error);

        switch (errorCode(error)) {
          case 'auth/expired-action-code':
            setError('Email verification link has expired. Please request a new one.');
            break;
          case 'auth/invalid-action-code':
            setError('Invalid email verification link. Please request a new one.');
            break;
          case 'auth/user-disabled':
            setError('Your account has been disabled. Please contact support.');
            break;
          default:
            setError('Failed to verify email. Please try again.');
        }
      } finally {
        setLoading(false);
      }
    };

    verifyEmail();
  }, [oobCode, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50 py-12 px-4 sm:px-6 lg:px-8">
        <Card className="max-w-md w-full space-y-8 p-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
              <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
            </div>
            <h2 className="text-2xl font-bold text-secondary-900 mb-2">
              Verifying Email
            </h2>
            <p className="text-secondary-600">
              Please wait while we verify your email address...
            </p>
          </div>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50 py-12 px-4 sm:px-6 lg:px-8">
        <Card className="max-w-md w-full space-y-8 p-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-secondary-900 mb-2">
              Email Verified
            </h2>
            <p className="text-secondary-600">
              Your email has been successfully verified. You will be redirected to your dashboard.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary-50 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-secondary-900 mb-2">
            Email Verification Failed
          </h2>
          <p className="text-secondary-600 mb-4">
            {error}
          </p>
          <button
            onClick={() => navigate('/auth')}
            className="text-primary-600 hover:text-primary-500 font-medium"
          >
            Back to Login
          </button>
        </div>
      </Card>
    </div>
  );
};
