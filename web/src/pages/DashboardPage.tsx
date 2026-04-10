import React, { useState, useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { useAuth } from '../hooks/useAuth';
import { useFeatures } from '../hooks/useFeatures';
import { messageThreadOperations, appointmentOperations } from '../lib/firestore';
import { MessageThread, Appointment } from '../types';
import { EmailVerificationBanner } from '../components/EmailVerificationBanner';
import { PatientQuickActions } from '../components/patient/PatientQuickActions';
import {
    Calendar,
    MessageSquare,
    Clock,
    Phone,
    ArrowRight,
    Loader,
} from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';
import logger from "../lib/logger";
import { OnboardingTutorial } from '../components/onboarding/OnboardingTutorial';
import { IntakeFormBanner } from '../components/onboarding/IntakeFormBanner';

export const DashboardPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const { features } = useFeatures();
    const [recentMessages, setRecentMessages] = useState<MessageThread[]>([]);
    const [upcomingAppointments, setUpcomingAppointments] = useState<Appointment[]>([]);
    const [messagesLoading, setMessagesLoading] = useState(true);
    const [appointmentsLoading, setAppointmentsLoading] = useState(true);

    const fetchRecentMessages = async () => {
        if (!user || !userProfile) return;

        setMessagesLoading(true);
        try {
            const response = await messageThreadOperations.getPatientThreads(user.uid, 10, 1, 'all');

            if (response.success && response.data) {
                const recent = response.data.threads
                    .sort((a: MessageThread, b: MessageThread) => {
                        const aTime = a.lastMessageAt?.toMillis() || 0;
                        const bTime = b.lastMessageAt?.toMillis() || 0;
                        return bTime - aTime;
                    })
                    .slice(0, 3);
                setRecentMessages(recent);
            }
        } catch (error) {
            logger.error('Error fetching recent messages:', error);
        } finally {
            setMessagesLoading(false);
        }
    };

    const fetchUpcomingAppointments = async () => {
        if (!user || !userProfile) return;

        setAppointmentsLoading(true);
        try {
            const response = await appointmentOperations.getUserAppointments(user.uid);

            if (response.success && response.data) {
                const now = new Date();

                const appointmentsList = Array.isArray(response.data)
                    ? response.data
                    : response.data.appointments || [];

                const upcoming = appointmentsList
                    .filter((appointment: Appointment) => {
                        const appointmentDate = appointment.appointmentDate.toDate();
                        return appointmentDate > now;
                    })
                    .sort((a: Appointment, b: Appointment) => {
                        const aTime = a.appointmentDate.toMillis();
                        const bTime = b.appointmentDate.toMillis();
                        return aTime - bTime;
                    })
                    .slice(0, 3);

                setUpcomingAppointments(upcoming);
            }
        } catch (error) {
            logger.error('Error fetching upcoming appointments:', error);
        } finally {
            setAppointmentsLoading(false);
        }
    };

    useEffect(() => {
        if (user && userProfile) {
            if (features.messages) {
                fetchRecentMessages();
            }
            if (features.appointments) {
                fetchUpcomingAppointments();
            }
        }
    }, [user, userProfile, features.messages, features.appointments]);

    // Redirect admin users to admin dashboard (AFTER all hooks are called)
    if (userProfile?.role === 'admin') {
        return <Navigate to="/admin" replace />;
    }

    return (
        <div className="space-y-6">
            <OnboardingTutorial />
            <EmailVerificationBanner />
            <IntakeFormBanner />

            {/* Phone verification prompt — non-blocking */}
            {userProfile && !userProfile.phoneVerified && userProfile.phoneNumber && (
                <Link
                    to="/profile"
                    className="flex items-center justify-between p-4 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors"
                >
                    <div className="flex items-center space-x-3">
                        <Phone className="h-5 w-5 text-primary-600" />
                        <p className="text-sm text-primary-800">
                            <span className="font-medium">Verify your phone number</span> to receive appointment reminders via SMS
                        </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-primary-600 flex-shrink-0" />
                </Link>
            )}

            <div>
                <h1 className="text-xl font-bold text-secondary-900">
                    Welcome back, {userProfile ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || userProfile.firstName || 'User' : 'User'}
                </h1>
                <p className="text-secondary-600 mt-2">
                    Here's an overview of your health information.
                </p>
            </div>

            <div className={`grid gap-6 ${features.appointments && features.messages ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
                {/* Upcoming Appointments */}
                {features.appointments && (
                    <Card className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-secondary-900 flex items-center">
                                <Calendar className="h-5 w-5 mr-2 text-primary-600" />
                                Upcoming Appointments
                            </h2>
                            <Link to="/appointments" className="text-primary-600 hover:text-primary-700 text-sm font-medium">
                                View all
                            </Link>
                        </div>
                        <div className="space-y-3 min-h-[280px]">
                            {appointmentsLoading ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader className="h-6 w-6 animate-spin text-primary-500" />
                                </div>
                            ) : upcomingAppointments.length > 0 ? (
                                upcomingAppointments.map((appointment) => {
                                    const appointmentDate = appointment.appointmentDate.toDate();
                                    const isToday = appointmentDate.toDateString() === new Date().toDateString();

                                    return (
                                        <Link
                                            key={appointment.id}
                                            to="/appointments"
                                            className="block p-3 bg-surface-card border border-secondary-200 rounded-lg hover:bg-secondary-100 transition-colors"
                                        >
                                            <div className="flex items-center justify-between">
                                                {/* Left: clock icon + date & time */}
                                                <div className="flex items-center space-x-3">
                                                    <div className="flex items-center justify-center w-10 h-10 bg-primary-100 rounded-full">
                                                        <Clock className="h-5 w-5 text-primary-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-secondary-900">
                                                            {isToday ? 'Today' : appointmentDate.toLocaleDateString('en-US', {
                                                                month: 'short',
                                                                day: 'numeric'
                                                            })}
                                                            {' · '}
                                                            {appointmentDate.toLocaleTimeString('en-US', {
                                                                hour: 'numeric',
                                                                minute: '2-digit'
                                                            })}
                                                        </p>
                                                    </div>
                                                </div>
                                                {/* Right: type + status */}
                                                <div className="flex flex-col items-end space-y-1">
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                                                        {appointment.appointmentType || 'appointment'}
                                                    </span>
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                        appointment.status === 'confirmed'
                                                            ? 'bg-green-100 text-green-800'
                                                            : appointment.status === 'cancelled'
                                                                ? 'bg-red-100 text-red-800'
                                                                : appointment.status === 'scheduled'
                                                                    ? 'bg-blue-100 text-blue-800'
                                                                    : 'bg-yellow-100 text-yellow-800'
                                                    }`}>
                                                        {appointment.status}
                                                    </span>
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })
                            ) : (
                                <EmptyState
                                    icon={Calendar}
                                    title="No upcoming appointments"
                                    inline
                                    action={
                                        <Link to="/appointments" className="text-primary-600 hover:text-primary-700 text-sm">
                                            Schedule an appointment
                                        </Link>
                                    }
                                />
                            )}
                        </div>
                    </Card>
                )}

                {/* Recent Messages */}
                {features.messages && (
                    <Card className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-secondary-900 flex items-center">
                                <MessageSquare className="h-5 w-5 mr-2 text-primary-600" />
                                Recent Messages
                            </h2>
                            <Link to="/messages" className="text-primary-600 hover:text-primary-700 text-sm font-medium">
                                View all
                            </Link>
                        </div>
                        <div className="space-y-3 min-h-[280px]">
                            {messagesLoading ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader className="h-6 w-6 animate-spin text-primary-500" />
                                </div>
                            ) : recentMessages.length > 0 ? (
                                recentMessages.map((thread) => {
                                    const isUnread = thread.unreadForPatient;
                                    const lastMessageTime = thread.lastMessageAt?.toDate();

                                    return (
                                        <Link
                                            key={thread.id}
                                            to={`/messages?thread=${thread.id}`}
                                            className={`block p-3 rounded-lg transition-colors ${
                                                isUnread ? 'bg-green-50 border border-green-200 hover:bg-green-100' : 'bg-surface-card border border-secondary-200 hover:bg-secondary-100'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    <div className="flex items-center space-x-2">
                                                        <p className="font-medium text-secondary-900">{thread.subject}</p>
                                                        {isUnread && (
                                                            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-secondary-600 mt-1 line-clamp-2">
                                                        {thread.lastMessage || 'No messages yet'}
                                                    </p>
                                                </div>
                                                <div className="text-right ml-2">
                                                    <p className="text-xs text-secondary-600">
                                                        {lastMessageTime ? (
                                                            lastMessageTime.toLocaleDateString() === new Date().toLocaleDateString()
                                                                ? lastMessageTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                                                                : lastMessageTime.toLocaleDateString()
                                                        ) : 'No date'}
                                                    </p>
                                                    {isUnread && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 mt-1">
                              New
                            </span>
                                                    )}
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })
                            ) : (
                                <EmptyState
                                    icon={MessageSquare}
                                    title="No recent messages"
                                    inline
                                    action={
                                        <Link to="/messages" className="text-primary-600 hover:text-primary-700 text-sm">
                                            Go to Messages
                                        </Link>
                                    }
                                />
                            )}
                        </div>
                    </Card>
                )}
            </div>

            {/* Quick Actions - Now using the new component */}
            <PatientQuickActions />
        </div>
    );
};