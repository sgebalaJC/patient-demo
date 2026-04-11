import React, { useState } from 'react';
import { Phone, ArrowRight, CheckCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { sendPhoneLoginCode, verifyPhoneLogin } from '../../lib/firebase';
import logger from '../../lib/logger';

type Step = 'phone' | 'code' | 'name';

interface PhoneLoginFormProps {
  onSuccess: () => void;
  onSwitchToEmail: () => void;
  onSwitchToSignup: () => void;
  /** When false, the "Sign up here" prompt is hidden (registration disabled). */
  allowSignup?: boolean;
}

export const PhoneLoginForm: React.FC<PhoneLoginFormProps> = ({
  onSuccess,
  onSwitchToEmail,
  onSwitchToSignup,
  allowSignup = true,
}) => {
  const [step, setStep] = useState<Step>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const startCooldown = () => {
    setCooldown(30);
    const timer = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSendCode = async () => {
    if (!phoneNumber.trim()) {
      setError('Phone number is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await sendPhoneLoginCode(phoneNumber);
      if (result.success) {
        setStep('code');
        startCooldown();
      } else {
        setError(result.error || 'Failed to send code');
      }
    } catch (err: any) {
      logger.error('Error sending phone login code:', err);
      setError(err.message || 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (nameFirst?: string, nameLast?: string) => {
    if (code.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await verifyPhoneLogin(
        phoneNumber,
        code,
        nameFirst || undefined,
        nameLast || undefined,
      );
      if (result.success && result.needsName) {
        // New user — need to collect name first
        setStep('name');
      } else if (result.success) {
        onSuccess();
      } else {
        setError(result.error || 'Verification failed');
      }
    } catch (err: any) {
      logger.error('Error verifying phone login:', err);
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleNameSubmit = async () => {
    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      setError('First and last name must be at least 2 characters');
      return;
    }
    // Re-send verification with name — need a new code since the old one was consumed
    setLoading(true);
    setError('');
    try {
      // Send a new code and verify immediately with the name
      const sendResult = await sendPhoneLoginCode(phoneNumber);
      if (!sendResult.success) {
        setError(sendResult.error || 'Failed to send code');
        setLoading(false);
        return;
      }
      // Show code input again for the new code
      setStep('code');
      setCode('');
      startCooldown();
      // Store names so they're sent with the next verification
    } catch (err: any) {
      setError(err.message || 'Failed to complete registration');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setLoading(true);
    setError('');
    try {
      const result = await sendPhoneLoginCode(phoneNumber);
      if (result.success) {
        setCode('');
        startCooldown();
      } else {
        setError(result.error || 'Failed to resend code');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resend code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center mb-4">
          <Phone className="h-7 w-7 text-primary-600" />
        </div>
        <h2 className="text-2xl font-bold text-secondary-900">
          {step === 'name' ? 'Complete Your Profile' : 'Sign in with Phone'}
        </h2>
        <p className="mt-2 text-sm text-secondary-600">
          {step === 'phone' && 'Enter your phone number to receive a verification code'}
          {step === 'code' && `We sent a code to ${phoneNumber}`}
          {step === 'name' && 'Please enter your name to create your account'}
        </p>
      </div>

      <ErrorAlert message={error} />

      {step === 'phone' && (
        <div className="space-y-4">
          <Input
            label="Phone Number"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="(555) 555-5555"
          />
          <Button
            onClick={handleSendCode}
            loading={loading}
            className="w-full"
          >
            <ArrowRight className="h-4 w-4 mr-2" />
            Send Code
          </Button>
        </div>
      )}

      {step === 'code' && (
        <div className="space-y-4">
          <Input
            label="Verification Code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Enter 6-digit code"
            maxLength={6}
          />
          <Button
            onClick={() => handleVerifyCode(
              firstName.trim() || undefined,
              lastName.trim() || undefined,
            )}
            loading={loading}
            className="w-full"
            disabled={code.length !== 6}
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Verify & Sign In
          </Button>
          <div className="text-center">
            <button
              onClick={handleResend}
              disabled={cooldown > 0 || loading}
              className="text-sm text-primary-600 hover:text-primary-800 disabled:text-secondary-400"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
          <div className="text-center">
            <button
              onClick={() => { setStep('phone'); setCode(''); setError(''); }}
              className="text-sm text-secondary-500 hover:text-secondary-700"
            >
              Use a different number
            </button>
          </div>
        </div>
      )}

      {step === 'name' && (
        <div className="space-y-4">
          <Input
            label="First Name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
          />
          <Input
            label="Last Name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
          />
          <Button
            onClick={handleNameSubmit}
            loading={loading}
            className="w-full"
            disabled={firstName.trim().length < 2 || lastName.trim().length < 2}
          >
            Continue
          </Button>
        </div>
      )}

      {step !== 'name' && (
        <div className="space-y-3 pt-4 border-t border-secondary-200">
          <p className="text-center text-sm text-secondary-600">
            <button onClick={onSwitchToEmail} className="text-primary-600 hover:text-primary-800 font-medium">
              Sign in with email instead
            </button>
          </p>
          {allowSignup && (
            <p className="text-center text-sm text-secondary-600">
              Don't have an account?{' '}
              <button onClick={onSwitchToSignup} className="text-primary-600 hover:text-primary-800 font-medium">
                Sign up
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
};
