import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Menu, User as UserIcon } from 'lucide-react';
import { AppSidebar } from './AppSidebar';
import { BrandLogo } from '../ui/BrandLogo';
import { BRANDING } from '../../config/branding';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from '../ui/ThemeSelector';
import { useAuth } from '../../hooks/useAuth';

const FULL_HEIGHT_ROUTES = ['/support', '/admin/agent'];

export const Layout: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const isAdminRoute = location.pathname.startsWith('/admin');
  const isFullHeight = FULL_HEIGHT_ROUTES.some((r) => location.pathname.startsWith(r));

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-secondary-50">
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <AppSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Top header bar (always visible) */}
          <div
            className="flex items-center h-14 px-3 sm:px-4 shrink-0 gap-2"
            style={{
              background: 'var(--shell-bg)',
              color: 'var(--shell-text)',
              borderBottom: '1px solid var(--shell-border)',
            }}
          >
            {/* Mobile: hamburger + brand */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 rounded-lg hover:bg-white/10"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link to="/" className="md:hidden flex items-center gap-2 min-w-0">
              <BrandLogo size="sm" />
              <span
                className="text-sm font-semibold truncate"
                style={{ color: 'var(--shell-text-strong)' }}
              >
                {BRANDING.shortName}
              </span>
            </Link>

            {/* Right-aligned actions */}
            <div className="ml-auto flex items-center gap-1">
              {user && (
                <>
                  <div className="shell-bell">
                    <NotificationBell buttonClassName="p-2 rounded-lg transition-colors hover:bg-white/10" />
                  </div>
                  <ThemeToggle className="p-2 rounded-lg transition-colors hover:bg-white/10" />
                  <Link
                    to="/profile"
                    className="p-2 rounded-lg transition-colors hover:bg-white/10"
                    style={{ color: 'var(--shell-text)' }}
                    title="Profile"
                    aria-label="Profile"
                  >
                    <UserIcon className="h-[18px] w-[18px]" />
                  </Link>
                </>
              )}
            </div>
          </div>

          <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {isAdminRoute ? (
              <Outlet />
            ) : isFullHeight ? (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <Outlet />
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
                  <Outlet />
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Full-width footer */}
      <footer
        className="shrink-0 flex flex-col items-center gap-1 px-4 sm:px-6 py-2 text-[11px]"
        style={{
          background: 'var(--shell-bg)',
          color: 'var(--shell-text-muted)',
          borderTop: '1px solid var(--shell-border)',
        }}
      >
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link to="/privacy" className="hover:underline">
            Privacy
          </Link>
          <Link to="/terms" className="hover:underline">
            Terms
          </Link>
          <Link to="/contact" className="hover:underline">
            Contact
          </Link>
        </div>
        <span>
          &copy; {new Date().getFullYear()} {BRANDING.legalEntity}
        </span>
      </footer>
    </div>
  );
};
