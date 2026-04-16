import React, { useState, useEffect } from 'react';
import { Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { LoginForm } from '../components/auth/LoginForm';
import { EmailLinkLoginForm } from '../components/auth/EmailLinkLoginForm';
import { SignupForm } from '../components/auth/SignupForm';
import { BootstrapAdminForm } from '../components/auth/BootstrapAdminForm';
import { useAppSettings } from '../contexts/AppSettingsContext';
import { ForgotPasswordForm } from '../components/auth/ForgotPasswordForm';
import { PhoneLoginForm } from '../components/auth/PhoneLoginForm';
import { LegalModal } from '../components/ui/LegalModal';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';
import { ErrorAlert } from '../components/ui/ErrorAlert';
import { completeEmailLinkSignIn, isValidEmailLink } from '../lib/firebase';
import { PasswordResetForm } from '../components/auth/PasswordResetForm';
import { EmailVerificationHandler } from '../components/auth/EmailVerificationHandler';
import { BRANDING } from '../config/branding';
import logger from "../lib/logger";
import { AlertCircle, Mail } from "lucide-react";
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

// Import Firebase config to get the API key
import { auth } from '../lib/firebase';

type AuthMode = 'login' | 'email-link' | 'phone' | 'signup' | 'forgot-password';
type LegalModalType = 'terms' | 'privacy' | null;

export const AuthPage: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>('email-link');
  const [legalModal, setLegalModal] = useState<LegalModalType>(null);
  const [emailLinkLoading, setEmailLinkLoading] = useState(false);
  const [emailLinkError, setEmailLinkError] = useState<string>('');
  const [needsEmailForLink, setNeedsEmailForLink] = useState(false);
  const [emailForLink, setEmailForLink] = useState('');
  const [searchParams] = useSearchParams();
  const { user, userProfile, loading } = useAuth();
  const { settings: appSettings, loading: settingsLoading } = useAppSettings();
  const navigate = useNavigate();

  // Latch that keeps the bootstrap form mounted through the in-flight sign-in
  // even after `appSettings.bootstrapped` flips to true. This prevents a race
  // where the trigger commits `bootstrapped: true` BEFORE writing the token
  // back to the bootstrap-requests doc — without this latch, the form would
  // unmount as soon as the flag flips, the onSnapshot listener would be
  // cleaned up, and the token would never be consumed.
  const [bootstrapInFlight, setBootstrapInFlight] = useState(false);

  // Get query parameters for auth actions (both from /auth and /__/auth/action)
  const urlMode = searchParams.get('mode');
  const oobCode = searchParams.get('oobCode');
  const apiKey = searchParams.get('apiKey');

  // Handle different auth modes
  const isPasswordReset = urlMode === 'resetPassword';
  const isEmailVerification = urlMode === 'verifyEmail' || urlMode === 'verifyAndChangeEmail';
  const isRecoverEmail = urlMode === 'recoverEmail';

  // Validate apiKey for security (when present)
  const isValidApiKey = !apiKey || apiKey === auth.config.apiKey;
  const isAuthAction = isPasswordReset || isEmailVerification || isRecoverEmail;

  // Handle email link completion on page load
  useEffect(() => {
    const handleEmailLinkSignIn = async () => {
      const urlMode = searchParams.get('mode');
      const oobCode = searchParams.get('oobCode');

      // Check for Firebase email link (mode=signIn) or our custom mode
      if ((urlMode === 'signIn' || urlMode === 'complete-signin') && oobCode && isValidEmailLink()) {
        setEmailLinkLoading(true);
        setEmailLinkError('');

        try {
          await completeEmailLinkSignIn();
          // Sign-in succeeded — keep the loading spinner visible until
          // AuthContext picks up the auth state change and redirects.
          // Do NOT clear emailLinkLoading here; the redirect via
          // <Navigate> will unmount this component.
        } catch (error: any) {
          setEmailLinkLoading(false);
          if (error.message === 'EMAIL_REQUIRED') {
            // sessionStorage email lost (link opened in new tab) — ask user to confirm email
            setNeedsEmailForLink(true);
          } else if (error.message === 'REGISTRATION_DISABLED') {
            setEmailLinkError(
              'New patient registration is currently closed. Please contact the office to request an account.'
            );
          } else {
            logger.error('Email link sign-in error:', error);
            setEmailLinkError(
              error.message || 'Failed to complete sign-in. Please try again.'
            );
          }
        }
      }
    };

    handleEmailLinkSignIn();
  }, [searchParams]);

  if (loading || settingsLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-secondary-100 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  // Handle invalid API key
  if (isAuthAction && !isValidApiKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50 py-12 px-4 sm:px-6 lg:px-8">
        <Card className="max-w-md w-full space-y-8 p-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-secondary-900 mb-2">
              Invalid Link
            </h2>
            <p className="text-secondary-600 mb-4">
              This link is not valid for this application. Please make sure you're using the correct link from your email.
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
  }

  // Handle password reset mode
  if (isPasswordReset && oobCode && isValidApiKey) {
    return <PasswordResetForm oobCode={oobCode} />;
  }

  // Handle email verification mode
  if (isEmailVerification && oobCode && isValidApiKey) {
    return <EmailVerificationHandler oobCode={oobCode} />;
  }

  // Handle email recovery mode (similar to verification)
  if (isRecoverEmail && oobCode && isValidApiKey) {
    return <EmailVerificationHandler oobCode={oobCode} />;
  }

  // Handle invalid reset/verification attempts
  if (isAuthAction && !oobCode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50 py-12 px-4 sm:px-6 lg:px-8">
        <Card className="max-w-md w-full space-y-8 p-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-secondary-900 mb-2">
              Invalid Link
            </h2>
            <p className="text-secondary-600 mb-4">
              This {isPasswordReset ? 'password reset' : isEmailVerification ? 'email verification' : 'recovery'} link appears to be invalid or has expired. Please request a new one.
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
  }

  if (user && userProfile) {
      if(isAdminRole(userProfile.role))
        return <Navigate to="/admin" replace />;
      return <Navigate to="/dashboard" replace />;
  }

  const handleAuthSuccess = () => {
    // Navigation will be handled automatically by the auth state change
  };

  const handleEmailForLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailForLink.trim()) return;
    setEmailLinkLoading(true);
    setEmailLinkError('');
    try {
      await completeEmailLinkSignIn(emailForLink.trim());
      setNeedsEmailForLink(false);
      // Keep loading spinner — AuthContext will redirect on state change
    } catch (error: any) {
      setEmailLinkLoading(false);
      logger.error('Email link sign-in error:', error);
      setEmailLinkError(
        error.message || 'Failed to complete sign-in. Please try again.'
      );
    }
  };

  // Show loading spinner during email link completion
  if (emailLinkLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-secondary-100 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="mt-4 text-secondary-600">Completing sign-in...</p>
        </div>
      </div>
    );
  }

  // Email link opened in a new tab — ask user to confirm their email
  if (needsEmailForLink) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-secondary-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-secondary-900">
              Show<span className="text-primary-600">MD</span>
            </h1>
          </div>
          <Card className="p-8">
            <div className="space-y-6">
              <div className="text-center">
                <Mail className="h-12 w-12 text-primary-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-secondary-900">Confirm your email</h2>
                <p className="mt-2 text-secondary-600">
                  Please enter the email address you used to request the sign-in link.
                </p>
              </div>
              <ErrorAlert message={emailLinkError} />
              <form onSubmit={handleEmailForLinkSubmit} className="space-y-4">
                <input
                  type="email"
                  value={emailForLink}
                  onChange={(e) => setEmailForLink(e.target.value)}
                  placeholder="Enter your email address"
                  className="w-full px-4 py-3 border border-secondary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-surface-card text-secondary-900 placeholder-secondary-400"
                  autoFocus
                  required
                />
                <Button type="submit" className="w-full">
                  Complete sign-in
                </Button>
              </form>
              <div className="text-center">
                <button
                  onClick={() => { setNeedsEmailForLink(false); navigate('/auth'); }}
                  className="text-sm text-primary-600 hover:text-primary-500 font-medium"
                >
                  Back to login
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // Fresh-install bootstrap: no admin exists yet OR bootstrap submission is
  // mid-flight. Showing the form while `bootstrapInFlight` is true protects
  // against the trigger→client race where `bootstrapped` flips before the
  // token lands in the request doc.
  if (!appSettings.bootstrapped || bootstrapInFlight) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-secondary-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-secondary-900">{BRANDING.shortName}</h1>
          </div>
          <Card className="p-8">
            <BootstrapAdminForm onSubmitStart={() => setBootstrapInFlight(true)} />
          </Card>
        </div>
      </div>
    );
  }

  // When public registration is disabled, force the auth page to non-signup modes
  // and pass a flag to the child forms to hide their "Sign up here" links.
  const allowSignup = appSettings.registrationEnabled;
  const safeMode: AuthMode = !allowSignup && mode === 'signup' ? 'email-link' : mode;
  const handleSwitchToSignup = () => {
    if (allowSignup) setMode('signup');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-secondary-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-secondary-900">
            {BRANDING.shortName}
          </h1>
          <p className="mt-2 text-secondary-600">
            {BRANDING.practiceName} patient portal
          </p>
        </div>

        <Card className="p-8">
          <ErrorAlert message={emailLinkError} className="mb-6" />

          {safeMode === 'email-link' && (
            <EmailLinkLoginForm
              onSuccess={handleAuthSuccess}
              onSwitchToSignup={handleSwitchToSignup}
              onSwitchToTraditional={() => setMode('login')}
              onSwitchToPhone={() => setMode('phone')}
              allowSignup={allowSignup}
            />
          )}

          {safeMode === 'phone' && (
            <PhoneLoginForm
              onSuccess={handleAuthSuccess}
              onSwitchToEmail={() => setMode('email-link')}
              onSwitchToSignup={handleSwitchToSignup}
              allowSignup={allowSignup}
            />
          )}

          {safeMode === 'login' && (
            <LoginForm
              onSuccess={handleAuthSuccess}
              onForgotPassword={() => setMode('forgot-password')}
              onSwitchToSignup={handleSwitchToSignup}
              onSwitchToEmailLink={() => setMode('email-link')}
              allowSignup={allowSignup}
            />
          )}

          {safeMode === 'signup' && allowSignup && (
            <SignupForm
              onSuccess={handleAuthSuccess}
              onSwitchToLogin={() => setMode('email-link')}
              onOpenLegal={(type) => setLegalModal(type)}
            />
          )}

          {safeMode === 'forgot-password' && (
            <ForgotPasswordForm
              onBack={() => setMode('email-link')}
            />
          )}
        </Card>

        <div className="text-center text-sm text-secondary-500">
          <p>
            By continuing, you agree to our{' '}
            <button 
              onClick={() => setLegalModal('terms')}
              className="text-primary-600 hover:text-primary-500 underline"
            >
              Terms of Service
            </button>{' '}
            and{' '}
            <button 
              onClick={() => setLegalModal('privacy')}
              className="text-primary-600 hover:text-primary-500 underline"
            >
              Privacy Policy
            </button>
          </p>
        </div>

        <LegalModal
          isOpen={legalModal !== null}
          onClose={() => setLegalModal(null)}
          type={legalModal || 'terms'}
        />
      </div>
    </div>
  );
};
