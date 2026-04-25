import React from 'react';
import { Modal } from '../ui/Modal';

interface SendBackIntakeFormModalProps {
  formId: string | null;
  notes: string;
  onNotesChange: (next: string) => void;
  onConfirm: (formId: string) => void;
  onClose: () => void;
}

/**
 * Confirmation modal for the admin "Send Back for Corrections" action on a
 * submitted intake form. Lifted out of AdminIntakeFormsPage so the page no
 * longer carries inline `fixed inset-0` scaffolding — uses the Modal primitive.
 */
export const SendBackIntakeFormModal: React.FC<SendBackIntakeFormModalProps> = ({
  formId,
  notes,
  onNotesChange,
  onConfirm,
  onClose,
}) => {
  return (
    <Modal
      isOpen={!!formId}
      onClose={onClose}
      title="Send Back for Corrections"
      maxWidth="max-w-md"
    >
      <div className="p-6 space-y-4">
        <p className="text-sm text-secondary-600">
          The patient will be prompted to review and update their intake forms. Add a note about
          what needs to be corrected.
        </p>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="What needs to be updated? (optional)"
          rows={3}
          className="w-full border border-secondary-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
        />
        <div className="flex justify-end space-x-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-secondary-600 hover:text-secondary-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => formId && onConfirm(formId)}
            className="px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
          >
            Send Back
          </button>
        </div>
      </div>
    </Modal>
  );
};
