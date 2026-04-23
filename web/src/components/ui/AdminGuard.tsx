import React, { ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { isAdminRole, isSuperAdminEmail } from '../../lib/roles';
import { LoadingSpinner } from './LoadingSpinner';
import { AccessDenied } from './AccessDenied';

interface AdminGuardProps {
  children: ReactNode;
  /** Require super-admin (email-allowlisted) instead of admin */
  superOnly?: boolean;
}

export const AdminGuard: React.FC<AdminGuardProps> = ({ children, superOnly }) => {
  const { user, userProfile, loading } = useAuth();

  if (loading) return <LoadingSpinner />;

  const allowed = superOnly
    ? isSuperAdminEmail(user?.email)
    : isAdminRole(userProfile?.role);

  if (!allowed) return <AccessDenied />;

  return <>{children}</>;
};
