import React from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { signOut } from '../../lib/firebase';
import { User, LogOut, Shield } from 'lucide-react';
import { BrandTextLogo } from '../ui/BrandLogo';
import { NotificationBell } from './NotificationBell';
import { BRANDING } from '../../config/branding';
import logger from "../../lib/logger";

const FULL_HEIGHT_ROUTES = ['/support', '/admin/agent'];

export const Layout: React.FC = () => {
  const location = useLocation();
  const isFullHeight = FULL_HEIGHT_ROUTES.some(r => location.pathname.startsWith(r));
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/auth');
    } catch (error) {
      logger.error('Sign out error:', error);
    }
  };

  return (
    <div className={`bg-secondary-50 flex flex-col ${isFullHeight ? 'h-screen overflow-hidden' : 'min-h-screen'}`}>
      <header className="bg-surface-card shadow-sm border-b border-secondary-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link to="/" className="hover:opacity-80 transition-opacity">
                <BrandTextLogo />
              </Link>
            </div>

            {user && (
              <div className="flex items-center space-x-2">
                {/* Admin Dashboard Link */}
                {userProfile?.role === 'admin' && (
                  <>
                    <Link
                      to="/admin"
                      className="text-primary-600 hover:text-primary-700 p-2 rounded-lg hover:bg-primary-50 transition-colors"
                      title="Admin Dashboard"
                    >
                      <Shield className="h-5 w-5" />
                    </Link>
                    <NotificationBell />
                  </>
                )}

                {/* Patient Notification Bell */}
                {userProfile?.role === 'patient' && (
                  <NotificationBell />
                )}

                {/* User Profile Link */}
                <Link
                  to="/profile"
                  className="bg-secondary-100 hover:bg-secondary-200 p-2 rounded-full transition-colors"
                  title="Profile"
                >
                  <User className="h-5 w-5 text-secondary-600" />
                </Link>

                {/* Sign Out Button */}
                <button
                  onClick={handleSignOut}
                  className="text-secondary-400 hover:text-secondary-600 p-2 rounded-lg hover:bg-secondary-50 transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={`flex-1 min-h-0 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 ${isFullHeight ? 'flex flex-col overflow-hidden py-4' : 'py-8'}`}>
        <Outlet />
      </main>

      <footer className="border-t border-secondary-200 bg-surface-card mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between space-y-4 sm:space-y-0">
            <div className="flex items-center space-x-6 text-sm text-secondary-500">
              <Link to="/privacy" className="hover:text-secondary-700 transition-colors">Privacy Policy</Link>
              <Link to="/terms" className="hover:text-secondary-700 transition-colors">Terms of Service</Link>
              <Link to="/contact" className="hover:text-secondary-700 transition-colors">Contact</Link>
            </div>
            <p className="text-sm text-secondary-400">
              &copy; {new Date().getFullYear()} {BRANDING.legalEntity}. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

    </div>
  );
};
