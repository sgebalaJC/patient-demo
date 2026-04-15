import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  MessageSquare,
  Calendar,
  Pill,
  FileText,
  CreditCard,
  Bot,
  LogOut,
  X,
  Menu,
  Users,
  Stethoscope,
  Search,
  Zap,
  Settings,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useFeatures } from '../../hooks/useFeatures';
import { signOut } from '../../lib/firebase';
import { BRANDING } from '../../config/branding';
import { BrandLogo } from '../ui/BrandLogo';
import logger from '../../lib/logger';

type Role = 'admin' | 'assistant' | 'patient';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: Role[];
  featureFlag?: keyof ReturnType<typeof useFeatures>['features'];
  featureKey?: 'userManagement';
  matchPrefix?: boolean;
}

const PATIENT_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: Home },
  { label: 'Messages', href: '/messages', icon: MessageSquare, featureFlag: 'messages' },
  { label: 'Appointments', href: '/appointments', icon: Calendar, featureFlag: 'appointments' },
  { label: 'Refills', href: '/refills', icon: Pill, featureFlag: 'prescriptions' },
  { label: 'Documents', href: '/documents', icon: FileText, featureFlag: 'documents' },
  { label: 'Billing', href: '/billing', icon: CreditCard },
  { label: 'Support', href: '/support', icon: Bot },
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: Home },
  { label: 'AI Agent', href: '/admin/agent', icon: Bot, matchPrefix: true },
  { label: 'Dr Chrono', href: '/admin/drchrono', icon: Search },
  { label: 'Users', href: '/admin/users', icon: Users, featureKey: 'userManagement' },
  { label: 'Appointments', href: '/admin/appointments', icon: Calendar, featureFlag: 'appointments' },
  { label: 'Specialist Requests', href: '/admin/specialist-requests', icon: Stethoscope },
  { label: 'Refills', href: '/admin/refills', icon: Pill, featureFlag: 'prescriptions' },
  { label: 'Intake Forms', href: '/admin/intake-forms', icon: FileText, featureFlag: 'patientIntake' },
  { label: 'Subscriptions', href: '/admin/subscription-plans', icon: CreditCard },
  { label: 'Platform Billing', href: '/admin/platform-subscription', icon: Zap },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
];

interface AppSidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const COLLAPSE_STORAGE_KEY = 'patient-sidebar-collapsed';

function getInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
}

export const AppSidebar: React.FC<AppSidebarProps> = ({ mobileOpen, onMobileClose }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, userProfile } = useAuth();
  const { features } = useFeatures();
  const [collapsed, setCollapsed] = useState<boolean>(getInitialCollapsed);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
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

  const isAdminRole = role === 'admin' || role === 'assistant';

  const isActive = (item: NavItem) => {
    // Admin "Dashboard" (/admin) is an exact match so the prefix /admin/users
    // doesn't also highlight it.
    if (item.href === '/admin') return location.pathname === '/admin';
    if (item.matchPrefix) return location.pathname.startsWith(item.href);
    return location.pathname === item.href;
  };

  const sourceItems = isAdminRole ? ADMIN_NAV_ITEMS : PATIENT_NAV_ITEMS;
  const visibleItems = sourceItems.filter((item) => {
    if (item.roles && !item.roles.includes(role)) return false;
    if (item.featureFlag && !features[item.featureFlag]) return false;
    if (item.featureKey === 'userManagement' && !features.userManagement) return false;
    return true;
  });

  // Mobile drawer is always full width when open. Collapse only applies on md+.
  const widthClass = collapsed ? 'w-60 md:w-16' : 'w-60';
  const sidebarClasses = [
    'flex flex-col shrink-0 h-full',
    widthClass,
    'fixed md:static inset-y-0 left-0 z-40',
    'transition-[width,transform] duration-200 ease-out',
    mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
  ].join(' ');

  // Helpers: hide on desktop when collapsed, but keep visible on mobile.
  const labelClass = collapsed ? 'md:hidden whitespace-nowrap' : 'whitespace-nowrap';
  const rowClass = collapsed
    ? 'flex items-center gap-3 px-3 py-2 md:gap-0 md:justify-center md:px-0 rounded-lg text-sm font-medium transition-colors'
    : 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors';

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
        {/* Header — fixed h-14 to match the top header bar */}
        <div
          className={`flex items-center h-14 shrink-0 gap-2 ${
            collapsed ? 'px-4 md:px-0 md:justify-center' : 'px-4 justify-between'
          }`}
          style={{ borderBottom: '1px solid var(--shell-border)' }}
        >
          {/* Logo + name — hidden on desktop when collapsed (kitagents pattern) */}
          <Link
            to="/"
            className={`flex items-center gap-2 min-w-0 flex-1 ${
              collapsed ? 'md:hidden' : ''
            }`}
            onClick={onMobileClose}
          >
            <BrandLogo size="md" />
            <span
              className="text-sm font-semibold tracking-tight truncate whitespace-nowrap"
              style={{ color: 'var(--shell-text-strong)' }}
            >
              {BRANDING.shortName}
              <span
                className="ml-1 font-normal"
                style={{ color: 'var(--shell-text-muted)' }}
              >
                {BRANDING.practiceName.replace(BRANDING.shortName, '').trim()}
              </span>
            </span>
          </Link>
          {/* Mobile close */}
          <button
            type="button"
            onClick={onMobileClose}
            className="md:hidden p-1 rounded hover:bg-white/5"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
          {/* Desktop collapse/expand toggle — always visible on md+ */}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden md:inline-flex items-center justify-center p-2 rounded hover:bg-white/5 shrink-0"
            style={{ color: 'var(--shell-text-muted)' }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Menu className="h-5 w-5" />
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
                className={rowClass}
                title={collapsed ? item.label : undefined}
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
                <span className={labelClass}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User actions: only sign-out remains; notifications + profile moved
            to the top header bar; theme toggle moved to the Profile page. */}
        {user && (
          <>
            <div
              className="shrink-0 px-3 py-2"
              style={{ borderTop: '1px solid var(--shell-border)' }}
            >
              <button
                type="button"
                onClick={handleSignOut}
                className={`w-full ${rowClass}`}
                style={{ color: 'var(--shell-text)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--shell-bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                title="Sign out"
              >
                <LogOut className="h-[18px] w-[18px] shrink-0" />
                <span className={labelClass}>Sign out</span>
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
};
