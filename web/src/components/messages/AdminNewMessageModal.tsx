import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, MessageSquare, Search, User as UserIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { messageThreadOperations, userOperations } from '../../lib/firestore';
import { useAuth } from '../../hooks/useAuth';
import { User } from '../../types';
import { newMessageBaseSchema } from '../../lib/validation';
import logger from '../../lib/logger';
import { Modal } from '../ui/Modal';
import { formatPhoneDisplay } from '../../lib/phone';
import { formatDisplayName } from '../../lib/user-helpers';

const adminNewMessageSchema = z.object({
    ...newMessageBaseSchema,
    patientId: z.string().min(1, 'Please select a patient'),
});

type AdminNewMessageFormData = z.infer<typeof adminNewMessageSchema>;

interface AdminNewMessageModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (threadId?: string) => void;
}

export const AdminNewMessageModal: React.FC<AdminNewMessageModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
}) => {
    const { user, userProfile } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>('');
    const [patients, setPatients] = useState<User[]>([]);
    const [loadingPatients, setLoadingPatients] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showPatientDropdown, setShowPatientDropdown] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState<User | null>(null);

    const {
        register,
        handleSubmit,
        formState: { errors },
        reset,
        setValue,
        watch,
    } = useForm<AdminNewMessageFormData>({
        resolver: zodResolver(adminNewMessageSchema),
        defaultValues: {
            patientId: '',
            subject: '',
            message: '',
            priority: 'normal',
        },
    });

    const watchedPatientId = watch('patientId');

    // Fetch patients when modal opens or search changes
    useEffect(() => {
        if (isOpen) {
            fetchPatients();
        }
    }, [isOpen, searchTerm]);

    const fetchPatients = async () => {
        setLoadingPatients(true);
        try {
            const response = await userOperations.getAllUsers(50, 1, searchTerm);
            if (response.success && response.data) {
                // Filter only patients
                const patientUsers = response.data.users.filter(u => u.role === 'patient' && u.isActive);
                setPatients(patientUsers);
            }
        } catch (err) {
            logger.error('Error fetching patients:', err);
        } finally {
            setLoadingPatients(false);
        }
    };

    const handlePatientSelect = (patient: User) => {
        setSelectedPatient(patient);
        setValue('patientId', patient.id);
        setShowPatientDropdown(false);
        setSearchTerm(`${patient.firstName} ${patient.lastName}`);
    };

    const onSubmit = async (data: AdminNewMessageFormData) => {
        if (!user || !userProfile) {
            setError('You must be logged in to send messages');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // Create new thread with admin as initiator
            const threadData = {
                patientId: data.patientId,
                subject: data.subject,
                priority: data.priority,
                status: 'open' as const,
                isActive: true,
                tags: ['admin-initiated'],
            };

            const threadResponse = await messageThreadOperations.createThread(threadData);

            if (!threadResponse.success || !threadResponse.data) {
                throw new Error(threadResponse.error || 'Failed to create thread');
            }

            const threadId = threadResponse.data.id;

            // Send initial message from admin
            const senderName = formatDisplayName(userProfile, 'Admin');
            const messageData = {
                threadId,
                senderId: user.uid,
                senderName: senderName,
                senderRole: 'admin' as const,
                content: data.message,
                attachments: [],
            };

            const messageResponse = await messageThreadOperations.sendMessage(messageData);

            if (messageResponse.success) {
                reset();
                setSelectedPatient(null);
                setSearchTerm('');
                onClose();
                onSuccess(threadId);
            } else {
                throw new Error(messageResponse.error || 'Failed to send message');
            }
        } catch (error: any) {
            logger.error('Error creating admin message:', error);
            setError(error.message || 'Failed to send message');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        reset();
        setSelectedPatient(null);
        setSearchTerm('');
        setError('');
        setShowPatientDropdown(false);
        onClose();
    };

    const filteredPatients = patients.filter(patient => {
        if (!searchTerm) return true;
        const fullName = `${patient.firstName} ${patient.lastName}`.toLowerCase();
        const email = (patient.email || '').toLowerCase();
        const search = searchTerm.toLowerCase();
        return fullName.includes(search) || email.includes(search);
    });

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title="New Message to Patient"
            icon={<div className="bg-primary-100 p-2 rounded-lg"><MessageSquare className="h-6 w-6 text-primary-600" /></div>}
        >
                    <form onSubmit={handleSubmit(onSubmit)} className="px-6 pt-4 pb-6 space-y-6" autoComplete="off">
                        {error && <ErrorAlert message={error} />}

                        <div className="space-y-4">
                            {/* Patient Selector */}
                            <div className="relative">
                                <label className="block text-sm font-medium text-secondary-700 mb-2">
                                    Select Patient *
                                </label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-3 text-secondary-400 h-4 w-4" />
                                    <input
                                        type="text"
                                        placeholder="Search patients by name or email..."
                                        value={searchTerm}
                                        onChange={(e) => {
                                            setSearchTerm(e.target.value);
                                            setShowPatientDropdown(true);
                                            if (!e.target.value) {
                                                setSelectedPatient(null);
                                                setValue('patientId', '');
                                            }
                                        }}
                                        onFocus={() => setShowPatientDropdown(true)}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        name="patient-search"
                                        className="w-full pl-10 pr-4 py-2 border border-secondary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                    />
                                    <input type="hidden" {...register('patientId')} />
                                </div>
                                
                                {/* Dropdown */}
                                {showPatientDropdown && (
                                    <div className="absolute z-10 w-full mt-1 bg-surface-card border border-secondary-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                        {loadingPatients ? (
                                            <div className="p-4 text-center text-secondary-500">
                                                Loading patients...
                                            </div>
                                        ) : filteredPatients.length === 0 ? (
                                            <div className="p-4 text-center text-secondary-500">
                                                No patients found
                                            </div>
                                        ) : (
                                            filteredPatients.map((patient) => (
                                                <button
                                                    key={patient.id}
                                                    type="button"
                                                    onClick={() => handlePatientSelect(patient)}
                                                    className={`w-full px-4 py-3 text-left hover:bg-secondary-50 flex items-center space-x-3 border-b border-secondary-100 last:border-b-0 ${
                                                        selectedPatient?.id === patient.id ? 'bg-primary-50' : ''
                                                    }`}
                                                >
                                                    <div className="bg-secondary-100 p-2 rounded-full">
                                                        <UserIcon className="h-4 w-4 text-secondary-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-secondary-900">
                                                            {patient.firstName} {patient.lastName}
                                                        </p>
                                                        <p className="text-sm text-secondary-500">
                                                            {patient.email || formatPhoneDisplay(patient.phoneNumber)}
                                                            {patient.dateOfBirth && (
                                                                <> &middot; DOB: {patient.dateOfBirth.toDate().toLocaleDateString()}</>
                                                            )}
                                                        </p>
                                                    </div>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                                
                                {errors.patientId && (
                                    <p className="text-sm text-red-600 mt-1">{errors.patientId.message}</p>
                                )}
                                
                                {selectedPatient && (
                                    <div className="mt-2 p-2 bg-primary-50 border border-primary-200 rounded-lg flex items-center justify-between">
                                        <div className="flex items-center space-x-2">
                                            <UserIcon className="h-4 w-4 text-primary-600" />
                                            <span className="text-sm font-medium text-primary-900">
                                                {selectedPatient.firstName} {selectedPatient.lastName}
                                                {selectedPatient.dateOfBirth && (
                                                    <span className="text-primary-600 font-normal"> &middot; DOB: {selectedPatient.dateOfBirth.toDate().toLocaleDateString()}</span>
                                                )}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedPatient(null);
                                                setValue('patientId', '');
                                                setSearchTerm('');
                                            }}
                                            className="text-primary-600 hover:text-primary-800"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                )}
                            </div>

                            <Input
                                {...register('subject')}
                                label="Subject"
                                placeholder="Brief description of your message..."
                                error={errors.subject?.message}
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />

                            <div>
                                <label className="block text-sm font-medium text-secondary-700 mb-2">
                                    Priority Level
                                </label>
                                <select
                                    {...register('priority')}
                                    className="input w-full"
                                >
                                    <option value="low">Low - General information</option>
                                    <option value="normal">Normal - Standard message</option>
                                    <option value="high">High - Important notice</option>
                                    <option value="urgent">Urgent - Requires immediate attention</option>
                                </select>
                                {errors.priority && (
                                    <p className="text-sm text-red-600 mt-1">{errors.priority.message}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-secondary-700 mb-2">
                                    Message
                                </label>
                                <textarea
                                    {...register('message')}
                                    rows={6}
                                    placeholder="Write your message to the patient..."
                                    autoComplete="off"
                                    className="input w-full resize-none"
                                />
                                {errors.message && (
                                    <p className="text-sm text-red-600 mt-1">{errors.message.message}</p>
                                )}
                            </div>
                        </div>

                        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
                            <h4 className="text-sm font-medium text-primary-900 mb-2">Admin Message Guidelines</h4>
                            <ul className="text-sm text-primary-700 space-y-1">
                                <li>• Be clear and professional in your communication</li>
                                <li>• Include any necessary action items or next steps</li>
                                <li>• Set appropriate priority based on urgency</li>
                                <li>• The patient will receive a notification about this message</li>
                            </ul>
                        </div>

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
                                disabled={!watchedPatientId}
                            >
                                Send Message
                            </Button>
                        </div>
                    </form>
        </Modal>
    );
};

