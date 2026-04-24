import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Eye, X, Loader2 } from 'lucide-react';

export const ImpersonationBanner: React.FC = () => {
  const { userProfile, impersonating, exitImpersonation } = useAuth();
  // Exit tears down the Firebase session and hard-reloads to /auth. Between
  // the click and the navigation the page is still live, and rapid re-clicks
  // can fire a second signOut against an already-cleared session. Block the
  // UI with a full-screen overlay until the reload happens.
  const [exiting, setExiting] = useState(false);

  if (!impersonating) return null;

  const handleExit = async () => {
    if (exiting) return;
    setExiting(true);
    try {
      await exitImpersonation();
    } catch {
      // exitImpersonation already logs; `finally` in the context triggers
      // the redirect regardless. If we somehow land here, drop the overlay
      // so the operator isn't stuck.
      setExiting(false);
    }
  };

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
    <>
      <div className="bg-amber-500 text-white px-4 py-2 text-sm flex items-center justify-between z-50">
        <div className="flex items-center space-x-2">
          <Eye className="h-4 w-4" />
          <span>
            Viewing as <strong>{name}</strong> ({role})
          </span>
        </div>
        <button
          onClick={handleExit}
          disabled={exiting}
          className="flex items-center space-x-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-70 disabled:cursor-not-allowed px-3 py-1 rounded text-white text-sm font-medium"
        >
          {exiting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          <span>{exiting ? 'Exiting…' : 'Exit'}</span>
        </button>
      </div>
      {exiting && (
        <div
          role="alert"
          aria-live="assertive"
          aria-busy="true"
          className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center"
        >
          <div className="bg-white rounded-lg shadow-xl px-6 py-5 flex items-center space-x-3">
            <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
            <span className="text-secondary-900 text-sm font-medium">
              Exiting impersonation — please sign in again…
            </span>
          </div>
        </div>
      )}
    </>
  );
};
