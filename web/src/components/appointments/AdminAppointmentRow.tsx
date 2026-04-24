import React from 'react';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import {
    User,
    MessageSquare,
    CheckCircle,
    XCircle,
    Save,
    X,
} from 'lucide-react';
import { Appointment } from '../../types';
import { getAppointmentStatusColor, getAppointmentStatusIcon } from '../../lib/status-helpers';
import { formatDate, formatTime } from '../../lib/date-helpers';
import { getSpecialistLabel } from '../../config/specialists';
import { BUSINESS } from '../../config/branding';

export type AdminAppointmentRowData = Appointment & { patientName: string };

interface Props {
    appointment: AdminAppointmentRowData;
    editingReminder: string | null;
    reminderText: string;
    onStartEditReminder: (id: string, initial: string) => void;
    onCancelEditReminder: () => void;
    onReminderTextChange: (text: string) => void;
    onSaveReminder: (id: string) => void;
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
    onStatusUpdate: (id: string, status: Appointment['status']) => void;
}

export const AdminAppointmentRow: React.FC<Props> = ({
    appointment,
    editingReminder,
    reminderText,
    onStartEditReminder,
    onCancelEditReminder,
    onReminderTextChange,
    onSaveReminder,
    onApprove,
    onReject,
    onStatusUpdate,
}) => {
    const appointmentDate = appointment.appointmentDate.toDate();
    const isToday = appointmentDate.toDateString() === new Date().toDateString();
    const isPast = appointmentDate < new Date();
    const StatusIcon = getAppointmentStatusIcon(appointment.status);

    return (
        <div
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

                    <div className="mt-3 p-3 rounded-lg border border-primary-200">
                        <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-medium text-primary-600 flex items-center">
                                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                SMS Reminder
                            </p>
                            {editingReminder !== appointment.id && !isPast && appointment.status !== 'cancelled' && (
                                <button
                                    onClick={() => onStartEditReminder(appointment.id, appointment.reminderMessage || '')}
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
                                    onChange={(e) => onReminderTextChange(e.target.value)}
                                    placeholder="Enter the SMS reminder message patients will receive..."
                                    rows={3}
                                    className="w-full rounded-lg border border-primary-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    autoFocus
                                />
                                <div className="flex items-center justify-end space-x-2">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={onCancelEditReminder}
                                        className="text-xs"
                                    >
                                        <X className="h-3 w-3 mr-1" />
                                        Cancel
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={() => onSaveReminder(appointment.id)}
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
                                        onClick={() => onApprove(appointment.id)}
                                        className="text-xs bg-green-600 hover:bg-green-700 text-white"
                                    >
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Approve
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => onReject(appointment.id)}
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
                                        onClick={() => onStatusUpdate(appointment.id, 'completed')}
                                        className="text-xs text-green-600"
                                    >
                                        Complete
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => onStatusUpdate(appointment.id, 'cancelled')}
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
};
