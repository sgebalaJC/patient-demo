import React from 'react';
import { X } from 'lucide-react';
import { ModalOverlay } from './ModalOverlay';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  maxWidth?: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  maxWidth = 'max-w-2xl',
  children,
}) => {
  return (
    <ModalOverlay isOpen={isOpen}>
      <div className={`bg-surface-card rounded-xl ${maxWidth} w-full max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-6 border-b border-secondary-200">
          <div className="flex items-center space-x-3">
            {icon}
            <h2 className="text-xl font-semibold text-secondary-900">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-secondary-400 hover:text-secondary-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        {children}
      </div>
    </ModalOverlay>
  );
};
