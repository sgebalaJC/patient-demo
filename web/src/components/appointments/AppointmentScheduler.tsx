import React, {useState, useEffect, useCallback} from 'react';
import {useForm, Controller} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Button} from '../ui/Button';
import {ErrorAlert} from '../ui/ErrorAlert';
import {Appointment} from '../../types';
import {appointmentOperations, notificationOperations} from '../../lib/firestore';
import {useAuth} from '../../hooks/useAuth';
import {Calendar, Clock, CheckCircle2, Loader} from 'lucide-react';
import {Timestamp} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {functions} from '../../lib/firebase';

const appointmentSchema = z.object({
    appointmentDate: z.string().min(1, 'Please select a date'),
    appointmentTime: z.string().min(1, 'Please select a time'),
    appointmentType: z.enum(['consultation', 'follow-up', 'physical', 'urgent']),
});

type AppointmentFormData = z.infer<typeof appointmentSchema>;

interface TimeSlot {
    time: string;
    available: boolean;
}

interface AppointmentSchedulerProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    editingAppointment?: Appointment | null;
}

export const AppointmentScheduler: React.FC<AppointmentSchedulerProps> = ({
                                                                              isOpen,
                                                                              onClose,
                                                                              onSuccess,
                                                                              editingAppointment,
                                                                          }) => {
    const {user} = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>('');
    const [slots, setSlots] = useState<TimeSlot[]>([]);
    const [slotsLoading, setSlotsLoading] = useState(false);

    const {
        register,
        handleSubmit,
        reset,
        watch,
        setValue,
        control,
        formState: {errors},
    } = useForm<AppointmentFormData>({
        resolver: zodResolver(appointmentSchema),
        defaultValues: {
            appointmentType: 'consultation',
        },
    });

    const selectedDate = watch('appointmentDate');

    // Fetch available slots when date changes
    const fetchSlots = useCallback(async (date: string) => {
        if (!date) return;

        setSlotsLoading(true);
        try {
            const getAvailableSlotsFn = httpsCallable(functions, 'getAvailableSlots');
            const result = await getAvailableSlotsFn({ date }) as { data: { success: boolean; slots: TimeSlot[] } };

            if (result.data.success) {
                setSlots(result.data.slots);
            } else {
                // Fallback: all slots available if function not deployed yet
                setSlots(generateAllSlots());
            }
        } catch {
            // Fallback: show all slots if Cloud Function unavailable (e.g., emulator without functions)
            setSlots(generateAllSlots());
        } finally {
            setSlotsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (selectedDate) {
            fetchSlots(selectedDate);
        }
    }, [selectedDate, fetchSlots]);

    useEffect(() => {
        if (isOpen) {
            if (editingAppointment) {
                populateFormForEditing();
            } else {
                const now = new Date();
                const currentDate = now.toLocaleDateString('en-CA', {
                    timeZone: 'America/Los_Angeles'
                });

                reset({
                    appointmentType: 'consultation',
                    appointmentDate: currentDate,
                    appointmentTime: '',
                });
            }
        }
    }, [isOpen, editingAppointment, reset]);

    const populateFormForEditing = () => {
        if (!editingAppointment) return;

        const appointmentDate = editingAppointment.appointmentDate instanceof Timestamp
            ? editingAppointment.appointmentDate.toDate()
            : new Date(editingAppointment.appointmentDate);

        const dateString = appointmentDate.toISOString().split('T')[0];
        const timeString = appointmentDate.toTimeString().slice(0, 5);

        reset({
            appointmentDate: dateString,
            appointmentTime: timeString,
            appointmentType: editingAppointment.appointmentType || 'consultation',
        });
    };

    const onSubmit = async (data: AppointmentFormData) => {
        if (!user) {
            setError('You must be logged in to schedule appointments');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const appointmentDateTime = new Date(`${data.appointmentDate}T${data.appointmentTime}`);

            // Must be at least tomorrow PST
            const tomorrowStart = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
            tomorrowStart.setDate(tomorrowStart.getDate() + 1);
            tomorrowStart.setHours(0, 0, 0, 0);
            if (appointmentDateTime < tomorrowStart) {
                setError('Appointments must be scheduled at least 1 day in advance');
                setLoading(false);
                return;
            }

            // Validate slot availability (race condition check)
            try {
                const validateFn = httpsCallable(functions, 'validateAppointmentSlot');
                const validation = await validateFn({
                    appointmentDate: appointmentDateTime.toISOString(),
                    appointmentId: editingAppointment?.id,
                }) as { data: { available: boolean; reason?: string } };

                if (!validation.data.available) {
                    setError(validation.data.reason || 'This time slot is no longer available.');
                    // Re-fetch slots to show updated availability
                    fetchSlots(data.appointmentDate);
                    setLoading(false);
                    return;
                }
            } catch {
                // If validation function not available, proceed without it
            }

            const appointmentData: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'> = {
                patientId: user.uid,
                appointmentDate: Timestamp.fromDate(appointmentDateTime),
                status: 'scheduled',
                appointmentType: data.appointmentType,
                reminderSent: false,
            };

            let response;
            if (editingAppointment) {
                response = await appointmentOperations.updateAppointment(editingAppointment.id, appointmentData);
            } else {
                response = await appointmentOperations.createAppointment(appointmentData);
            }

            if (response.success) {
                const formattedDate = appointmentDateTime.toLocaleDateString('en-US', {
                    timeZone: 'America/Los_Angeles',
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                });
                const formattedTime = appointmentDateTime.toLocaleTimeString('en-US', {
                    timeZone: 'America/Los_Angeles',
                    hour: 'numeric',
                    minute: '2-digit',
                });

                await notificationOperations.createNotification({
                    recipientRole: 'admin',
                    type: 'appointment_booked',
                    title: editingAppointment ? 'Appointment Updated' : 'New Appointment Booked',
                    message: `${formattedDate} at ${formattedTime} — ${data.appointmentType}`,
                    meta: {
                        patientId: user.uid,
                        appointmentId: response.data?.id || '',
                    },
                });

                onSuccess();
                handleClose();
            } else {
                setError(response.error || 'Failed to schedule appointment');
            }
        } catch (error: any) {
            setError(error.message || 'An error occurred while scheduling the appointment');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        reset();
        setError('');
        setSlots([]);
        onClose();
    };

    const generateAllSlots = (): TimeSlot[] => {
        const result: TimeSlot[] = [];
        for (let hour = 9; hour <= 17; hour++) {
            for (const min of [0, 20, 40]) {
                if (hour === 17 && min > 40) continue;
                result.push({ time: `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`, available: true });
            }
        }
        return result;
    };

    const formatTimeDisplay = (time: string): string => {
        const [hourStr, minuteStr] = time.split(':');
        const hour = parseInt(hourStr);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
        return `${displayHour}:${minuteStr} ${ampm}`;
    };

    // Minimum date: tomorrow in PST
    const getTomorrowPST = () => {
        const now = new Date();
        const pst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
        pst.setDate(pst.getDate() + 1);
        return pst.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    };
    const minDate = getTomorrowPST();

    if (!isOpen) return null;

    return (
        <div>
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-surface-card rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center justify-between p-6 border-b border-secondary-200">
                        <div className="flex items-center space-x-3">
                            <div className="bg-primary-100 p-2 rounded-lg">
                                <Calendar className="h-6 w-6 text-primary-600"/>
                            </div>
                            <h2 className="text-xl font-semibold text-secondary-900">
                                {editingAppointment ? 'Edit Appointment' : 'Schedule New Appointment'}
                            </h2>
                        </div>
                        <button
                            onClick={handleClose}
                            className="text-secondary-400 hover:text-secondary-600"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="p-6">
                        <ErrorAlert message={error} className="mb-6" />

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                            {/* Date */}
                            <div>
                                <label className="block text-sm font-medium text-secondary-700 mb-2">
                                    <Calendar className="inline h-4 w-4 mr-2"/>
                                    Appointment Date *
                                </label>
                                <input
                                    {...register('appointmentDate')}
                                    type="date"
                                    min={minDate}
                                    className="input w-full"
                                />
                                {errors.appointmentDate && (
                                    <p className="mt-1 text-sm text-red-600">{errors.appointmentDate.message}</p>
                                )}
                            </div>

                            {/* Time Slots Grid */}
                            <div>
                                <label className="block text-sm font-medium text-secondary-700 mb-2">
                                    <Clock className="inline h-4 w-4 mr-2"/>
                                    Appointment Time *
                                </label>

                                {slotsLoading ? (
                                    <div className="flex items-center justify-center py-8 text-secondary-500">
                                        <Loader className="h-5 w-5 animate-spin mr-2" />
                                        Checking availability...
                                    </div>
                                ) : !selectedDate ? (
                                    <p className="text-sm text-secondary-500 py-4">Select a date to see available times</p>
                                ) : (
                                    <Controller
                                        name="appointmentTime"
                                        control={control}
                                        render={({ field }) => (
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                {slots.map((slot) => {
                                                    const isSelected = field.value === slot.time;
                                                    return (
                                                        <button
                                                            key={slot.time}
                                                            type="button"
                                                            disabled={!slot.available}
                                                            onClick={() => {
                                                                if (slot.available) {
                                                                    setValue('appointmentTime', slot.time);
                                                                }
                                                            }}
                                                            className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                                                                !slot.available
                                                                    ? 'bg-secondary-100 text-secondary-400 cursor-not-allowed line-through'
                                                                    : isSelected
                                                                        ? 'bg-primary-600 text-white ring-2 ring-primary-600 ring-offset-1'
                                                                        : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                                                            }`}
                                                        >
                                                            {formatTimeDisplay(slot.time)}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    />
                                )}

                                {errors.appointmentTime && (
                                    <p className="mt-2 text-sm text-red-600">{errors.appointmentTime.message}</p>
                                )}

                                {slots.length > 0 && !slotsLoading && (
                                    <div className="flex items-center gap-4 mt-3 text-xs text-secondary-500">
                                        <span className="flex items-center gap-1">
                                            <span className="inline-block w-3 h-3 rounded bg-green-50 border border-green-200" />
                                            Available
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <span className="inline-block w-3 h-3 rounded bg-secondary-100" />
                                            Taken
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Appointment Type */}
                            <div>
                                <label className="block text-sm font-medium text-secondary-700 mb-2">
                                    Appointment Type *
                                </label>
                                <select {...register('appointmentType')} className="input w-full">
                                    <option value="consultation">General Consultation</option>
                                    <option value="follow-up">Follow-up Visit</option>
                                    <option value="physical">Annual Physical</option>
                                    <option value="urgent">Urgent Care</option>
                                </select>
                                {errors.appointmentType && (
                                    <p className="mt-1 text-sm text-red-600">{errors.appointmentType.message}</p>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end space-x-3 pt-6 border-t border-secondary-200">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={handleClose}
                                    disabled={loading}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    loading={loading}
                                    className="flex items-center"
                                >
                                    <CheckCircle2 className="h-4 w-4 mr-2"/>
                                    {editingAppointment ? 'Update Appointment' : 'Schedule Appointment'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
};
