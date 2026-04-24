import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSimulationMode } from '../hooks/useSimulationMode';
import { useFeatures } from '../hooks/useFeatures';
import { isAdminRole } from '../lib/roles';
import { Card } from '../components/ui/Card';
import { messageThreadOperations, prescriptionRefillOperations } from '../lib/firestore';
import { MessageThread, PrescriptionRefillRequest } from '../types';
import {
    Shield,
    MessageSquare,
    Pill,
    Clock,
    User
} from 'lucide-react';
import { AdminGuard } from '../components/ui/AdminGuard';
import { getRefillStatusColor, getThreadStatusColor, getPriorityBadgeColor } from '../lib/status-helpers';
import { StatusBadge } from '../components/ui/StatusBadge';
import { formatRelative } from '../lib/date-helpers';
import logger from "../lib/logger";

export const AdminDashboardPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const { enabled: simulated } = useSimulationMode();
    const { features } = useFeatures();
    const [recentMessages, setRecentMessages] = useState<MessageThread[]>([]);
    const [recentRefills, setRecentRefills] = useState<PrescriptionRefillRequest[]>([]);
    const [patientNames, setPatientNames] = useState<{ [patientId: string]: { firstName: string; lastName: string } }>({});

    const fetchRecentMessages = async () => {
        if (!user || !userProfile) return;

        try {
            const response = await messageThreadOperations.getAdminThreads(10, 1, 'all', user.uid);

            if (response.success && response.data) {
                // Get the 3 most recent threads
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
        }
    };

    const fetchRecentRefills = async () => {
        if (!user || !userProfile) return;

        try {
            const response = await prescriptionRefillOperations.getAllRefills(10, undefined, 'all');

            if (response.success && response.data) {
                // Get the 3 most recent refill requests
                const recent = response.data.refills
                    .sort((a, b) => {
                        const aTime = a.createdAt?.toMillis() || 0;
                        const bTime = b.createdAt?.toMillis() || 0;
                        return bTime - aTime;
                    })
                    .slice(0, 3);
                setRecentRefills(recent);

                // Fetch patient names for these refills
                const patientIds = [...new Set(recent.map(r => r.patientId))];
                if (patientIds.length > 0) {
                    const namesResponse = await prescriptionRefillOperations.getPatientNamesByIds(patientIds, simulated);
                    if (namesResponse.success && namesResponse.data) {
                        setPatientNames(namesResponse.data);
                    }
                }
            }
        } catch (error) {
            logger.error('Error fetching recent refills:', error);
        }
    };

    useEffect(() => {
        if (user && isAdminRole(userProfile?.role)) {
            if (features.messages) {
                fetchRecentMessages();
            }
            if (features.prescriptions) {
                fetchRecentRefills();
            }
        }
    }, [user, userProfile, features.messages, features.prescriptions]);

    const getStatusColor = getRefillStatusColor;

    return (
        <AdminGuard>
        <div className="flex flex-col gap-4 h-full">
            <div>
                <h1 className="text-3xl font-bold text-secondary-900 flex items-center">
                    <Shield className="h-8 w-8 mr-3 text-primary-600" />
                    Admin Dashboard
                </h1>
                <p className="text-secondary-600 mt-1">
                    Platform overview and management tools
                </p>
            </div>

            {/* Recent Activity Section — two stacked sections, each 50% of remaining height */}
            <div className="grid gap-4 grid-cols-1 grid-rows-2 flex-1 min-h-0">
                {/* Recent Messages */}
                {features.messages && (
                    <Card className="p-4 flex flex-col min-h-0 overflow-hidden">
                        <div className="flex items-center justify-between mb-3 shrink-0">
                            <h2 className="text-lg font-semibold text-secondary-900 flex items-center">
                                <MessageSquare className="h-5 w-5 mr-2 text-primary-600" />
                                Recent Messages
                            </h2>
                            <Link to="/messages" className="text-primary-600 hover:text-primary-700 text-sm font-medium">
                                View all
                            </Link>
                        </div>
                        <div className="space-y-3 flex-1 min-h-0 overflow-y-auto">
                            {recentMessages.length > 0 ? (
                                recentMessages.map((thread) => {
                                    const isUnread = thread.unreadForAdmin;
                                    const lastMessageTime = thread.lastMessageAt?.toDate();

                                    return (
                                        <Link
                                            key={thread.id}
                                            to="/messages"
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
                                                    <div className="flex items-center mt-1 space-x-2">
                                                        <StatusBadge label={thread.status.replace('_', ' ')} colorClass={getThreadStatusColor(thread.status)} />
                                                        {(thread.priority === 'high' || thread.priority === 'urgent') && (
                                                            <StatusBadge label={thread.priority} colorClass={getPriorityBadgeColor(thread.priority)} />
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="text-right ml-2">
                                                    <p className="text-xs text-secondary-600">
                                                        {lastMessageTime ? formatRelative(lastMessageTime) : 'No date'}
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
                                <p className="text-sm text-secondary-400 text-center py-8">No recent messages</p>
                            )}
                        </div>
                    </Card>
                )}

                {/* Recent Refill Requests */}
                {features.prescriptions && (
                    <Card className="p-4 flex flex-col min-h-0 overflow-hidden">
                        <div className="flex items-center justify-between mb-3 shrink-0">
                            <h2 className="text-lg font-semibold text-secondary-900 flex items-center">
                                <Pill className="h-5 w-5 mr-2 text-primary-600" />
                                Recent Refill Requests
                            </h2>
                            <Link to="/admin/refills" className="text-primary-600 hover:text-primary-700 text-sm font-medium">
                                View all
                            </Link>
                        </div>
                        <div className="space-y-3 flex-1 min-h-0 overflow-y-auto">
                            {recentRefills.length > 0 ? (
                                recentRefills.map((refill) => {
                                    const patientName = patientNames[refill.patientId];
                                    const createdTime = refill.createdAt?.toDate();
                                    const isPending = refill.status === 'pending';

                                    return (
                                        <Link
                                            key={refill.id}
                                            to="/admin/refills"
                                            className={`block p-3 rounded-lg transition-colors ${
                                                isPending ? 'bg-yellow-50 border border-yellow-200 hover:bg-yellow-100' : 'bg-secondary-50 hover:bg-secondary-100'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    <div className="flex items-center space-x-2 mb-1">
                                                        <User className="h-4 w-4 text-secondary-400" />
                                                        <p className="font-medium text-secondary-900">
                                                            {patientName
                                                                ? `${patientName.firstName} ${patientName.lastName}`
                                                                : 'Loading patient...'
                                                            }
                                                        </p>
                                                    </div>
                                                    <p className="text-sm font-medium text-secondary-700 mb-1">
                                                        {refill.medicationName}
                                                    </p>
                                                    <div className="flex items-center space-x-2">
                                                        <StatusBadge label={refill.status} colorClass={getStatusColor(refill.status)} />
                                                        <StatusBadge label={refill.urgency} colorClass={getPriorityBadgeColor(refill.urgency === 'urgent' ? 'urgent' : refill.urgency === 'routine' ? 'low' : 'medium')} />
                                                    </div>
                                                </div>
                                                <div className="text-right ml-2">
                                                    <div className="flex items-center text-xs text-secondary-600">
                                                        <Clock className="h-3 w-3 mr-1" />
                                                        {createdTime ? formatRelative(createdTime) : 'No date'}
                                                    </div>
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })
                            ) : (
                                <p className="text-sm text-secondary-400 text-center py-8">No recent refill requests</p>
                            )}
                        </div>
                    </Card>
                )}
            </div>

        </div>
        </AdminGuard>
    );
};