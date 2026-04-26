import React from 'react';

type AlertVariant = 'error' | 'success' | 'warning' | 'info';

interface AlertBannerProps {
  message: React.ReactNode | null | undefined;
  variant?: AlertVariant;
  className?: string;
}

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-yellow-200 bg-yellow-50 text-yellow-900',
  info: 'border-primary-200 bg-primary-50 text-primary-700',
};

export const AlertBanner: React.FC<AlertBannerProps> = ({
  message,
  variant = 'error',
  className = '',
}) => {
  if (message == null || message === '' || message === false) return null;
  return (
    <div className={`rounded-md border p-3 text-sm ${VARIANT_CLASSES[variant]} ${className}`}>
      {message}
    </div>
  );
};
