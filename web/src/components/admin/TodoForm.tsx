import React, {useState, useEffect} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Button} from '../ui/Button';
import {ErrorAlert} from '../ui/ErrorAlert';
import {TodoItem} from '../../types';
import {todoOperations} from '../../lib/firestore';
import {useAuth} from '../../hooks/useAuth';
import {CheckSquare, Calendar, Clock, CheckCircle2, MessageSquare} from 'lucide-react';
import {Timestamp} from 'firebase/firestore';
import { FIELD_LIMITS } from '../../lib/validation';
import { Modal } from '../ui/Modal';
import logger from '../../lib/logger';

const todoSchema = z.object({
    title: z.string().min(FIELD_LIMITS.todoTitle.min, 'Title is required').max(FIELD_LIMITS.todoTitle.max, `Title must be less than ${FIELD_LIMITS.todoTitle.max} characters`),
    description: z.string().max(FIELD_LIMITS.todoDescription.max, `Description must be less than ${FIELD_LIMITS.todoDescription.max} characters`).optional(),
    scheduledDate: z.string().min(1, 'Date is required'),
    scheduledTime: z.string().min(1, 'Time is required'),
    priority: z.enum(['low', 'medium', 'high']),
    category: z.string().max(FIELD_LIMITS.todoCategory.max, `Category must be less than ${FIELD_LIMITS.todoCategory.max} characters`).optional(),
    enableSmsReminder: z.boolean().default(true),
});

type TodoFormData = z.infer<typeof todoSchema>;

interface TodoFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    editingTodo?: TodoItem | null;
}

export const TodoForm: React.FC<TodoFormProps> = ({
                                                      isOpen,
                                                      onClose,
                                                      onSuccess,
                                                      editingTodo,
                                                  }) => {
    const {user} = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>('');

    const {
        register,
        handleSubmit,
        reset,
        watch,
        formState: {errors},
    } = useForm<TodoFormData>({
        resolver: zodResolver(todoSchema),
    });

    // Watch the SMS reminder checkbox value
    const enableSmsReminder = watch('enableSmsReminder');

    useEffect(() => {
        if (isOpen) {
            if (editingTodo) {
                populateFormForEditing();
            } else {
                // Auto-select current date and time for new todos
                const now = new Date();
                
                // Get current date in PST timezone (YYYY-MM-DD format)
                const currentDate = now.toLocaleDateString('en-CA', {
                    timeZone: 'America/Los_Angeles'
                });
                
                // Get current time in PST timezone rounded to nearest 30-minute interval
                const pstTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
                const currentHour = pstTime.getHours();
                const currentMinutes = pstTime.getMinutes();
                const roundedMinutes = currentMinutes >= 30 ? 30 : 0;
                const currentTime = `${currentHour.toString().padStart(2, '0')}:${roundedMinutes.toString().padStart(2, '0')}`;
                
                reset({
                    title: '',
                    description: '',
                    scheduledDate: currentDate,
                    scheduledTime: currentTime,
                    priority: 'medium',
                    category: '',
                    enableSmsReminder: true,
                });
            }
        }
    }, [isOpen, editingTodo, reset]);

    // Helper function to safely convert to Date
    const toSafeDate = (dateValue: any): Date => {
        if (!dateValue) return new Date();

        // If it's a Firestore Timestamp
        if (dateValue.toDate && typeof dateValue.toDate === 'function') {
            return dateValue.toDate();
        }

        // If it's already a Date
        if (dateValue instanceof Date) {
            return dateValue;
        }

        // If it's a string or number, try to parse
        return new Date(dateValue);
    };

    const populateFormForEditing = () => {
        if (!editingTodo) return;

        try {
            logger.log('🔍 [FORM] Populating form for editing:', {
                todoId: editingTodo.id,
                scheduledDateTime: editingTodo.scheduledDateTime,
                scheduledDateTimeType: typeof editingTodo.scheduledDateTime
            });

            const scheduledDate = toSafeDate(editingTodo.scheduledDateTime);
            
            // Fix: Use local timezone formatting instead of UTC
            const year = scheduledDate.getFullYear();
            const month = String(scheduledDate.getMonth() + 1).padStart(2, '0');
            const day = String(scheduledDate.getDate()).padStart(2, '0');
            const dateString = `${year}-${month}-${day}`;
            
            const hours = String(scheduledDate.getHours()).padStart(2, '0');
            const minutes = String(scheduledDate.getMinutes()).padStart(2, '0');
            const timeString = `${hours}:${minutes}`;

            logger.log('🔍 [FORM] Extracted date/time:', { dateString, timeString });

            reset({
                title: editingTodo.title,
                description: editingTodo.description || '',
                scheduledDate: dateString,
                scheduledTime: timeString,
                priority: editingTodo.priority,
                category: editingTodo.category || '',
                enableSmsReminder: editingTodo.enableSmsReminder !== false,
            });
        } catch (error) {
            logger.error('❌ [FORM] Error populating form:', error);
            setError('Error loading todo data for editing');
        }
    };

    const onSubmit = async (data: TodoFormData) => {
        if (!user) {
            setError('You must be logged in to create todos');
            return;
        }

        setLoading(true);
        setError('');

        try {
            logger.log('📝 [FORM] Submitting todo form:', data);

            // Combine date and time
            const scheduledDateTime = new Date(`${data.scheduledDate}T${data.scheduledTime}`);
            logger.log('📅 [FORM] Created scheduled date:', scheduledDateTime);

            // More lenient validation - only block if significantly in the past (more than 5 minutes)
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            if (scheduledDateTime < fiveMinutesAgo) {
                setError('Please select a time that is not too far in the past');
                setLoading(false);
                return;
            }

            const todoData = {
                adminId: user.uid,
                title: data.title.trim(),
                description: data.description?.trim() || '',
                scheduledDateTime: Timestamp.fromDate(scheduledDateTime),
                priority: data.priority,
                category: data.category?.trim() || '',
                isCompleted: false,
                isReminderSent: false,
                isActive: true,
                enableSmsReminder: data.enableSmsReminder,
            };

            logger.log('📝 [FORM] Todo data to save:', {
                ...todoData,
                scheduledDateTime: scheduledDateTime // Log as regular date for readability
            });

            let response;
            if (editingTodo) {
                // Update existing todo
                logger.log('📝 [FORM] Updating existing todo:', editingTodo.id);
                response = await todoOperations.updateTodo(editingTodo.id, todoData);
            } else {
                // Create new todo
                logger.log('📝 [FORM] Creating new todo');
                response = await todoOperations.createTodo(todoData);
            }

            logger.log('📝 [FORM] Save response:', response);

            if (response.success) {
                logger.log('✅ [FORM] Todo saved successfully');
                onSuccess();
                handleClose();
            } else {
                logger.error('❌ [FORM] Failed to save todo:', response.error);
                setError(response.error || 'Failed to save todo item');
            }
        } catch (error: any) {
            logger.error('❌ [FORM] Error in form submission:', error);
            setError(error.message || 'An error occurred while saving the todo item');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        reset();
        setError('');
        onClose();
    };

    // Generate time slots (every 30 minutes)
    const generateTimeSlots = () => {
        const slots = [];
        for (let hour = 0; hour < 24; hour++) {
            slots.push(`${hour.toString().padStart(2, '0')}:00`);
            slots.push(`${hour.toString().padStart(2, '0')}:30`);
        }
        return slots;
    };

    const timeSlots = generateTimeSlots();

    // Get minimum date (today)
    const today = new Date().toLocaleDateString('en-CA', {
        timeZone: 'America/Los_Angeles'
    });

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title={editingTodo ? 'Edit Todo' : 'Add New Todo'}
            icon={<div className="bg-primary-100 p-2 rounded-lg"><CheckSquare className="h-6 w-6 text-primary-600"/></div>}
            maxWidth="max-w-lg"
        >
                    <div className="p-6">
                        <ErrorAlert message={error} className="mb-6" />

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                            {/* Title */}
                            <div>
                                <label className="block text-sm font-medium text-secondary-700 mb-2">
                                    Title *
                                </label>
                                <input
                                    {...register('title')}
                                    className="input w-full"
                                    placeholder="Enter todo title..."
                                />
                                {errors.title && (
                                    <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
                                )}
                            </div>

                            {/* Description */}
                            <div>
                                <label className="block text-sm font-medium text-secondary-700 mb-2">
                                    Description
                                </label>
                                <textarea
                                    {...register('description')}
                                    rows={3}
                                    className="input w-full resize-none"
                                    placeholder="Add additional details..."
                                />
                            </div>

                            {/* Date and Time */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                                        <Calendar className="inline h-4 w-4 mr-2"/>
                                        Date *
                                    </label>
                                    <input
                                        {...register('scheduledDate')}
                                        type="date"
                                        min={today}
                                        className="input w-full"
                                    />
                                    {errors.scheduledDate && (
                                        <p className="mt-1 text-sm text-red-600">{errors.scheduledDate.message}</p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                                        <Clock className="inline h-4 w-4 mr-2"/>
                                        Time *
                                    </label>
                                    <select {...register('scheduledTime')} className="input w-full">
                                        <option value="">Select time...</option>
                                        {timeSlots.map((time) => (
                                            <option key={time} value={time}>
                                                {new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', {
                                                    hour: 'numeric',
                                                    minute: '2-digit',
                                                    hour12: true
                                                })}
                                            </option>
                                        ))}
                                    </select>
                                    {errors.scheduledTime && (
                                        <p className="mt-1 text-sm text-red-600">{errors.scheduledTime.message}</p>
                                    )}
                                </div>
                            </div>

                            {/* Priority and Category */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                                        Priority *
                                    </label>
                                    <select {...register('priority')} className="input w-full">
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                    </select>
                                    {errors.priority && (
                                        <p className="mt-1 text-sm text-red-600">{errors.priority.message}</p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                                        Category
                                    </label>
                                    <input
                                        {...register('category')}
                                        className="input w-full"
                                        placeholder="e.g., Meeting, Call, Review..."
                                    />
                                </div>
                            </div>

                            {/* SMS Reminder Checkbox */}
                            <div className="flex items-start space-x-3 p-4 bg-secondary-50 border border-secondary-200 rounded-lg">
                                <div className="flex items-center h-5">
                                    <input
                                        {...register('enableSmsReminder')}
                                        id="enableSmsReminder"
                                        type="checkbox"
                                        className="w-4 h-4 text-primary-600 bg-secondary-100 border-secondary-300 rounded focus:ring-primary-500 focus:ring-2"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label htmlFor="enableSmsReminder" className="flex items-center text-sm font-medium text-secondary-700 cursor-pointer">
                                        <MessageSquare className="h-4 w-4 mr-2 text-primary-500"/>
                                        Enable SMS Reminder
                                    </label>
                                    <p className="text-xs text-secondary-500 mt-1">
                                        Receive a text message reminder at the scheduled time
                                    </p>
                                </div>
                            </div>

                            {/* Conditional Info Note - only show when SMS is enabled */}
                            {enableSmsReminder && (
                                <div className="p-4 bg-primary-50 border border-primary-200 rounded-lg">
                                    <div className="flex items-start space-x-3">
                                        <CheckCircle2 className="h-5 w-5 text-primary-500 mt-0.5"/>
                                        <div className="text-sm text-primary-700">
                                            <p className="font-medium mb-1">SMS Reminder Enabled</p>
                                            <p>You'll receive an SMS reminder at the scheduled time. Make sure your phone
                                                number is set in your profile.</p>
                                        </div>
                                    </div>
                                </div>
                            )}

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
                                    <CheckSquare className="h-4 w-4 mr-2"/>
                                    {editingTodo ? 'Update Todo' : 'Add Todo'}
                                </Button>
                            </div>
                        </form>
                    </div>
        </Modal>
    );
};