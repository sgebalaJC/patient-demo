import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { AdminSidebar } from './AdminSidebar';
import { AccessDenied } from '../ui/AccessDenied';
import { LoadingSpinner } from '../ui/LoadingSpinner';

const FULL_HEIGHT_ROUTES = ['/admin/agent'];

export const AdminLayout: React.FC = () => {
  const { userProfile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingSpinner />;

  const role = userProfile?.role;
  if (role !== 'admin' && role !== 'assistant') {
    return (
      <div className="p-8">
        <AccessDenied message="You don't have permission to access the admin area." />
      </div>
    );
  }

  const isFullHeight = FULL_HEIGHT_ROUTES.some((r) => location.pathname.startsWith(r));

  return (
    <div className="flex flex-col md:flex-row flex-1 min-h-0 min-w-0">
      <AdminSidebar />
      {isFullHeight ? (
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <Outlet />
        </div>
      ) : (
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
            <Outlet />
          </div>
        </div>
      )}
    </div>
  );
};
