import React from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AlertTriangle, Lock } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { isAdminRole } from '../../lib/roles';
import { AccessDenied } from '../ui/AccessDenied';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { usePlatformSubscription } from '../../hooks/usePlatformSubscription';
import { AdminChannelWidget } from '../admin/AdminChannelWidget';

const FULL_HEIGHT_ROUTES = ['/admin/agent'];

// Path is left accessible when the admin panel is hard-locked so the admin
// can still resolve the lapse.
const PLATFORM_BILLING_PATH = '/admin/platform-subscription';

export const AdminLayout: React.FC = () => {
  const { userProfile, loading } = useAuth();
  const location = useLocation();
  const { locked, inGrace, daysLeftInGrace, loaded } = usePlatformSubscription();

  if (loading) return <LoadingSpinner />;

  const role = userProfile?.role;
  if (!isAdminRole(role)) {
    return (
      <div className="p-8">
        <AccessDenied message="You don't have permission to access the admin area." />
      </div>
    );
  }

  // Hard lock: redirect all admin routes to the billing page until the
  // subscription is restored. The billing page itself is always reachable.
  if (
    loaded &&
    locked &&
    !location.pathname.startsWith(PLATFORM_BILLING_PATH)
  ) {
    return <Navigate to={PLATFORM_BILLING_PATH} replace />;
  }

  const isFullHeight = FULL_HEIGHT_ROUTES.some((r) => location.pathname.startsWith(r));
  const onBillingPage = location.pathname.startsWith(PLATFORM_BILLING_PATH);

  const banner =
    loaded && (locked || inGrace) && !onBillingPage ? (
      <Link
        to={PLATFORM_BILLING_PATH}
        className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border-b ${
          locked
            ? 'bg-red-50 border-red-200 text-red-800 hover:bg-red-100'
            : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
        }`}
      >
        {locked ? (
          <Lock className="h-4 w-4 flex-shrink-0" />
        ) : (
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        )}
        <span>
          {locked
            ? 'Platform subscription lapsed — admin panel locked. Click to resolve.'
            : `Platform subscription lapsed — ${daysLeftInGrace ?? 0} day${
                daysLeftInGrace === 1 ? '' : 's'
              } left before admin panel locks. Click to resolve.`}
        </span>
      </Link>
    ) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {banner}
      {isFullHeight ? (
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <Outlet />
        </div>
      ) : (
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <div className="w-full px-3 sm:px-4 lg:px-5 py-4">
            <Outlet />
          </div>
        </div>
      )}
      <AdminChannelWidget />
    </div>
  );
};
