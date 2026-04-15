import React, { useState } from 'react';
import { Phone, Shield } from 'lucide-react';
import { Button } from './Button';
import { ErrorAlert } from './ErrorAlert';
import { ModalOverlay } from './ModalOverlay';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { formatPhoneDisplay } from '../../lib/phone';

interface PhoneVerificationModalProps {
  isOpen: boolean;
  phoneNumber: string;
  onVerified: (verifiedPhone: string) => void;
  onClose: () => void;
}

export const PhoneVerificationModal: React.FC<PhoneVerificationModalProps> = ({
  isOpen,
  phoneNumber,
  onVerified,
  onClose,
}) => {
  const [step, setStep] = useState<'send' | 'verify'>('send');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendCode = async () => {
    setLoading(true);
    setError('');

    try {
      const sendCodeFn = httpsCallable(functions, 'sendPhoneVerificationCode');
      const result = await sendCodeFn({ phoneNumber }) as {
        data: { success: boolean; error?: string };
      };

      if (result.data.success) {
        setStep('verify');
      } else {
        setError(result.data.error || 'Failed to send verification code');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setLoading(true);
    setError('');

    try {
      const verifyFn = httpsCallable(functions, 'verifyPhoneCode');
      const result = await verifyFn({ code }) as {
        data: { success: boolean; phoneNumber?: string; error?: string };
      };

      if (result.data.success) {
        onVerified(result.data.phoneNumber || phoneNumber);
      } else {
        setError(result.data.error || 'Verification failed');
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep('send');
    setCode('');
    setError('');
    onClose();
  };

  const maskedPhone = formatPhoneDisplay(phoneNumber);

  return (
    <ModalOverlay isOpen={isOpen}>
      <div className="bg-surface-card rounded-xl max-w-md w-full shadow-xl">
        <div className="p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="bg-primary-100 p-2 rounded-lg">
              <Shield className="h-5 w-5 text-primary-600" />
            </div>
            <h3 className="text-lg font-semibold text-secondary-900">Verify Phone Number</h3>
          </div>

          <ErrorAlert message={error} className="mb-4" />

          {step === 'send' ? (
            <div className="space-y-4">
              <p className="text-sm text-secondary-600">
                We'll send a verification code via SMS to:
              </p>
              <div className="flex items-center space-x-3 p-3 bg-secondary-50 rounded-lg">
                <Phone className="h-5 w-5 text-secondary-500" />
                <span className="font-medium text-secondary-900">{maskedPhone}</span>
              </div>
              <div className="flex items-center justify-end space-x-3 pt-2">
                <Button variant="secondary" onClick={handleClose} disabled={loading}>
                  Cancel
                </Button>
                <Button onClick={handleSendCode} loading={loading}>
                  Send Code
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-secondary-600">
                Enter the 6-digit code sent to <strong>{maskedPhone}</strong>
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && code.length === 6 && !loading) {
                    handleVerifyCode();
                  }
                }}
                placeholder="000000"
                className="input w-full text-center text-2xl tracking-[0.5em] font-mono"
                autoFocus
              />
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => {
                    setStep('send');
                    setCode('');
                    setError('');
                  }}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                  disabled={loading}
                >
                  Resend code
                </button>
                <div className="flex items-center space-x-3">
                  <Button variant="secondary" onClick={handleClose} disabled={loading}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleVerifyCode}
                    loading={loading}
                    disabled={code.length !== 6}
                  >
                    Verify
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
};
