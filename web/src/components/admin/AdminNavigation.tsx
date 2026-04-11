import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card } from '../ui/Card';
import { useFeatures } from '../../hooks/useFeatures';
import {
  Shield,
  Users,
  Calendar,
  MessageSquare,
  CheckSquare,
  Pill,
  Bot,
  FileText,
  Stethoscope,
  Settings,
  CreditCard,
} from 'lucide-react';

export const AdminNavigation: React.FC = () => {
  const location = useLocation();
  const { features, canUseAdminTodos } = useFeatures();

  const adminLinks = [
    { title: 'User Management', href: '/admin/users', icon: Users, isActive: features.userManagement },
    { title: 'Appointments', href: '/admin/appointments', icon: Calendar, isActive: features.appointments },
    { title: 'Specialist Requests', href: '/admin/specialist-requests', icon: Stethoscope, isActive: true },
    { title: 'Messages', href: '/messages', icon: MessageSquare, isActive: features.messages },
    { title: 'Prescription Refills', href: '/admin/refills', icon: Pill, isActive: true },
    { title: 'To-Do List', href: '/admin/todos', icon: CheckSquare, isActive: canUseAdminTodos() },
    { title: 'Intake Forms', href: '/admin/intake-forms', icon: FileText, isActive: true },
    { title: 'AI Agent', href: '/admin/agent', icon: Bot, isActive: true },
    { title: 'Subscription Plans', href: '/admin/subscription-plans', icon: CreditCard, isActive: true },
    { title: 'Settings', href: '/admin/settings', icon: Settings, isActive: true },
  ];

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-secondary-900 mb-4 flex items-center">
        <Shield className="h-5 w-5 mr-2 text-primary-600" />
        Admin Tools
      </h2>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {adminLinks
          .filter((link) => link.isActive)
          .map((link) => {
            const isCurrentPage = location.pathname === link.href;

            return (
              <Link
                key={link.href}
                to={link.href}
                className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-all duration-200 ${
                  isCurrentPage
                    ? 'bg-primary-50 border-primary-200 ring-2 ring-primary-500/20 ring-offset-2'
                    : 'bg-primary-50/50 border-primary-100/60 hover:border-primary-200 hover:bg-primary-50 hover:shadow-md hover:-translate-y-0.5'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center mb-2">
                  <link.icon className="h-5 w-5 text-primary-600" />
                </div>
                <span className="text-xs font-medium text-secondary-700 text-center leading-tight">
                  {link.title}
                </span>
              </Link>
            );
          })}
      </div>
    </Card>
  );
};
