import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  MessageSquare,
  Calendar,
  Pill,
  FileText,
  CreditCard,
  Bot,
  Shield,
  User,
  LogOut,
  X,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useFeatures } from '../../hooks/useFeatures';
import { signOut } from '../../lib/firebase';
import { BRANDING } from '../../config/branding';
import { BrandTextLogo } from '../ui/BrandLogo';
import { NotificationBell } from './NotificationBell';
import logger from '../../lib/logger';

type Role = 'admin' | 'assistant' | 'patient';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: Role[];
  featureFlag?: keyof ReturnType<typeof useFeatures>['features'];
  matchPrefix?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: Home },
  { label: 'Messages', href: '/messages', icon: MessageSquare, featureFlag: 'messages' },
  { label: 'Appointments', href: '/appointments', icon: Calendar, featureFlag: 'appointments' },
  { label: 'Refills', href: '/refills', icon: Pill, featureFlag: 'prescriptions' },
  { label: 'Documents', href: '/documents', icon: FileText, featureFlag: 'documents' },
  { label: 'Billing', href: '/billing', icon: CreditCard },
  { label: 'Support', href: '/support', icon: Bot },
  { label: 'Admin', href: '/admin', icon: Shield, roles: ['admin', 'assistant'], matchPrefix: true },
];

interface AppSidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const THEME_STORAGE_KEY = 'patient-theme';

function getCurrentTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'classic';
}

function applyTheme(id: string) {
  if (id === 'classic') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', id);
  }
}

export const AppSidebar: React.FC<AppSidebarProps> = ({ mobileOpen, onMobileClose }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, userProfile } = useAuth();
  const { features } = useFeatures();
  const [theme, setTheme] = useState<string>(getCurrentTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getCurrentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'classic' : 'dark';
    applyTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setTheme(next);
  };

  const role = (userProfile?.role ?? 'patient') as Role;

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/auth');
    } catch (error) {
      logger.error('Sign out error:', error);
    }
  };

  const isActive = (item: NavItem) => {
    if (item.matchPrefix) return location.pathname.startsWith(item.href);
    return location.pathname === item.href;
  };

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.roles && !item.roles.includes(role)) return false;
    if (item.featureFlag && !features[item.featureFlag]) return false;
    return true;
  });

  const sidebarClasses = [
    'flex flex-col shrink-0 w-60 h-full',
    'fixed md:static inset-y-0 left-0 z-40',
    'transition-transform duration-200 ease-out',
    mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
  ].join(' ');

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={sidebarClasses}
        style={{
          background: 'var(--shell-bg)',
          color: 'var(--shell-text)',
          borderRight: '1px solid var(--shell-border)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between h-16 px-4 shrink-0"
          style={{ borderBottom: '1px solid var(--shell-border)' }}
        >
          <Link to="/" className="flex items-center gap-2" onClick={onMobileClose}>
            <BrandTextLogo className="h-8 brightness-0 invert" />
          </Link>
          <button
            type="button"
            onClick={onMobileClose}
            className="md:hidden p-1 rounded hover:bg-white/5"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-0.5">
          {visibleItems.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={onMobileClose}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: active ? 'var(--shell-active-bg)' : 'transparent',
                  color: active ? 'var(--shell-active-text)' : 'var(--shell-text)',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'var(--shell-bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent';
                }}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          className="shrink-0 px-3 py-3 space-y-1"
          style={{ borderTop: '1px solid var(--shell-border)' }}
        >
          {user && (
            <div className="flex items-center gap-1 px-1">
              <div className="flex-1 shell-bell">
                <NotificationBell buttonClassName="p-2 rounded-lg transition-colors" />
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--shell-text)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--shell-bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                {theme === 'dark' ? (
                  <Sun className="h-[18px] w-[18px]" />
                ) : (
                  <Moon className="h-[18px] w-[18px]" />
                )}
              </button>
              <Link
                to="/profile"
                onClick={onMobileClose}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--shell-text)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--shell-bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                title="Profile"
              >
                <User className="h-[18px] w-[18px]" />
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--shell-text)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--shell-bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                title="Sign out"
              >
                <LogOut className="h-[18px] w-[18px]" />
              </button>
            </div>
          )}

          <div
            className="flex flex-wrap gap-x-3 gap-y-1 px-2 pt-2 text-[11px]"
            style={{ color: 'var(--shell-text-muted)' }}
          >
            <Link to="/privacy" className="hover:underline" onClick={onMobileClose}>
              Privacy
            </Link>
            <Link to="/terms" className="hover:underline" onClick={onMobileClose}>
              Terms
            </Link>
            <Link to="/contact" className="hover:underline" onClick={onMobileClose}>
              Contact
            </Link>
          </div>
          <div
            className="px-2 text-[11px]"
            style={{ color: 'var(--shell-text-muted)' }}
          >
            &copy; {new Date().getFullYear()} {BRANDING.legalEntity}
          </div>
        </div>
      </aside>
    </>
  );
};
