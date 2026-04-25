import React, { useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { ErrorAlert } from '../ui/ErrorAlert';
import { firebaseService } from '../../lib/firebase';
import { errorCode, errorMessage } from '../../lib/errors';
import { FIELD_LIMITS } from '../../lib/validation';
import { User } from '../../types';
import logger from '../../lib/logger';

interface SetPasswordModalProps {
  user: User | null;
  onClose: () => void;
}

export const SetPasswordModal: React.FC<SetPasswordModalProps> = ({ user, onClose }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPassword('');
    setConfirm('');
    setError(null);
    setSaved(false);
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSave = async () => {
    if (!user) return;
    if (password.length < FIELD_LIMITS.password.min) {
      setError(`Password must be at least ${FIELD_LIMITS.password.min} characters`);
      return;
    }
    if (password.length > FIELD_LIMITS.password.max) {
      setError(`Password must be less than ${FIELD_LIMITS.password.max} characters`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await firebaseService.setUserPassword(user.id, password);
      if (result?.success) {
        setSaved(true);
        setPassword('');
        setConfirm('');
      } else {
        setError(result?.error || 'Failed to set password');
      }
    } catch (err: unknown) {
      // Password intentionally not logged.
      logger.error('Set password failed:', { code: errorCode(err), message: errorMessage(err) });
      setError(errorMessage(err) || 'Failed to set password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={!!user}
      onClose={handleClose}
      title={`Set Password — ${user ? `${user.firstName} ${user.lastName}`.trim() : ''}`}
      icon={<div className="bg-primary-100 p-2 rounded-lg"><KeyRound className="h-6 w-6 text-primary-600" /></div>}
      maxWidth="max-w-md"
    >
      <div className="p-6 space-y-4">
        <ErrorAlert message={error} />

        {saved ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800 flex items-start space-x-2">
            <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <span>
              Password updated. The user can now sign in with their email and the new password.
              Share the password through a secure channel — it isn't stored or shown again.
            </span>
          </div>
        ) : (
          <>
            <p className="text-sm text-secondary-600">
              Set a password so this user can sign in with email + password in addition
              to email-link / Google / phone OTP. Minimum {FIELD_LIMITS.password.min} characters.
            </p>

            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-2">
                New password
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`At least ${FIELD_LIMITS.password.min} characters`}
                autoComplete="new-password"
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-2">
                Confirm password
              </label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                autoComplete="new-password"
                disabled={saving}
              />
            </div>
          </>
        )}

        <div className="flex items-center justify-end space-x-3 pt-2">
          <Button variant="secondary" size="md" onClick={handleClose} disabled={saving}>
            {saved ? 'Close' : 'Cancel'}
          </Button>
          {!saved && (
            <Button
              size="md"
              onClick={handleSave}
              loading={saving}
              disabled={saving || password.length < FIELD_LIMITS.password.min || password !== confirm}
            >
              <KeyRound className="h-4 w-4 mr-2" />
              Set Password
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
