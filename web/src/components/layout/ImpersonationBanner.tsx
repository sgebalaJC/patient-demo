import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Eye, X } from 'lucide-react';

export const ImpersonationBanner: React.FC = () => {
  const { userProfile, impersonating, exitImpersonation } = useAuth();

  if (!impersonating || !userProfile) return null;

  return (
    <div className="bg-amber-500 text-white px-4 py-2 text-sm flex items-center justify-between z-50">
      <div className="flex items-center space-x-2">
        <Eye className="h-4 w-4" />
        <span>
          Viewing as <strong>{userProfile.firstName} {userProfile.lastName}</strong> ({userProfile.role})
        </span>
      </div>
      <button
        onClick={exitImpersonation}
        className="flex items-center space-x-1 bg-amber-600 hover:bg-amber-700 px-3 py-1 rounded text-white text-sm font-medium"
      >
        <X className="h-3 w-3" />
        <span>Exit</span>
      </button>
    </div>
  );
};
