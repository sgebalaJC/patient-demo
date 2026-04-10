import React, {useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {MessageSquare} from 'lucide-react';
import {Button} from '../ui/Button';
import {ErrorAlert} from '../ui/ErrorAlert';
import {Input} from '../ui/Input';
import {messageThreadOperations} from '../../lib/firestore';
import { FIELD_LIMITS } from '../../lib/validation';
import logger from "../../lib/logger";
import { Modal } from '../ui/Modal';
import { useAuth } from '../../hooks/useAuth';

const newMessageSchema = z.object({
    subject: z.string().min(1, 'Subject is required').min(FIELD_LIMITS.messageSubject.min, `Subject must be at least ${FIELD_LIMITS.messageSubject.min} characters`).max(FIELD_LIMITS.messageSubject.max, `Subject must be less than ${FIELD_LIMITS.messageSubject.max} characters`),
    message: z.string().min(1, 'Message is required').min(FIELD_LIMITS.messageContent.min, `Message must be at least ${FIELD_LIMITS.messageContent.min} characters`).max(FIELD_LIMITS.messageContent.max, `Message must be less than ${FIELD_LIMITS.messageContent.max} characters`),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
});

type NewMessageFormData = z.infer<typeof newMessageSchema>;

interface NewMessageModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (threadId?: string) => void; // Changed to accept threadId
    patientId: string;
}

export const NewMessageModal: React.FC<NewMessageModalProps> = ({
                                                                    isOpen,
                                                                    onClose,
                                                                    onSuccess,
                                                                    patientId,
                                                                }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>('');
    const {user, userProfile} = useAuth();

    const {
        register,
        handleSubmit,
        formState: {errors},
        reset,
    } = useForm<NewMessageFormData>({
        resolver: zodResolver(newMessageSchema),
        defaultValues: {
            priority: 'normal',
        },
    });

    const onSubmit = async (data: NewMessageFormData) => {
        setLoading(true);
        setError('');

        try {
            // Create new thread
            const threadData = {
                patientId,
                subject: data.subject,
                priority: data.priority,
                status: 'open' as const,
                isActive: true,
                tags: [],
            };

            const threadResponse = await messageThreadOperations.createThread(threadData);

            if (!threadResponse.success || !threadResponse.data) {
                throw new Error(threadResponse.error || 'Failed to create thread');
            }

            if (!user || !userProfile) {
                setError('You must be logged in to send messages.');
                return;
            }

            const threadId = threadResponse.data.id;

            // Send initial message
            const messageData = {
                threadId,
                senderId: patientId,
                senderName: userProfile ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || user.email || 'Unknown' : user.email || 'Unknown',
                senderRole: userProfile.role,
                content: data.message,
                attachments: [],
            };

            const messageResponse = await messageThreadOperations.sendMessage(messageData);

            if (messageResponse.success) {
                reset();
                onClose();
                onSuccess(threadId); // Pass threadId back
            } else {
                throw new Error(messageResponse.error || 'Failed to send message');
            }
        } catch (error: any) {
            logger.error('Error creating message:', error);
            setError(error.message || 'Failed to send message');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        reset();
        setError('');
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title="New Message"
            icon={<div className="bg-primary-100 p-2 rounded-lg"><MessageSquare className="h-6 w-6 text-primary-600"/></div>}
        >
                    <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
                        <ErrorAlert message={error} />

                        <div className="space-y-4">
                            <Input
                                {...register('subject')}
                                label="Subject"
                                placeholder="Brief description of your message..."
                                error={errors.subject?.message}
                            />

                            <div>
                                <label className="block text-sm font-medium text-secondary-700 mb-2">
                                    Priority Level
                                </label>
                                <select
                                    {...register('priority')}
                                    className="input w-full"
                                >
                                    <option value="low">Low - General inquiry</option>
                                    <option value="normal">Normal - Standard message</option>
                                    <option value="high">High - Important question</option>
                                    <option value="urgent">Urgent - Needs immediate attention</option>
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
                                    placeholder="Please describe your question or concern in detail..."
                                    className="input w-full resize-none"
                                />
                                {errors.message && (
                                    <p className="text-sm text-red-600 mt-1">{errors.message.message}</p>
                                )}
                            </div>
                        </div>

                        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
                            <h4 className="text-sm font-medium text-primary-900 mb-2">Message Guidelines</h4>
                            <ul className="text-sm text-primary-700 space-y-1">
                                <li>• Be specific about your question or concern</li>
                                <li>• Include relevant symptoms, dates, or medical history</li>
                                <li>• For urgent medical issues, please call emergency services</li>
                                <li>• Admin team typically responds within 24 hours</li>
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
                            >
                                Send Message
                            </Button>
                        </div>
                    </form>
        </Modal>
    );
};