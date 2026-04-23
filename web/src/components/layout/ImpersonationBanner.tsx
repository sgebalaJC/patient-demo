import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Eye, X } from 'lucide-react';

export const ImpersonationBanner: React.FC = () => {
  const { userProfile, impersonating, exitImpersonation } = useAuth();

  if (!impersonating) return null;

  // Pull a fallback name from the impersonation flag so the banner — and the
  // Exit button — render even before the impersonated user's profile finishes
  // loading. Otherwise the operator sees no banner during the load window and
  // has no way out.
  let fallbackName = 'impersonated user';
  try {
    const raw = sessionStorage.getItem('impersonation');
    if (raw) fallbackName = JSON.parse(raw)?.targetName || fallbackName;
  } catch { /* ignore */ }

  const name = userProfile
    ? `${userProfile.firstName} ${userProfile.lastName}`
    : fallbackName;
  const role = userProfile?.role ?? '…';

  return (
    <div className="bg-amber-500 text-white px-4 py-2 text-sm flex items-center justify-between z-50">
      <div className="flex items-center space-x-2">
        <Eye className="h-4 w-4" />
        <span>
          Viewing as <strong>{name}</strong> ({role})
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
