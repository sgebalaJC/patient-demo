import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-2',
};

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', className }) => {
  return (
    <div className={`flex items-center justify-center ${className || (size === 'lg' ? 'py-12' : 'py-4')}`}>
      <div className={`animate-spin rounded-full border-primary-600 border-t-transparent ${sizeClasses[size]}`} />
    </div>
  );
};
