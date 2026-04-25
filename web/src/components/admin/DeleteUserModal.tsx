import React, { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { ErrorAlert } from '../ui/ErrorAlert';
import { functions } from '../../lib/firebase';
import { errorMessage } from '../../lib/errors';
import { User } from '../../types';
import logger from '../../lib/logger';

interface DeleteUserModalProps {
  user: User | null;
  onClose: () => void;
  onDeleted: () => void;
}

export const DeleteUserModal: React.FC<DeleteUserModalProps> = ({ user, onClose, onDeleted }) => {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setConfirmText('');
    setError(null);
  };

  const handleClose = () => {
    if (deleting) return;
    reset();
    onClose();
  };

  const handleDelete = async () => {
    if (!user || confirmText !== 'DELETE') return;
    setDeleting(true);
    setError(null);
    try {
      const deleteAccountFn = httpsCallable(functions, 'deleteAccount');
      const result = (await deleteAccountFn({ targetUserId: user.id })) as {
        data: { success: boolean; error?: string };
      };
      if (result.data.success) {
        reset();
        onDeleted();
      } else {
        setError(result.data.error || 'Failed to delete user');
      }
    } catch (err: unknown) {
      logger.error('Error deleting user:', err);
      setError(errorMessage(err) || 'Failed to delete user');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={!!user}
      onClose={handleClose}
      title={`Delete User — ${user ? `${user.firstName} ${user.lastName}`.trim() : ''}`}
      icon={<div className="bg-red-100 p-2 rounded-lg"><AlertTriangle className="h-6 w-6 text-red-600" /></div>}
      maxWidth="max-w-md"
    >
      <div className="p-6 space-y-4">
        <ErrorAlert message={error} />

        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800 font-medium">This will permanently delete:</p>
          <ul className="text-sm text-red-700 mt-2 space-y-1 list-disc list-inside">
            <li>User account and profile</li>
            <li>All messages and conversations</li>
            <li>All uploaded documents</li>
            <li>Appointment history</li>
            <li>Prescription refill requests</li>
            <li>Intake forms and medical history</li>
          </ul>
        </div>

        {user && (
          <div className="bg-secondary-50 rounded-lg p-3 text-sm text-secondary-700">
            <p><strong>User:</strong> {user.firstName} {user.lastName}</p>
            <p><strong>{user.email ? 'Email' : 'Phone'}:</strong> {user.email || user.phoneNumber}</p>
            <p><strong>Role:</strong> {user.role}</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-2">
            Type <span className="font-bold">DELETE</span> to confirm
          </label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE"
          />
        </div>

        <div className="flex items-center justify-end space-x-3 pt-2">
          <Button variant="secondary" size="md" onClick={handleClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            size="md"
            onClick={handleDelete}
            disabled={confirmText !== 'DELETE' || deleting}
            loading={deleting}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete User
          </Button>
        </div>
      </div>
    </Modal>
  );
};
