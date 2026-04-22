import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Menu, User as UserIcon, FlaskConical } from 'lucide-react';
import { AppSidebar } from './AppSidebar';
import { BrandLogo } from '../ui/BrandLogo';
import { BRANDING } from '../../config/branding';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from '../ui/ThemeSelector';
import { SimulationToggle } from '../ui/SimulationToggle';
import { useAuth } from '../../hooks/useAuth';
import { useSimulationMode } from '../../hooks/useSimulationMode';

const FULL_HEIGHT_ROUTES = ['/support', '/admin/agent'];

export const Layout: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const { enabled: simulated } = useSimulationMode();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const isFullHeight = FULL_HEIGHT_ROUTES.some((r) => location.pathname.startsWith(r));

  return (
    <div className="flex h-screen overflow-hidden bg-secondary-50 min-w-0">
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
                <SimulationToggle className="mr-1" />
                <div className="shell-bell">
                  <NotificationBell buttonClassName="p-2 rounded-lg transition-colors hover:bg-white/10" />
                </div>
                <ThemeToggle className="shell-icon-btn p-2 rounded-lg transition-colors" />
                <Link
                  to="/profile"
                  className="shell-icon-btn p-2 rounded-lg transition-colors"
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

        {simulated && (
          <div
            className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium shrink-0"
            style={{
              background: 'rgba(217, 119, 6, 0.1)',
              color: 'rgb(146, 64, 14)',
              borderBottom: '1px solid rgba(217, 119, 6, 0.2)',
            }}
            role="status"
            aria-label="Simulation mode banner"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            <span>
              Simulation mode — you're seeing sandbox data. Integration calls don't reach real services.
            </span>
          </div>
        )}

        <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {isFullHeight ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <Outlet />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="max-w-screen-2xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 lg:min-w-[1280px]">
                <Outlet />
              </div>
            </div>
          )}
        </main>

        {/* Footer — now inside the content column so the sidebar stretches
            full-height and its Sign out button anchors to the viewport bottom.
            Three-column grid: spacer | centered links | right-aligned copyright. */}
        <footer
          className="shrink-0 grid grid-cols-3 items-center px-4 sm:px-6 h-14 text-sm"
          style={{
            background: 'var(--shell-bg)',
            color: 'var(--shell-text-muted)',
            borderTop: '1px solid var(--shell-border)',
          }}
        >
          <span className="justify-self-start whitespace-nowrap">
            &copy; {new Date().getFullYear()} {BRANDING.appName}
          </span>
          <div className="flex items-center justify-center gap-4">
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
          <span />
        </footer>
      </div>
    </div>
  );
};
