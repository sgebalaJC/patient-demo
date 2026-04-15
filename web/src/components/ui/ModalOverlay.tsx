import React from 'react';
import { createPortal } from 'react-dom';

interface ModalOverlayProps {
  isOpen: boolean;
  children: React.ReactNode;
}

export const ModalOverlay: React.FC<ModalOverlayProps> = ({ isOpen, children }) => {
  if (!isOpen) return null;
  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      {children}
    </div>,
    document.body,
  );
};
