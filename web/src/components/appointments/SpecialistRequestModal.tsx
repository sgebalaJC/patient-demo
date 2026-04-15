import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Stethoscope, CheckCircle2 } from 'lucide-react';
import { SPECIALIST_TYPES } from '../../config/specialists';
import { specialistRequestOperations, notificationOperations } from '../../lib/firestore';
import { useAuth } from '../../hooks/useAuth';
import { FIELD_LIMITS } from '../../lib/validation';

interface SpecialistRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const SpecialistRequestModal: React.FC<SpecialistRequestModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { user, userProfile } = useAuth();
  const [specialistType, setSpecialistType] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !specialistType || reason.trim().length < FIELD_LIMITS.specialistReason.min) return;

    setLoading(true);
    setError('');

    try {
      const response = await specialistRequestOperations.createRequest(
        user.uid,
        specialistType,
        reason.trim(),
        notes.trim() || undefined,
      );

      if (response.success) {
        const label = SPECIALIST_TYPES.find(s => s.value === specialistType)?.label || specialistType;
        const patientName = userProfile
          ? `${userProfile.firstName} ${userProfile.lastName}`.trim()
          : 'A patient';

        // Notify admins
        notificationOperations.createNotification({
          recipientRole: 'admin',
          type: 'specialist_request',
          title: 'Specialist Referral Request',
          message: `${patientName} requested a ${label} appointment — ${reason.trim()}`,
          meta: {
            patientId: user.uid,
            requestId: response.data?.id || '',
            specialistType,
          },
        }).catch(() => {}); // non-blocking

        onSuccess();
        handleClose();
      } else {
        setError(response.error || 'Failed to submit request');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSpecialistType('');
    setReason('');
    setNotes('');
    setError('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Request Specialist Appointment"
      icon={<div className="bg-primary-100 p-2 rounded-lg"><Stethoscope className="h-6 w-6 text-primary-600" /></div>}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            Specialist Type *
          </label>
          <select
            value={specialistType}
            onChange={(e) => setSpecialistType(e.target.value)}
            className="input w-full"
            required
          >
            <option value="">Select a specialist...</option>
            {SPECIALIST_TYPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            Reason for Referral *
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why do you need to see this specialist?"
            rows={3}
            maxLength={FIELD_LIMITS.specialistReason.max}
            className="input w-full"
          />
          {reason.trim().length > 0 && reason.trim().length < FIELD_LIMITS.specialistReason.min && (
            <p className="text-xs text-red-500 mt-1">
              Please provide at least {FIELD_LIMITS.specialistReason.min} characters
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            Additional Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any other details..."
            rows={3}
            maxLength={FIELD_LIMITS.notes.max}
            className="input w-full"
          />
        </div>

        <div className="flex items-center justify-end space-x-3 pt-2 border-t border-secondary-200">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading} disabled={!specialistType || reason.trim().length < FIELD_LIMITS.specialistReason.min}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Submit Request
          </Button>
        </div>
      </form>
    </Modal>
  );
};
