import React, { ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { isAdminRole, isSuperAdminRole } from '../../lib/roles';
import { LoadingSpinner } from './LoadingSpinner';
import { AccessDenied } from './AccessDenied';

interface AdminGuardProps {
  children: ReactNode;
  /** Require super_admin instead of admin */
  superOnly?: boolean;
}

export const AdminGuard: React.FC<AdminGuardProps> = ({ children, superOnly }) => {
  const { userProfile, loading } = useAuth();

  if (loading) return <LoadingSpinner />;

  const allowed = superOnly
    ? isSuperAdminRole(userProfile?.role)
    : isAdminRole(userProfile?.role);

  if (!allowed) return <AccessDenied />;

  return <>{children}</>;
};
