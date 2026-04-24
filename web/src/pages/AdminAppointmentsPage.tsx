import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuth } from '../hooks/useAuth';
import { useSimulationMode } from '../hooks/useSimulationMode';
import { isAdminRole } from '../lib/roles';
import {
    appointmentOperations,
    notificationOperations,
    prescriptionRefillOperations,
} from '../lib/firestore';
import { Appointment } from '../types';
import { Timestamp } from 'firebase/firestore';
import { Calendar, Clock, Plus, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AdminGuard } from '../components/ui/AdminGuard';
import { PageHeader } from '../components/ui/PageHeader';
import { StatsGrid } from '../components/ui/StatsGrid';
import { PaginationBar } from '../components/ui/PaginationBar';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import {
    AdminAppointmentRow,
    type AdminAppointmentRowData,
} from '../components/appointments/AdminAppointmentRow';
import { AdminCreateAppointmentModal } from '../components/appointments/AdminCreateAppointmentModal';
import { usePagedCollection, type WhereClause } from '../hooks/usePagedCollection';
import { useCollectionCounts } from '../hooks/useCollectionCounts';
import logger from '../lib/logger';

export const AdminAppointmentsPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const { enabled: simulated } = useSimulationMode();
    const isAdminUser = !!user && isAdminRole(userProfile?.role);
    const [filter, setFilter] = useState<'all' | 'upcoming' | 'past' | 'today'>('upcoming');
    const [patientNames, setPatientNames] = useState<Record<string, { firstName: string; lastName: string }>>({});
    // Bumped on Refresh to recompute time windows (now, todayStart, todayEnd)
    // and reload rows + counts with fresh bounds.
    const [timeKey, setTimeKey] = useState(0);
    const [editingReminder, setEditingReminder] = useState<string | null>(null);
    const [reminderText, setReminderText] = useState('');
    const [rejectConfirmId, setRejectConfirmId] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    const { nowTs, todayStartTs, todayEndTs } = useMemo(() => {
        const now = new Date();
        const ts = Timestamp.fromDate(now);
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        return {
            nowTs: ts,
            todayStartTs: Timestamp.fromDate(start),
            todayEndTs: Timestamp.fromDate(end),
        };
    }, [timeKey]);

    const whereClauses = useMemo<WhereClause[] | undefined>(() => {
        switch (filter) {
            case 'upcoming': return [['appointmentDate', '>', nowTs]];
            case 'past':     return [['appointmentDate', '<', nowTs]];
            case 'today':    return [
                ['appointmentDate', '>=', todayStartTs],
                ['appointmentDate', '<=', todayEndTs],
            ];
            case 'all':
            default:         return undefined;
        }
    }, [filter, nowTs, todayStartTs, todayEndTs]);

    const paged = usePagedCollection<Appointment>({
        enabled: isAdminUser,
        real: 'appointments',
        orderField: 'appointmentDate',
        orderDir: 'desc',
        pageSize: 10,
        whereClauses,
        mapDoc: (d) => ({ ...(d.data() as Appointment), id: d.id }),
    });
    const loading = paged.loading;

    const countsPredicates = useMemo(() => ({
        all:      [] as WhereClause[],
        today:    [['appointmentDate', '>=', todayStartTs], ['appointmentDate', '<=', todayEndTs]] as WhereClause[],
        upcoming: [['appointmentDate', '>', nowTs]] as WhereClause[],
        past:     [['appointmentDate', '<', nowTs]] as WhereClause[],
    }), [nowTs, todayStartTs, todayEndTs]);
    const { counts: statusCounts, refresh: refreshCounts } = useCollectionCounts({
        enabled: isAdminUser,
        real: 'appointments',
        predicates: countsPredicates,
    });

    useEffect(() => {
        const ids = [...new Set(paged.rows.map((a) => a.patientId))].filter(
            (id) => !(id in patientNames),
        );
        if (ids.length === 0) return;
        prescriptionRefillOperations.getPatientNamesByIds(ids, simulated).then((res) => {
            if (res.success && res.data) {
                setPatientNames((prev) => ({ ...prev, ...res.data }));
            }
        }).catch((err) => logger.error('patient-name lookup failed', err));
    }, [paged.rows, patientNames, simulated]);

    const appointments: AdminAppointmentRowData[] = paged.rows.map((a) => {
        const n = patientNames[a.patientId];
        const patientName = n ? `${n.firstName} ${n.lastName}`.trim() || 'Unknown Patient' : 'Unknown Patient';
        return { ...a, patientName };
    });

    const refreshAll = () => {
        setTimeKey((k) => k + 1);
        paged.refresh();
        refreshCounts();
    };

    const handleStatusUpdate = async (appointmentId: string, status: Appointment['status']) => {
        try {
            const response = await appointmentOperations.updateAppointment(appointmentId, { status });
            if (response.success) refreshAll();
        } catch (error) {
            logger.error('Error updating appointment status:', error);
        }
    };

    const handleApprove = async (appointmentId: string) => {
        try {
            const updates: Partial<Appointment> = { status: 'confirmed' };
            if (editingReminder === appointmentId && reminderText) {
                updates.reminderMessage = reminderText;
            }
            const response = await appointmentOperations.updateAppointment(appointmentId, updates);
            if (response.success) {
                setEditingReminder(null);
                setReminderText('');

                const appointment = appointments.find((a) => a.id === appointmentId);
                if (appointment) {
                    const apptDate = appointment.appointmentDate.toDate();
                    const formattedDate = apptDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    const formattedTime = apptDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

                    await notificationOperations.createNotification({
                        recipientRole: 'patient',
                        recipientId: appointment.patientId,
                        type: 'appointment_confirmed',
                        title: 'Appointment Confirmed',
                        message: `Your appointment on ${formattedDate} at ${formattedTime} has been approved.`,
                        meta: { appointmentId },
                    });
                }

                refreshAll();
            }
        } catch (error) {
            logger.error('Error approving appointment:', error);
        }
    };

    const handleReject = async (appointmentId: string, reason?: string) => {
        try {
            const updates: Partial<Appointment> = {
                status: 'cancelled',
                notes: reason || undefined,
            };
            const response = await appointmentOperations.updateAppointment(appointmentId, updates);
            if (response.success) {
                setRejectConfirmId(null);
                refreshAll();

                const appointment = appointments.find((a) => a.id === appointmentId);
                if (appointment) {
                    await notificationOperations.createNotification({
                        recipientRole: 'patient',
                        recipientId: appointment.patientId,
                        type: 'appointment_cancelled',
                        title: 'Appointment Not Approved',
                        message: reason ? `Reason: ${reason}` : 'Your appointment request was not approved.',
                        meta: { appointmentId },
                    });
                }
            }
        } catch (error) {
            logger.error('Error rejecting appointment:', error);
        }
    };

    const handleSaveReminder = async (appointmentId: string) => {
        try {
            const response = await appointmentOperations.updateAppointment(appointmentId, {
                reminderMessage: reminderText,
            });
            if (response.success) {
                setEditingReminder(null);
                setReminderText('');
                refreshAll();
            }
        } catch (error) {
            logger.error('Error saving reminder message:', error);
        }
    };

    const handleStartEditReminder = (id: string, initial: string) => {
        setEditingReminder(id);
        setReminderText(initial);
    };

    const handleCancelEditReminder = () => {
        setEditingReminder(null);
        setReminderText('');
    };

    if (loading && paged.rows.length === 0 && paged.page === 1) {
        return <AdminGuard><LoadingSpinner /></AdminGuard>;
    }

    return (
        <AdminGuard>
            <div className="space-y-6">
                <PageHeader
                    backTo="/admin"
                    icon={Calendar}
                    iconColor="bg-primary-100 text-primary-600"
                    title="Appointment Management"
                    subtitle="View and manage all patient appointments"
                    action={
                        <Button onClick={() => setShowCreateModal(true)} className="flex items-center">
                            <Plus className="h-4 w-4 mr-2" />
                            New
                        </Button>
                    }
                />

                <StatsGrid items={[
                    { icon: Clock, iconColor: 'bg-green-100 text-green-600', label: 'Today', value: statusCounts.today },
                    { icon: Calendar, iconColor: 'bg-indigo-100 text-indigo-600', label: 'Upcoming', value: statusCounts.upcoming },
                ]} />

                <Card className="p-6">
                    <div className="space-y-4">
                        <div className="flex space-x-2">
                            {[
                                { key: 'all', label: 'All', count: statusCounts.all },
                                { key: 'today', label: 'Today', count: statusCounts.today },
                                { key: 'upcoming', label: 'Upcoming', count: statusCounts.upcoming },
                                { key: 'past', label: 'Past', count: statusCounts.past },
                            ].map((tab) => (
                                <button
                                    key={tab.key}
                                    onClick={() => setFilter(tab.key as 'all' | 'upcoming' | 'past' | 'today')}
                                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium border transition-colors ${
                                        filter === tab.key
                                            ? 'border-primary-600 text-primary-700 bg-primary-50'
                                            : 'border-transparent bg-secondary-100 text-secondary-700 hover:bg-secondary-200'
                                    }`}
                                >
                                    {tab.label} ({tab.count})
                                </button>
                            ))}
                        </div>
                    </div>
                </Card>

                <div className="flex justify-end">
                    <Button onClick={refreshAll} loading={loading} variant="secondary" size="sm">
                        <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
                    </Button>
                </div>

                <div className={`transition-opacity duration-150 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
                    <Card className="p-6">
                        <div className="space-y-4">
                            {appointments.length === 0 ? (
                                <div className="text-center py-12 text-secondary-500">
                                    <Calendar className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                    <p>No appointments found</p>
                                </div>
                            ) : (
                                appointments.map((appointment) => (
                                    <AdminAppointmentRow
                                        key={appointment.id}
                                        appointment={appointment}
                                        editingReminder={editingReminder}
                                        reminderText={reminderText}
                                        onStartEditReminder={handleStartEditReminder}
                                        onCancelEditReminder={handleCancelEditReminder}
                                        onReminderTextChange={setReminderText}
                                        onSaveReminder={handleSaveReminder}
                                        onApprove={handleApprove}
                                        onReject={(id) => setRejectConfirmId(id)}
                                        onStatusUpdate={handleStatusUpdate}
                                    />
                                ))
                            )}
                        </div>

                        <PaginationBar
                            currentPage={paged.page}
                            pageSize={paged.pageSize}
                            totalItems={(paged.page - 1) * paged.pageSize + appointments.length + (paged.hasNext ? 1 : 0)}
                            hasMore={paged.hasNext}
                            onPreviousPage={paged.prev}
                            onNextPage={paged.next}
                            label="appointments"
                        />
                    </Card>
                </div>

                <AdminCreateAppointmentModal
                    isOpen={showCreateModal}
                    onClose={() => setShowCreateModal(false)}
                    onCreated={refreshAll}
                />

                <ConfirmModal
                    isOpen={!!rejectConfirmId}
                    onClose={() => setRejectConfirmId(null)}
                    onConfirm={(reason) => rejectConfirmId && handleReject(rejectConfirmId, reason)}
                    title="Reject Appointment"
                    message="Are you sure you want to reject this appointment request? The patient will be notified."
                    confirmLabel="Reject"
                    variant="danger"
                    inputPrompt="Reason for rejection (optional)"
                    inputPlaceholder="e.g., No availability at that time..."
                />
            </div>
        </AdminGuard>
    );
};
