import React from 'react';
import { AlertCircle } from 'lucide-react';

interface AccessDeniedProps {
  message?: string;
}

export const AccessDenied: React.FC<AccessDeniedProps> = ({
  message = "You don't have permission to access this page.",
}) => {
  return (
    <div className="text-center py-12">
      <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
      <h2 className="text-xl font-bold text-secondary-900 mb-2">Access Denied</h2>
      <p className="text-secondary-600">{message}</p>
    </div>
  );
};
