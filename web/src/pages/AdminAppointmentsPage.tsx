import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';
import {
    appointmentOperations,
    notificationOperations,
    userOperations,
    prescriptionRefillOperations,
} from '../lib/firestore';
import { Appointment, User as UserType } from '../types';
import { Timestamp } from 'firebase/firestore';
import { Modal } from '../components/ui/Modal';
import {
    Calendar,
    Clock,
    User,
    CheckCircle,
    XCircle,
    MessageSquare,
    Save,
    X,
    Plus,
    Loader,
    RefreshCw,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AdminGuard } from '../components/ui/AdminGuard';
import { PageHeader } from '../components/ui/PageHeader';
import { StatsGrid } from '../components/ui/StatsGrid';
import { PaginationBar } from '../components/ui/PaginationBar';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { getAppointmentStatusColor, getAppointmentStatusIcon } from '../lib/status-helpers';
import { formatDate, formatTime } from '../lib/date-helpers';
import { getSpecialistLabel } from '../config/specialists';
import { BUSINESS } from '../config/branding';
import { usePagedCollection, type WhereClause } from '../hooks/usePagedCollection';
import { useCollectionCounts } from '../hooks/useCollectionCounts';
import logger from '../lib/logger';

type AppointmentWithPatient = Appointment & { patientName: string };

export const AdminAppointmentsPage: React.FC = () => {
    const { user, userProfile } = useAuth();
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
    const [patients, setPatients] = useState<UserType[]>([]);
    const [patientSearch, setPatientSearch] = useState('');
    const [patientDropdownOpen, setPatientDropdownOpen] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState<UserType | null>(null);
    const [createSlots, setCreateSlots] = useState<{ time: string; available: boolean }[]>([]);
    const [createSlotsLoading, setCreateSlotsLoading] = useState(false);
    const [createForm, setCreateForm] = useState({
        patientId: '',
        appointmentDate: '',
        appointmentTime: '',
        appointmentType: 'consultation' as Appointment['appointmentType'],
        reminderMessage: '',
    });
    const [creating, setCreating] = useState(false);

    // Time window values — snapshotted per timeKey bump; Refresh bumps timeKey
    // to recompute them. Computed at render (stable through memo) so Firestore
    // query identity stays stable across re-renders while filter is constant.
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

    // Fetch names only for patients on the current page.
    useEffect(() => {
        const ids = [...new Set(paged.rows.map((a) => a.patientId))].filter(
            (id) => !(id in patientNames),
        );
        if (ids.length === 0) return;
        prescriptionRefillOperations.getPatientNamesByIds(ids).then((res) => {
            if (res.success && res.data) {
                setPatientNames((prev) => ({ ...prev, ...res.data }));
            }
        }).catch((err) => logger.error('patient-name lookup failed', err));
    }, [paged.rows, patientNames]);

    const appointments: AppointmentWithPatient[] = paged.rows.map((a) => {
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
            if (response.success) {
                refreshAll();
            }
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

                // Notify the patient
                const appointment = appointments.find(a => a.id === appointmentId);
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

                // Notify the patient
                const appointment = appointments.find(a => a.id === appointmentId);
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

    const handleOpenCreate = async () => {
        setShowCreateModal(true);
        setSelectedPatient(null);
        setPatientSearch('');
        setCreateSlots([]);
        setCreateForm({ patientId: '', appointmentDate: '', appointmentTime: '', appointmentType: 'consultation', reminderMessage: '' });
        if (patients.length === 0) {
            const res = await userOperations.getAllUsers(100, 1);
            if (res.success && res.data) {
                setPatients(res.data.users.filter(u => u.role === 'patient'));
            }
        }
    };

    const filteredPatients = patientSearch.length >= 1
        ? patients.filter(p => {
            const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
            const email = (p.email || '').toLowerCase();
            const q = patientSearch.toLowerCase();
            return fullName.includes(q) || email.includes(q);
        }).slice(0, 8)
        : [];

    const handleSelectPatient = (p: UserType) => {
        setSelectedPatient(p);
        setPatientSearch(`${p.firstName} ${p.lastName}`);
        setPatientDropdownOpen(false);
        setCreateForm(f => ({ ...f, patientId: p.id }));
    };

    const fetchCreateSlots = useCallback(async (date: string) => {
        if (!date) return;
        setCreateSlotsLoading(true);
        try {
            const fn = httpsCallable(functions, 'getAvailableSlots');
            const result = await fn({ date }) as { data: { success: boolean; slots: { time: string; available: boolean }[] } };
            if (result.data.success) {
                setCreateSlots(result.data.slots);
            } else {
                setCreateSlots(generateAllSlots());
            }
        } catch {
            setCreateSlots(generateAllSlots());
        } finally {
            setCreateSlotsLoading(false);
        }
    }, []);

    const generateAllSlots = (): { time: string; available: boolean }[] => {
        const result: { time: string; available: boolean }[] = [];
        for (let hour = 9; hour <= 17; hour++) {
            for (const min of [0, 20, 40]) {
                if (hour === 17 && min > 40) continue;
                result.push({ time: `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`, available: true });
            }
        }
        return result;
    };

    const formatSlotTime = (time: string): string => {
        const [h, m] = time.split(':');
        const hour = parseInt(h);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
        return `${display}:${m} ${ampm}`;
    };

    const handleCreateAppointment = async () => {
        if (!createForm.patientId || !createForm.appointmentDate || !createForm.appointmentTime) return;
        setCreating(true);
        try {
            const dateTime = new Date(`${createForm.appointmentDate}T${createForm.appointmentTime}`);
            const response = await appointmentOperations.createAppointment({
                patientId: createForm.patientId,
                appointmentDate: Timestamp.fromDate(dateTime),
                status: 'confirmed',
                appointmentType: createForm.appointmentType,
                reminderSent: false,
                reminderMessage: createForm.reminderMessage || undefined,
            });
            if (response.success) {
                setShowCreateModal(false);
                setCreateForm({ patientId: '', appointmentDate: '', appointmentTime: '', appointmentType: 'consultation', reminderMessage: '' });
                refreshAll();
            }
        } catch (error) {
            logger.error('Error creating appointment:', error);
        } finally {
            setCreating(false);
        }
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
                <Button onClick={handleOpenCreate} className="flex items-center">
                  <Plus className="h-4 w-4 mr-2" />
                  New
                </Button>
              }
            />

            <StatsGrid items={[
              { icon: Clock, iconColor: 'bg-green-100 text-green-600', label: 'Today', value: statusCounts.today },
              { icon: Calendar, iconColor: 'bg-indigo-100 text-indigo-600', label: 'Upcoming', value: statusCounts.upcoming },
            ]} />

            {/* Filters */}
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

            {/* Appointments List */}
            <div className={`transition-opacity duration-150 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
            <Card className="p-6">
                <div className="space-y-4">
                    {appointments.length === 0 ? (
                        <div className="text-center py-12 text-secondary-500">
                            <Calendar className="h-16 w-16 mx-auto mb-4 opacity-50" />
                            <p>No appointments found</p>
                        </div>
                    ) : (
                        appointments.map((appointment) => {
                            const appointmentDate = appointment.appointmentDate.toDate();
                            const isToday = appointmentDate.toDateString() === new Date().toDateString();
                            const isPast = appointmentDate < new Date();
                            const StatusIcon = getAppointmentStatusIcon(appointment.status);

                            return (
                                <div
                                    key={appointment.id}
                                    className={`p-4 border rounded-lg ${
                                        isToday ? 'border-green-300 bg-green-50' :
                                            isPast ? 'border-secondary-200 bg-secondary-50' :
                                                'border-secondary-200 hover:border-primary-300'
                                    }`}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center space-x-3 mb-2">
                                                <User className="h-5 w-5 text-secondary-400" />
                                                <h3 className="font-semibold text-secondary-900">
                                                    {appointment.patientName || 'Patient Name'}
                                                </h3>
                                                {isToday && (
                                                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                            Today
                          </span>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                                                <div>
                                                    <p className="text-sm text-secondary-600">Date & Time</p>
                                                    <p className="font-medium text-secondary-900">
                                                        {formatDate(appointmentDate)}
                                                        {' at '}
                                                        {formatTime(appointmentDate)}
                                                    </p>
                                                </div>

                                                <div>
                                                    <p className="text-sm text-secondary-600">Type</p>
                                                    {appointment.isSpecialistReferral && appointment.specialistType ? (
                                                      <p className="font-medium text-purple-700">
                                                        {getSpecialistLabel(appointment.specialistType)}
                                                        <span className="ml-2 text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">Referral</span>
                                                      </p>
                                                    ) : (
                                                      <p className="font-medium text-secondary-900">
                                                        {appointment.appointmentType || 'General'}
                                                      </p>
                                                    )}
                                                </div>

                                                <div>
                                                    <p className="text-sm text-secondary-600">Duration</p>
                                                    <p className="font-medium text-secondary-900">
                                                        {appointment.duration || BUSINESS.defaultAppointmentDuration} minutes
                                                    </p>
                                                </div>
                                            </div>

                                            {appointment.address && (
                                                <div className="mt-3 flex items-center text-sm text-secondary-600">
                                                    <span className="mr-1.5">📍</span>
                                                    {appointment.address}
                                                </div>
                                            )}

                                            {appointment.reason && (
                                                <div className="mt-3">
                                                    <p className="text-sm text-secondary-600">Reason</p>
                                                    <p className="text-secondary-900">{appointment.reason}</p>
                                                </div>
                                            )}

                                            {appointment.notes && (
                                                <div className="mt-2">
                                                    <p className="text-sm text-secondary-600">Notes</p>
                                                    <p className="text-sm text-secondary-700">{appointment.notes}</p>
                                                </div>
                                            )}

                                            {/* SMS Reminder Message */}
                                            <div className="mt-3 p-3 rounded-lg border border-primary-200">
                                                <div className="flex items-center justify-between mb-1">
                                                    <p className="text-sm font-medium text-primary-600 flex items-center">
                                                        <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                                        SMS Reminder
                                                    </p>
                                                    {editingReminder !== appointment.id && !isPast && appointment.status !== 'cancelled' && (
                                                        <button
                                                            onClick={() => {
                                                                setEditingReminder(appointment.id);
                                                                setReminderText(appointment.reminderMessage || '');
                                                            }}
                                                            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                                                        >
                                                            Edit
                                                        </button>
                                                    )}
                                                </div>
                                                {editingReminder === appointment.id ? (
                                                    <div className="space-y-2">
                                                        <textarea
                                                            value={reminderText}
                                                            onChange={(e) => setReminderText(e.target.value)}
                                                            placeholder="Enter the SMS reminder message patients will receive..."
                                                            rows={3}
                                                            className="w-full rounded-lg border border-primary-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                                            autoFocus
                                                        />
                                                        <div className="flex items-center justify-end space-x-2">
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => {
                                                                    setEditingReminder(null);
                                                                    setReminderText('');
                                                                }}
                                                                className="text-xs"
                                                            >
                                                                <X className="h-3 w-3 mr-1" />
                                                                Cancel
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                onClick={() => handleSaveReminder(appointment.id)}
                                                                className="text-xs"
                                                            >
                                                                <Save className="h-3 w-3 mr-1" />
                                                                Save
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <p className="text-sm text-secondary-700">
                                                        {appointment.reminderMessage || <span className="italic text-secondary-400">Auto-generated when confirmed</span>}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-end space-y-2 ml-4">
                                            <StatusBadge
                                                label={appointment.status}
                                                colorClass={getAppointmentStatusColor(appointment.status)}
                                                icon={<StatusIcon className="h-3 w-3 mr-1" />}
                                            />

                                            {!isPast && appointment.status !== 'completed' && appointment.status !== 'cancelled' && (
                                                <div className="flex flex-col space-y-1">
                                                    {appointment.status === 'scheduled' && (
                                                        <>
                                                            <Button
                                                                size="sm"
                                                                onClick={() => handleApprove(appointment.id)}
                                                                className="text-xs bg-green-600 hover:bg-green-700 text-white"
                                                            >
                                                                <CheckCircle className="h-3 w-3 mr-1" />
                                                                Approve
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                onClick={() => setRejectConfirmId(appointment.id)}
                                                                className="text-xs text-red-600"
                                                            >
                                                                <XCircle className="h-3 w-3 mr-1" />
                                                                Reject
                                                            </Button>
                                                        </>
                                                    )}
                                                    {appointment.status === 'confirmed' && (
                                                        <>
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                onClick={() => handleStatusUpdate(appointment.id, 'completed')}
                                                                className="text-xs text-green-600"
                                                            >
                                                                Complete
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                onClick={() => handleStatusUpdate(appointment.id, 'cancelled')}
                                                                className="text-xs text-red-600"
                                                            >
                                                                Cancel
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })
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

            {/* Admin Create Appointment Modal */}
            <Modal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                title="Schedule Appointment"
                icon={<div className="bg-green-100 p-2 rounded-lg"><Calendar className="h-6 w-6 text-green-600" /></div>}
                maxWidth="max-w-lg"
            >
                <div className="p-6 space-y-5">
                    {/* Patient search */}
                    <div className="relative">
                        <label className="block text-sm font-medium text-secondary-700 mb-1">Patient *</label>
                        <input
                            type="text"
                            value={patientSearch}
                            onChange={(e) => {
                                setPatientSearch(e.target.value);
                                setPatientDropdownOpen(true);
                                if (selectedPatient && e.target.value !== `${selectedPatient.firstName} ${selectedPatient.lastName}`) {
                                    setSelectedPatient(null);
                                    setCreateForm(f => ({ ...f, patientId: '' }));
                                }
                            }}
                            onFocus={() => setPatientDropdownOpen(true)}
                            placeholder="Search by name or email..."
                            className="input w-full"
                        />
                        {patientDropdownOpen && filteredPatients.length > 0 && (
                            <div className="absolute z-10 mt-1 w-full bg-surface-card border border-secondary-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                {filteredPatients.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => handleSelectPatient(p)}
                                        className="w-full text-left px-3 py-2 hover:bg-secondary-50 flex items-center space-x-2"
                                    >
                                        <User className="h-4 w-4 text-secondary-400 flex-shrink-0" />
                                        <div>
                                            <p className="text-sm font-medium text-secondary-900">{p.firstName} {p.lastName}</p>
                                            <p className="text-xs text-secondary-500">{p.email || p.phoneNumber}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                        {selectedPatient && (
                            <p className="mt-1 text-xs text-green-600">Selected: {selectedPatient.firstName} {selectedPatient.lastName} ({selectedPatient.email || selectedPatient.phoneNumber})</p>
                        )}
                    </div>

                    {/* Date */}
                    <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">
                            <Calendar className="inline h-4 w-4 mr-1" />
                            Date *
                        </label>
                        <input
                            type="date"
                            value={createForm.appointmentDate}
                            onChange={(e) => {
                                setCreateForm(f => ({ ...f, appointmentDate: e.target.value, appointmentTime: '' }));
                                fetchCreateSlots(e.target.value);
                            }}
                            className="input w-full"
                        />
                    </div>

                    {/* Time slot grid */}
                    <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-2">
                            <Clock className="inline h-4 w-4 mr-1" />
                            Time *
                        </label>
                        {createSlotsLoading ? (
                            <div className="flex items-center justify-center py-6 text-secondary-500">
                                <Loader className="h-5 w-5 animate-spin mr-2" />
                                Checking availability...
                            </div>
                        ) : !createForm.appointmentDate ? (
                            <p className="text-sm text-secondary-500 py-3">Select a date to see available times</p>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {createSlots.map((slot) => {
                                        const isSelected = createForm.appointmentTime === slot.time;
                                        return (
                                            <button
                                                key={slot.time}
                                                type="button"
                                                disabled={!slot.available}
                                                onClick={() => setCreateForm(f => ({ ...f, appointmentTime: slot.time }))}
                                                className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                                                    !slot.available
                                                        ? 'bg-secondary-100 text-secondary-400 cursor-not-allowed line-through'
                                                        : isSelected
                                                            ? 'bg-primary-600 text-white ring-2 ring-primary-600 ring-offset-1'
                                                            : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                                                }`}
                                            >
                                                {formatSlotTime(slot.time)}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="flex items-center gap-4 mt-2 text-xs text-secondary-500">
                                    <span className="flex items-center gap-1">
                                        <span className="inline-block w-3 h-3 rounded bg-green-50 border border-green-200" />
                                        Available
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <span className="inline-block w-3 h-3 rounded bg-secondary-100" />
                                        Taken
                                    </span>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Type */}
                    <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">Type</label>
                        <select
                            value={createForm.appointmentType}
                            onChange={(e) => setCreateForm(f => ({ ...f, appointmentType: e.target.value as Appointment['appointmentType'] }))}
                            className="input w-full"
                        >
                            <option value="consultation">General Consultation</option>
                            <option value="follow-up">Follow-up Visit</option>
                            <option value="physical">Annual Physical</option>
                            <option value="urgent">Urgent Care</option>
                        </select>
                    </div>

                    {/* SMS Reminder */}
                    <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">SMS Reminder Message</label>
                        <textarea
                            value={createForm.reminderMessage}
                            onChange={(e) => setCreateForm(f => ({ ...f, reminderMessage: e.target.value }))}
                            placeholder="e.g., Please bring your lab results"
                            rows={3}
                            className="input w-full"
                        />
                    </div>

                    <div className="flex justify-end space-x-3 pt-2">
                        <Button variant="secondary" onClick={() => setShowCreateModal(false)}>Cancel</Button>
                        <Button
                            onClick={handleCreateAppointment}
                            loading={creating}
                            disabled={!createForm.patientId || !createForm.appointmentDate || !createForm.appointmentTime}
                        >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Create & Confirm
                        </Button>
                    </div>
                </div>
            </Modal>

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