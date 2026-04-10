import React from 'react';

interface ErrorAlertProps {
  message: string | null | undefined;
  className?: string;
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({ message, className = '' }) => {
  if (!message) return null;

  return (
    <div className={`p-4 bg-red-50 border border-red-200 rounded-lg ${className}`}>
      <p className="text-sm text-red-600">{message}</p>
    </div>
  );
};
