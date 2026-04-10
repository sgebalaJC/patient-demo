import React, {useState, useEffect} from 'react';
import logger from '../../lib/logger';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Button} from '../ui/Button';
import {ErrorAlert} from '../ui/ErrorAlert';
import {User} from '../../types';
import {Timestamp} from 'firebase/firestore';
import {userOperations} from '../../lib/firestore';
import {Users, User as UserIcon, Mail, Shield, CheckCircle2, Phone, Calendar} from 'lucide-react';
import { FIELD_LIMITS } from '../../lib/validation';
import { Modal } from '../ui/Modal';

const userSchema = z.object({
    email: z.string().max(FIELD_LIMITS.email.max, 'Email is too long').email('Please enter a valid email'),
    firstName: z.string().min(FIELD_LIMITS.firstName.min, `First name must be at least ${FIELD_LIMITS.firstName.min} characters`).max(FIELD_LIMITS.firstName.max, `First name must be less than ${FIELD_LIMITS.firstName.max} characters`),
    lastName: z.string().min(FIELD_LIMITS.lastName.min, `Last name must be at least ${FIELD_LIMITS.lastName.min} characters`).max(FIELD_LIMITS.lastName.max, `Last name must be less than ${FIELD_LIMITS.lastName.max} characters`),
    phoneNumber: z.string()
        .min(1, 'Phone number is required')
        .max(FIELD_LIMITS.phoneNumber.max, 'Phone number is too long')
        .refine(
            (val) => /^\+?[\d\s\-\(\)]{10,}$/.test(val.replace(/\s/g, '')),
            'Please enter a valid phone number'
        ),
    role: z.enum(['patient', 'assistant', 'admin'] as const, {
        errorMap: () => ({message: 'Please select a valid role'}),
    }),
    dateOfBirth: z.string().optional(),
    isActive: z.boolean(),
});

type UserFormData = z.infer<typeof userSchema>;

interface UserFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    editingUser?: User | null;
}

export const UserForm: React.FC<UserFormProps> = ({
                                                      isOpen,
                                                      onClose,
                                                      onSuccess,
                                                      editingUser,
                                                  }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>('');
    const [successMessage, setSuccessMessage] = useState<{
        message: string;
        email?: string;
        temporaryPassword?: string;
    } | null>(null);

    const {
        register,
        handleSubmit,
        reset,
        watch,
        formState: {errors},
    } = useForm<UserFormData>({
        resolver: zodResolver(userSchema),
    });

    const watchedRole = watch('role');

    useEffect(() => {
        if (isOpen) {
            setSuccessMessage(null);
            if (editingUser) {
                populateFormForEditing();
            } else {
                reset({
                    email: '',
                    firstName: '',
                    lastName: '',
                    phoneNumber: '',
                    role: 'patient',
                    dateOfBirth: '',
                    isActive: true,
                });
            }
        }
    }, [isOpen, editingUser, reset]);

    const populateFormForEditing = () => {
        if (!editingUser) return;

        let dobString = '';
        if (editingUser.dateOfBirth && typeof editingUser.dateOfBirth.toDate === 'function') {
            const d = editingUser.dateOfBirth.toDate();
            dobString = d.toISOString().split('T')[0];
        }

        reset({
            email: editingUser.email,
            firstName: editingUser.firstName,
            lastName: editingUser.lastName,
            phoneNumber: editingUser.phoneNumber || '',
            role: editingUser.role,
            dateOfBirth: dobString,
            isActive: editingUser.isActive,
        });
    };

    const onSubmit = async (data: UserFormData) => {
        setLoading(true);
        setError('');

        try {
            if (editingUser) {
                // Update existing user
                const userData: Record<string, any> = {
                    email: data.email,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    phoneNumber: data.phoneNumber,
                    role: data.role,
                    isActive: data.isActive,
                };

                if (data.role === 'patient' && data.dateOfBirth) {
                    userData.dateOfBirth = Timestamp.fromDate(new Date(data.dateOfBirth + 'T00:00:00'));
                }

                // Update in Firestore
                const response = await userOperations.updateUser(editingUser.id, userData);

                if (response.success) {
                    // Also update in Firebase Auth
                    try {
                        const {firebaseService} = await import('../../lib/firebase');
                        const authResult = await firebaseService.updateUserAuth(editingUser.id, {
                            email: data.email,
                            firstName: data.firstName,
                            lastName: data.lastName,
                            role: data.role,
                            isActive: data.isActive,
                        }) as { success: boolean; message?: string; error?: string; code?: string };

                        if (authResult.success) {
                            setSuccessMessage({
                                message: authResult.message || 'User updated successfully!'
                            });
                            onSuccess();
                            // Don't close immediately to show success message
                        } else {
                            logger.warn('Failed to update Firebase Auth, but Firestore updated:', authResult.error);
                            setSuccessMessage({
                                message: 'User updated successfully (some auth updates may have failed)'
                            });
                            onSuccess();
                        }
                    } catch (authError: any) {
                        logger.warn('Failed to update Firebase Auth, but Firestore updated:', authError);
                        setSuccessMessage({
                            message: 'User updated successfully (some auth updates may have failed)'
                        });
                        onSuccess();
                    }
                } else {
                    setError(response.error || 'Failed to update user');
                }
            } else {
                // Create new user with Firebase Auth first
                const {firebaseService} = await import('../../lib/firebase');
                const authResult = await firebaseService.createUserWithAuth({
                    email: data.email,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    role: data.role,
                    phoneNumber: data.phoneNumber,
                }) as {
                    success: boolean;
                    temporaryPassword?: string;
                    uid?: string;
                    message?: string;
                    error?: string;
                    code?: string
                };

                if (authResult.success) {
                    setSuccessMessage({
                        message: `${authResult.message || 'User created successfully!'} An email verification link has been sent to the user's email address.`,
                        email: data.email,
                        temporaryPassword: authResult.temporaryPassword
                    });
                    onSuccess();
                    // Don't close immediately to show success message
                } else {
                    // Show the specific error message from the server
                    setError(authResult.error || 'Failed to create user');
                }
            }
        } catch (error: any) {
            logger.error('Error saving user:', error);
            setError(error.message || 'An error occurred while saving the user');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        reset();
        setError('');
        setSuccessMessage(null);
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title={editingUser ? 'Edit User' : 'Add New User'}
            icon={<div className="bg-primary-100 p-2 rounded-lg"><Users className="h-6 w-6 text-primary-600"/></div>}
        >
                    <div className="p-6">
                        <ErrorAlert message={error} className="mb-6" />

                        {successMessage && (
                            <div
                                className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start space-x-3">
                                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5"/>
                                <div className="flex-1">
                                    <p className="text-sm text-green-600 font-medium mb-2">{successMessage.message}</p>
                                    {successMessage.email && successMessage.temporaryPassword && (
                                        <div className="text-sm text-green-700 bg-green-100 p-3 rounded border">
                                            <p className="font-medium mb-1">Account Details:</p>
                                            <p><strong>Email:</strong> {successMessage.email}</p>
                                            <p><strong>Temporary Password:</strong> {successMessage.temporaryPassword}
                                            </p>
                                            <p className="mt-2 text-green-600">
                                                The user should reset their password on first login using the "Forgot
                                                Password" link.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                            {/* Basic Information */}
                            <div className="space-y-4">
                                <h3 className="text-lg font-medium text-secondary-900">Basic Information</h3>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-secondary-700 mb-2">
                                            <UserIcon className="inline h-4 w-4 mr-2"/>
                                            First Name *
                                        </label>
                                        <input {...register('firstName')} className="input w-full"/>
                                        {errors.firstName && (
                                            <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-secondary-700 mb-2">
                                            Last Name *
                                        </label>
                                        <input {...register('lastName')} className="input w-full"/>
                                        {errors.lastName && (
                                            <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                                        <Mail className="inline h-4 w-4 mr-2"/>
                                        Email Address *
                                    </label>
                                    <input {...register('email')} type="email" className="input w-full"/>
                                    {errors.email && (
                                        <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                                        <Phone className="inline h-4 w-4 mr-2"/>
                                        Phone Number *
                                    </label>
                                    <input
                                        {...register('phoneNumber')}
                                        type="tel"
                                        placeholder="e.g. +1 (555) 123-4567"
                                        className="input w-full"
                                    />
                                    {errors.phoneNumber && (
                                        <p className="mt-1 text-sm text-red-600">{errors.phoneNumber.message}</p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                                        <Shield className="inline h-4 w-4 mr-2"/>
                                        Role *
                                    </label>
                                    <select {...register('role')} className="input w-full">
                                        <option value="patient">Patient</option>
                                        <option value="assistant">Assistant</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                    {errors.role && (
                                        <p className="mt-1 text-sm text-red-600">{errors.role.message}</p>
                                    )}
                                </div>

                                {watchedRole === 'patient' && (
                                    <div>
                                        <label className="block text-sm font-medium text-secondary-700 mb-2">
                                            <Calendar className="inline h-4 w-4 mr-2"/>
                                            Date of Birth
                                        </label>
                                        <input
                                            {...register('dateOfBirth')}
                                            type="date"
                                            className="input w-full"
                                        />
                                        {errors.dateOfBirth && (
                                            <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth.message}</p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Account Status */}
                            <div className="space-y-4">
                                <h3 className="text-lg font-medium text-secondary-900">Account Status</h3>

                                <div className="space-y-3">
                                    <div className="flex items-center">
                                        <input
                                            {...register('isActive')}
                                            type="checkbox"
                                            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300 rounded"
                                        />
                                        <label className="ml-2 block text-sm text-secondary-700">
                                            Active Account
                                        </label>
                                    </div>
                                </div>
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
                                    {editingUser ? 'Update User' : 'Add User'}
                                </Button>
                            </div>
                        </form>
                    </div>
        </Modal>
    );
};
