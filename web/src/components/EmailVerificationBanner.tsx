import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { sendEmailVerification, checkEmailVerified } from '../lib/firebase';
import { Button } from './ui/Button';
import { ErrorAlert } from './ui/ErrorAlert';
import { Mail, CheckCircle2, RefreshCw } from 'lucide-react';
import logger from '../lib/logger';

export const EmailVerificationBanner: React.FC = () => {
  const { user } = useAuth();
  const [isVerified, setIsVerified] = useState<boolean | null>(null);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const checkVerification = async () => {
      if (user) {
        const result = await checkEmailVerified();
        setIsVerified(result.verified);
        setInitialCheckDone(true);
      }
    };

    // Only run if we haven't done the initial check yet
    if (user && !initialCheckDone) {
      checkVerification();
    }

    // Check verification status every 30 seconds if not verified
    let interval: NodeJS.Timeout;
    if (user && initialCheckDone && isVerified === false) {
      interval = setInterval(checkVerification, 30000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [user, isVerified, initialCheckDone]);

  const handleResendVerification = async () => {
    setLoading(true);
    setError('');
    setMessage('');

    try {
      await sendEmailVerification();
      setMessage('Verification email sent! Please check your inbox and spam folder.');
    } catch (error: any) {
      logger.error('Error resending verification:', error);
      setError(error.message || 'Failed to send verification email');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckVerification = async () => {
    setLoading(true);
    try {
      const result = await checkEmailVerified();
      setIsVerified(result.verified);

      if (result.verified) {
        setMessage('Email verified successfully!');
        setError('');
      } else {
        setMessage('Email is still not verified. Please check your inbox.');
      }
    } catch (error: any) {
      logger.error('Error checking verification:', error);
      setError('Failed to check verification status');
    } finally {
      setLoading(false);
    }
  };

  // Don't show banner if:
  // - User is not logged in
  // - We haven't done the initial verification check yet
  // - Email is already verified
  if (!user || !initialCheckDone || isVerified === true) {
    return null;
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
      <div className="flex items-start space-x-3">
        <Mail className="h-5 w-5 text-amber-600 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-medium text-amber-800">
            Email Verification Required
          </h3>
          <p className="mt-1 text-sm text-amber-700">
            Please verify your email address to access all features. Check your inbox for a verification link.
            If you don't see it, <strong>check your spam or junk folder</strong> — emails from <strong>noreply@example.com</strong> sometimes end up there.
          </p>

          {message && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded flex items-center space-x-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <p className="text-sm text-green-600">{message}</p>
            </div>
          )}

          <ErrorAlert message={error} className="mt-3" />

          <div className="mt-4 flex items-center space-x-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleResendVerification}
              loading={loading}
              className="bg-amber-100 text-amber-800 hover:bg-amber-200"
            >
              <Mail className="h-4 w-4 mr-2" />
              Resend Email
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleCheckVerification}
              loading={loading}
              className="bg-amber-100 text-amber-800 hover:bg-amber-200"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Check Status
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
