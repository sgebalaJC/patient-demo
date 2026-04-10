import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card } from '../ui/Card';
import { useFeatures } from '../../hooks/useFeatures';
import {
    Calendar,
    MessageSquare,
    FileText,
    Users,
    Pill,
    Zap,
    Headphones,
    CreditCard
} from 'lucide-react';

export const PatientQuickActions: React.FC = () => {
    const location = useLocation();
    const { features } = useFeatures();

    const quickLinks = [
        { title: 'Appointments', href: '/appointments', icon: Calendar, isActive: features.appointments },
        { title: 'Messages', href: '/messages', icon: MessageSquare, isActive: features.messages },
        { title: 'Documents', href: '/documents', icon: FileText, isActive: features.documents },
        { title: 'Refill Requests', href: '/refills', icon: Pill, isActive: features.prescriptions },
        { title: 'Intake Forms', href: '/intake', icon: Users, isActive: features.patientIntake },
        { title: 'Membership', href: '/billing', icon: CreditCard, isActive: true },
        { title: 'Support Chat', href: '/support', icon: Headphones, isActive: true },
    ];

    return (
        <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-secondary-900 mb-4 flex items-center">
                <Zap className="h-5 w-5 mr-2 text-primary-600" />
                Quick Actions
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {quickLinks
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
