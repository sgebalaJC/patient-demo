import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Calendar, CheckCircle, Clock, Loader, User } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { functions } from '../../lib/firebase';
import { appointmentOperations, userOperations } from '../../lib/firestore';
import { Appointment, User as UserType } from '../../types';
import logger from '../../lib/logger';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onCreated: () => void;
}

type Slot = { time: string; available: boolean };

const EMPTY_FORM = {
    patientId: '',
    appointmentDate: '',
    appointmentTime: '',
    appointmentType: 'consultation' as Appointment['appointmentType'],
    reminderMessage: '',
};

function generateAllSlots(): Slot[] {
    const result: Slot[] = [];
    for (let hour = 9; hour <= 17; hour++) {
        for (const min of [0, 20, 40]) {
            if (hour === 17 && min > 40) continue;
            result.push({
                time: `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`,
                available: true,
            });
        }
    }
    return result;
}

function formatSlotTime(time: string): string {
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${display}:${m} ${ampm}`;
}

export const AdminCreateAppointmentModal: React.FC<Props> = ({ isOpen, onClose, onCreated }) => {
    const [patients, setPatients] = useState<UserType[]>([]);
    const patientsLoadedRef = useRef(false);
    const [patientSearch, setPatientSearch] = useState('');
    const [patientDropdownOpen, setPatientDropdownOpen] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState<UserType | null>(null);
    const [slots, setSlots] = useState<Slot[]>([]);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setSelectedPatient(null);
        setPatientSearch('');
        setSlots([]);
        setForm(EMPTY_FORM);
        if (patientsLoadedRef.current) return;
        patientsLoadedRef.current = true;
        userOperations.getAllUsers(100, 1).then((res) => {
            if (res.success && res.data) {
                setPatients(res.data.users.filter((u) => u.role === 'patient'));
            }
        }).catch((err) => logger.error('patient list load failed', err));
    }, [isOpen]);

    const filteredPatients = patientSearch.length >= 1
        ? patients.filter((p) => {
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
        setForm((f) => ({ ...f, patientId: p.id }));
    };

    const fetchSlots = useCallback(async (date: string) => {
        if (!date) return;
        setSlotsLoading(true);
        try {
            const fn = httpsCallable(functions, 'getAvailableSlots');
            const result = await fn({ date }) as { data: { success: boolean; slots: Slot[] } };
            if (result.data.success) {
                setSlots(result.data.slots);
            } else {
                setSlots(generateAllSlots());
            }
        } catch {
            setSlots(generateAllSlots());
        } finally {
            setSlotsLoading(false);
        }
    }, []);

    const handleCreate = async () => {
        if (!form.patientId || !form.appointmentDate || !form.appointmentTime) return;
        setCreating(true);
        try {
            const dateTime = new Date(`${form.appointmentDate}T${form.appointmentTime}`);
            const response = await appointmentOperations.createAppointment({
                patientId: form.patientId,
                appointmentDate: Timestamp.fromDate(dateTime),
                status: 'confirmed',
                appointmentType: form.appointmentType,
                reminderSent: false,
                reminderMessage: form.reminderMessage || undefined,
            });
            if (response.success) {
                onClose();
                setForm(EMPTY_FORM);
                onCreated();
            }
        } catch (error) {
            logger.error('Error creating appointment:', error);
        } finally {
            setCreating(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Schedule Appointment"
            icon={<div className="bg-green-100 p-2 rounded-lg"><Calendar className="h-6 w-6 text-green-600" /></div>}
            maxWidth="max-w-lg"
        >
            <div className="p-6 space-y-5">
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
                                setForm((f) => ({ ...f, patientId: '' }));
                            }
                        }}
                        onFocus={() => setPatientDropdownOpen(true)}
                        placeholder="Search by name or email..."
                        className="input w-full"
                    />
                    {patientDropdownOpen && filteredPatients.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full bg-surface-card border border-secondary-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {filteredPatients.map((p) => (
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

                <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-1">
                        <Calendar className="inline h-4 w-4 mr-1" />
                        Date *
                    </label>
                    <input
                        type="date"
                        value={form.appointmentDate}
                        onChange={(e) => {
                            setForm((f) => ({ ...f, appointmentDate: e.target.value, appointmentTime: '' }));
                            fetchSlots(e.target.value);
                        }}
                        className="input w-full"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                        <Clock className="inline h-4 w-4 mr-1" />
                        Time *
                    </label>
                    {slotsLoading ? (
                        <div className="flex items-center justify-center py-6 text-secondary-500">
                            <Loader className="h-5 w-5 animate-spin mr-2" />
                            Checking availability...
                        </div>
                    ) : !form.appointmentDate ? (
                        <p className="text-sm text-secondary-500 py-3">Select a date to see available times</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {slots.map((slot) => {
                                    const isSelected = form.appointmentTime === slot.time;
                                    return (
                                        <button
                                            key={slot.time}
                                            type="button"
                                            disabled={!slot.available}
                                            onClick={() => setForm((f) => ({ ...f, appointmentTime: slot.time }))}
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

                <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-1">Type</label>
                    <select
                        value={form.appointmentType}
                        onChange={(e) => setForm((f) => ({ ...f, appointmentType: e.target.value as Appointment['appointmentType'] }))}
                        className="input w-full"
                    >
                        <option value="consultation">General Consultation</option>
                        <option value="follow-up">Follow-up Visit</option>
                        <option value="physical">Annual Physical</option>
                        <option value="urgent">Urgent Care</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-1">SMS Reminder Message</label>
                    <textarea
                        value={form.reminderMessage}
                        onChange={(e) => setForm((f) => ({ ...f, reminderMessage: e.target.value }))}
                        placeholder="e.g., Please bring your lab results"
                        rows={3}
                        className="input w-full"
                    />
                </div>

                <div className="flex justify-end space-x-3 pt-2">
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button
                        onClick={handleCreate}
                        loading={creating}
                        disabled={!form.patientId || !form.appointmentDate || !form.appointmentTime}
                    >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Create & Confirm
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
