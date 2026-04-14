import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Calendar,
  Stethoscope,
  Pill,
  CheckSquare,
  FileText,
  Bot,
  Mail,
  CreditCard,
  Settings,
} from 'lucide-react';
import { useFeatures } from '../../hooks/useFeatures';

interface AdminNavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  visible: boolean;
  matchPrefix?: boolean;
}

export const AdminSidebar: React.FC = () => {
  const location = useLocation();
  const { features, canUseAdminTodos } = useFeatures();

  const items: AdminNavItem[] = [
    { label: 'Overview', href: '/admin', icon: LayoutDashboard, visible: true },
    { label: 'Users', href: '/admin/users', icon: Users, visible: features.userManagement },
    { label: 'Appointments', href: '/admin/appointments', icon: Calendar, visible: features.appointments },
    { label: 'Specialist Requests', href: '/admin/specialist-requests', icon: Stethoscope, visible: true },
    { label: 'Refills', href: '/admin/refills', icon: Pill, visible: features.prescriptions },
    { label: 'To-Do List', href: '/admin/todos', icon: CheckSquare, visible: canUseAdminTodos() },
    { label: 'Intake Forms', href: '/admin/intake-forms', icon: FileText, visible: features.patientIntake },
    { label: 'AI Agent', href: '/admin/agent', icon: Bot, visible: true, matchPrefix: true },
    { label: 'DrChrono CSV', href: '/admin/drchrono-csv', icon: Mail, visible: true, matchPrefix: true },
    { label: 'Subscriptions', href: '/admin/subscription-plans', icon: CreditCard, visible: true },
    { label: 'Settings', href: '/admin/settings', icon: Settings, visible: true },
  ];

  const isActive = (item: AdminNavItem) => {
    if (item.href === '/admin') return location.pathname === '/admin';
    if (item.matchPrefix) return location.pathname.startsWith(item.href);
    return location.pathname === item.href;
  };

  const visibleItems = items.filter((i) => i.visible);
  const activeItem = visibleItems.find(isActive) ?? visibleItems[0];

  return (
    <>
      {/* Desktop sub-sidebar */}
      <aside
        className="hidden md:flex flex-col shrink-0 w-56 h-full"
        style={{
          background: 'var(--shell-bg)',
          color: 'var(--shell-text)',
          borderRight: '1px solid var(--shell-border)',
        }}
      >
        <div
          className="px-4 h-16 flex items-center shrink-0"
          style={{ borderBottom: '1px solid var(--shell-border)' }}
        >
          <span
            className="text-[11px] font-semibold tracking-wider uppercase"
            style={{ color: 'var(--shell-text-muted)' }}
          >
            Admin
          </span>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-0.5">
          {visibleItems.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
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
      </aside>

      {/* Mobile: dropdown selector at the top of admin pages */}
      <div
        className="md:hidden px-4 py-3 flex items-center gap-2 shrink-0"
        style={{
          background: 'var(--surface-card)',
          borderBottom: '1px solid var(--secondary-200)',
        }}
      >
        <label
          htmlFor="admin-section-picker"
          className="text-xs font-semibold uppercase tracking-wider text-secondary-500"
        >
          Admin
        </label>
        <select
          id="admin-section-picker"
          value={activeItem.href}
          onChange={(e) => {
            window.location.assign(e.target.value);
          }}
          className="flex-1 rounded-lg border border-secondary-200 bg-surface-card px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {visibleItems.map((item) => (
            <option key={item.href} value={item.href}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
};
