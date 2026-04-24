import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { ModalOverlay } from './ModalOverlay';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (inputValue?: string) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  /** When set, shows a text input and passes its value to onConfirm */
  inputPrompt?: string;
  inputPlaceholder?: string;
  inputRequired?: boolean;
}

const variantStyles = {
  danger: {
    icon: 'bg-red-100 text-red-600',
    button: 'bg-surface-card border border-red-600 text-red-600 hover:bg-red-50',
  },
  warning: {
    icon: 'bg-yellow-100 text-yellow-600',
    button: 'bg-surface-card border border-yellow-600 text-yellow-700 hover:bg-yellow-50',
  },
  info: {
    icon: 'bg-primary-100 text-primary-600',
    button: 'bg-surface-card border border-primary-600 text-primary-600 hover:bg-primary-50',
  },
};

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  inputPrompt,
  inputPlaceholder,
  inputRequired = false,
}) => {
  const [inputValue, setInputValue] = useState('');
  const styles = variantStyles[variant];

  const handleConfirm = () => {
    if (inputRequired && !inputValue.trim()) return;
    onConfirm(inputPrompt ? inputValue : undefined);
    setInputValue('');
  };

  const handleClose = () => {
    setInputValue('');
    onClose();
  };

  return (
    <ModalOverlay isOpen={isOpen}>
      <div className="bg-surface-card rounded-xl max-w-md w-full shadow-xl">
        <div className="p-6">
          <div className="flex items-start space-x-4">
            <div className={`flex-shrink-0 p-2 rounded-lg ${styles.icon}`}>
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-secondary-900">{title}</h3>
              <p className="mt-2 text-sm text-secondary-600">{message}</p>
              {inputPrompt && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-secondary-700 mb-1">
                    {inputPrompt}
                  </label>
                  <textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={inputPlaceholder}
                    rows={3}
                    className="w-full rounded-lg border border-secondary-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    autoFocus
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end space-x-3 px-6 py-4 bg-secondary-50 rounded-b-xl border-t border-secondary-100">
          <Button variant="secondary" onClick={handleClose}>
            {cancelLabel}
          </Button>
          <Button
            variant="secondary"
            onClick={handleConfirm}
            disabled={inputRequired && !inputValue.trim()}
            className={styles.button}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
};
