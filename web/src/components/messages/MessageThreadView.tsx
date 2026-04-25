import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { useAuth } from '../../hooks/useAuth';
import { isAdminRole } from '../../lib/roles';
import { messageThreadOperations, notificationOperations } from '../../lib/firestore';
import { MessageThread, ThreadMessage } from '../../types';
import {
    Send,
    Paperclip,
    User,
    CheckCircle2,
    X,
    FileText,
    Image,
    Download,
    Trash2
} from 'lucide-react';
import { formatFileSize, validateMessageAttachment, uploadMessageAttachment } from '../../lib/storage';
import { getThreadStatusColor } from '../../lib/status-helpers';
import { ConfirmModal } from '../ui/ConfirmModal';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import logger from "../../lib/logger";
import { formatDisplayName } from '../../lib/user-helpers';
import { formatDate, formatMessageStamp } from '../../lib/date-helpers';
import { errorMessage } from '../../lib/errors';

interface MessageThreadViewProps {
    thread: MessageThread;
    onThreadUpdate: (updatedThread: MessageThread) => void; // Changed signature
}

export const MessageThreadView: React.FC<MessageThreadViewProps> = ({
                                                                        thread,
                                                                        onThreadUpdate,
                                                                    }) => {
    const {user, userProfile} = useAuth();
    const [messages, setMessages] = useState<ThreadMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [attachments, setAttachments] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});
    const [actionError, setActionError] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const hasMarkedAsRead = useRef<boolean>(false);

    // Real-time listener for messages
    useEffect(() => {
        hasMarkedAsRead.current = false;
        setLoading(true);

        const unsubscribe = messageThreadOperations.onThreadMessages(thread.id, async (msgs) => {
            setMessages(msgs);
            setLoading(false);

            // Mark as read only once when opening the thread
            if (user?.uid && !hasMarkedAsRead.current) {
                const isAdmin = isAdminRole(userProfile?.role);
                const isUnread = isAdmin ? thread.unreadForAdmin : thread.unreadForPatient;

                if (isUnread) {
                    hasMarkedAsRead.current = true;
                    if (isAdmin) {
                        await messageThreadOperations.markAsReadForAdmin(thread.id, user.uid);
                    } else {
                        await messageThreadOperations.markAsReadForPatient(thread.id);
                    }

                    const threadResponse = await messageThreadOperations.getThreadById(thread.id);
                    if (threadResponse.success && threadResponse.data) {
                        onThreadUpdate(threadResponse.data);
                    }
                }
            }
        });

        return () => unsubscribe();
        // `user.uid` and the role drive the mark-as-read branch; without them
        // in deps, switching impersonated user keeps the stale closure and
        // marks-as-read fires for the wrong identity.
    }, [thread.id, user?.uid, userProfile?.role, thread.unreadForAdmin, thread.unreadForPatient, onThreadUpdate]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
    };

    const handleSendMessage = async () => {
        if ((!newMessage.trim() && attachments.length === 0) || !user || !userProfile) return;

        setSending(true);
        if (attachments.length > 0) setUploading(true);

        try {
            // Upload attachments
            const uploadedAttachments = [];
            for (let i = 0; i < attachments.length; i++) {
                const file = attachments[i];
                const fileKey = `${file.name}-${file.size}`;

                const uploadResult = await uploadMessageAttachment(
                    file,
                    thread.id,
                    (progress) => {
                        setUploadProgress(prev => ({
                            ...prev,
                            [fileKey]: progress.progress
                        }));
                    }
                );

                if (uploadResult.success) {
                    uploadedAttachments.push({
                        id: `${Date.now()}-${i}`,
                        name: uploadResult.fileName || file.name,
                        url: uploadResult.fileUrl!,
                        type: file.type,
                        size: file.size,
                    });
                } else {
                    throw new Error(`Failed to upload ${file.name}`);
                }
            }

            const messageData = {
                threadId: thread.id,
                senderId: user.uid,
                senderName: formatDisplayName(userProfile ?? { email: user.email }, 'Unknown'),
                senderRole: userProfile.role,
                content: newMessage.trim() || (uploadedAttachments.length > 0 ? '[Attachment]' : ''),
                attachments: uploadedAttachments,
            };

            const response = await messageThreadOperations.sendMessage(messageData);
            if (response.success) {
                setNewMessage('');
                setAttachments([]);
                setUploadProgress({});

                // onSnapshot listener will pick up the new message automatically

                // Send notification to the other party
                const senderName = formatDisplayName(userProfile, 'Someone');
                const preview = (newMessage.trim() || '[Attachment]').slice(0, 80);
                if (isAdminRole(userProfile.role)) {
                    // Admin replied → notify the patient
                    await notificationOperations.createNotification({
                        recipientRole: 'patient',
                        recipientId: thread.patientId,
                        type: 'new_message',
                        title: 'New Message from Your Doctor',
                        message: `Re: ${thread.subject} — "${preview}"`,
                        meta: { threadId: thread.id },
                    });
                } else {
                    // Patient sent → notify admins
                    await notificationOperations.createNotification({
                        recipientRole: 'admin',
                        type: 'new_message',
                        title: `New Message from ${senderName}`,
                        message: `Re: ${thread.subject} — "${preview}"`,
                        meta: { threadId: thread.id, patientId: user.uid },
                    });
                }

                // Fetch updated thread and notify parent
                const threadResponse = await messageThreadOperations.getThreadById(thread.id);
                if (threadResponse.success && threadResponse.data) {
                    onThreadUpdate(threadResponse.data);
                }
            } else {
                throw new Error(response.error || 'Failed to send message');
            }
        } catch (error: unknown) {
            logger.error('Error sending message:', error);
            setActionError(`Error sending message: ${errorMessage(error)}`);
        } finally {
            setSending(false);
            setUploading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const isMessageRead = (_message: ThreadMessage, _userId: string) => {
        return true; // All sent messages treated as delivered
    };

    const getStatusColor = getThreadStatusColor;

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const validFiles: File[] = [];
        const errors: string[] = [];

        files.forEach(file => {
            const validation = validateMessageAttachment(file);
            if (validation.valid) {
                validFiles.push(file);
            } else {
                errors.push(`${file.name}: ${validation.error}`);
            }
        });

        if (errors.length > 0) {
            setActionError(`Some files were not added: ${errors.join(', ')}`);
        }

        if (validFiles.length > 0) {
            setAttachments(prev => [...prev, ...validFiles]);
        }

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const openFileDialog = () => {
        fileInputRef.current?.click();
    };

    const downloadAttachment = (url: string, filename: string) => {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.target = '_blank';
        link.click();
    };

    const handleDeleteMessage = async (messageId: string) => {
        setDeleteConfirmId(null);
        try {
            const response = await messageThreadOperations.softDeleteMessage(messageId);
            if (response.success) {

                // Fetch updated thread
                const threadResponse = await messageThreadOperations.getThreadById(thread.id);
                if (threadResponse.success && threadResponse.data) {
                    onThreadUpdate(threadResponse.data);
                }
            } else {
                setActionError(`Failed to delete message: ${response.error}`);
            }
        } catch (error: unknown) {
            logger.error('Error deleting message:', error);
            setActionError(`Error deleting message: ${errorMessage(error)}`);
        }
    };

    const getFileIcon = (fileType: string) => {
        if (fileType.startsWith('image/')) {
            return <Image className="w-4 h-4"/>;
        } else if (fileType === 'application/pdf') {
            return <FileText className="w-4 h-4 text-red-500"/>;
        } else {
            return <FileText className="w-4 h-4"/>;
        }
    };

    const canDeleteMessage = (message: ThreadMessage) => {
        return message.senderId === user?.uid && message.content !== 'Message deleted';
    };

    const canReply = thread.status !== 'closed' && thread.status !== 'resolved';

    return (
        <>
        <div className="flex flex-col h-full">
            {/* Thread Header */}
            <div className="p-4 border-b border-secondary-200 bg-surface-card">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <h2 className="text-lg font-semibold text-secondary-900 mb-2">
                            {thread.subject}
                        </h2>
                        <div className="flex items-center space-x-4 text-sm text-secondary-600">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(thread.status)}`}>
                {thread.status.replace('_', ' ')}
              </span>
                            <span>Priority: {thread.priority}</span>
                            <span>Created: {thread.createdAt ? formatDate(thread.createdAt) : '—'}</span>
                        </div>
                    </div>

                    {isAdminRole(userProfile?.role) && (
                        <div className="flex items-center space-x-2">
                            <select
                                value={thread.status}
                                onChange={async (e) => {
                                    const next = e.target.value as MessageThread['status'];
                                    await messageThreadOperations.updateThreadStatus(thread.id, next);
                                    const threadResponse = await messageThreadOperations.getThreadById(thread.id);
                                    if (threadResponse.success && threadResponse.data) {
                                        onThreadUpdate(threadResponse.data);
                                    }
                                }}
                                className="text-sm border border-secondary-300 rounded px-3 py-1"
                            >
                                <option value="open">Open</option>
                                <option value="in_progress">In Progress</option>
                                <option value="resolved">Resolved</option>
                                <option value="closed">Closed</option>
                            </select>
                        </div>
                    )}
                </div>
            </div>

            {/* Messages List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                    <div className="flex items-center justify-center h-32">
                        <LoadingSpinner size="md" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="text-center text-secondary-500 py-8">
                        <p>No messages in this thread yet.</p>
                    </div>
                ) : (
                    messages.map((message) => {
                        const isOwnMessage = message.senderId === user?.uid;
                        const isRead = user?.uid ? isMessageRead(message, user.uid) : false;

                        return (
                            <div
                                key={message.id}
                                className={`group flex items-start gap-1 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                            >
                                {/* Delete button — hover reveal, before own messages */}
                                {isOwnMessage && canDeleteMessage(message) && (
                                    <button
                                        onClick={() => setDeleteConfirmId(message.id)}
                                        className="opacity-0 group-hover:opacity-100 mt-5 p-1.5 rounded-lg text-secondary-400 hover:text-red-500 hover:bg-red-50 transition-all shrink-0"
                                        title="Delete message"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                                <div
                                    className={`max-w-2xl ${isOwnMessage ? 'bg-primary-700 text-white' : 'bg-surface-card border border-secondary-200'} rounded-lg p-4 shadow-sm`}>
                                    {/* Message Header */}
                                    <div className="flex items-center justify-between mb-2 gap-3">
                                        <div className="flex items-center space-x-2">
                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                                                message.senderRole === 'admin' ? 'bg-purple-100' : 'bg-primary-100'
                                            }`}>
                                                <User className={`w-3 h-3 ${
                                                    message.senderRole === 'admin' ? 'text-purple-600' : 'text-primary-600'
                                                }`}/>
                                            </div>
                                            <span
                                                className={`text-xs font-medium ${isOwnMessage ? 'text-white' : 'text-secondary-700'}`}>
                        {message.senderName}
                      </span>
                                            {message.senderRole === 'admin' && (
                                                <span
                                                    className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-full">
                          Admin
                        </span>
                                            )}
                                        </div>
                                        <div className="flex items-center space-x-2">
                      <span className={`text-xs ${isOwnMessage ? 'text-white opacity-75' : 'text-secondary-500'}`}>
                        {formatMessageStamp(message.createdAt)}
                      </span>
                                            {isOwnMessage && isRead && (
                                                <CheckCircle2 className="w-3 h-3 text-green-300"/>
                                            )}
                                            {/* Delete for received messages — hover reveal */}
                                            {!isOwnMessage && canDeleteMessage(message) && (
                                                <button
                                                    onClick={() => setDeleteConfirmId(message.id)}
                                                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-secondary-400 hover:text-red-500 transition-all"
                                                    title="Delete message"
                                                >
                                                    <Trash2 className="w-3 h-3"/>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Message Content */}
                                    <div className={`text-sm ${isOwnMessage ? 'text-white' : 'text-secondary-900'}`}>
                                        {message.content === 'Message deleted' ? (
                                            <p className="whitespace-pre-wrap italic opacity-60">{message.content}</p>
                                        ) : (
                                            <p className="whitespace-pre-wrap">{message.content}</p>
                                        )}
                                    </div>

                                    {/* Attachments */}
                                    {message.attachments && message.attachments.length > 0 && (
                                        <div className="mt-3 space-y-2">
                                            {message.attachments.map((attachment, index) => (
                                                <div key={index} className={`flex items-center space-x-2 p-2 rounded ${
                                                    isOwnMessage ? 'bg-primary-800' : 'bg-secondary-50'
                                                }`}>
                                                    {getFileIcon(attachment.type)}
                                                    <span className="text-xs truncate flex-1">{attachment.name}</span>
                                                    <span className="text-xs">{formatFileSize(attachment.size)}</span>
                                                    <button
                                                        onClick={() => downloadAttachment(attachment.url, attachment.name)}
                                                        className={`p-1 rounded hover:bg-opacity-20 hover:bg-white ${
                                                            isOwnMessage ? 'text-white' : 'text-secondary-600'
                                                        }`}
                                                    >
                                                        <Download className="w-3 h-3"/>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={messagesEndRef}/>
            </div>

            {/* Reply Section */}
            {canReply && (
                <div className="p-4 border-t border-secondary-200 bg-surface-card">
                    {/* Attachment Preview */}
                    {attachments.length > 0 && (
                        <div className="mb-3 space-y-2">
                            <div className="text-sm font-medium text-secondary-700">
                                Attachments ({attachments.length})
                            </div>
                            {attachments.map((file, index) => {
                                const fileKey = `${file.name}-${file.size}`;
                                const progress = uploadProgress[fileKey];

                                return (
                                    <div key={index}
                                         className="flex items-center space-x-3 p-2 bg-secondary-50 rounded-lg">
                                        {getFileIcon(file.type)}
                                        <div className="flex-1">
                                            <div className="text-sm text-secondary-900">{file.name}</div>
                                            <div
                                                className="text-xs text-secondary-500">{formatFileSize(file.size)}</div>
                                            {progress !== undefined && progress < 100 && (
                                                <div className="w-full bg-secondary-200 rounded-full h-2 mt-1">
                                                    <div
                                                        className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                                                        style={{width: `${progress}%`}}
                                                    ></div>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => removeAttachment(index)}
                                            disabled={uploading}
                                            className="p-1 text-secondary-400 hover:text-red-500 disabled:opacity-50"
                                        >
                                            <X className="w-4 h-4"/>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <ErrorAlert message={actionError} className="mb-2" />

                    <div className="flex space-x-3">
                        <div className="flex-1">
              <textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Type your message here..."
                  rows={3}
                  className="w-full resize-none border border-secondary-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
                        </div>
                        <div className="flex flex-col justify-end space-y-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={openFileDialog}
                                disabled={uploading || sending}
                                title="Attach files"
                            >
                                <Paperclip className="w-4 h-4"/>
                            </Button>
                            <Button
                                onClick={handleSendMessage}
                                disabled={(!newMessage.trim() && attachments.length === 0) || sending || uploading}
                                loading={sending || uploading}
                                size="sm"
                            >
                                <Send className="w-4 h-4"/>
                            </Button>
                        </div>
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,.pdf,.doc,.docx,.txt,.csv"
                        onChange={handleFileSelect}
                        className="hidden"
                    />

                    {uploading && (
                        <div className="mt-2 flex items-center space-x-2 text-sm text-secondary-600">
                            <LoadingSpinner size="sm" />
                            <span>Uploading attachments...</span>
                        </div>
                    )}
                </div>
            )}

            {!canReply && (
                <div className="p-4 border-t border-secondary-200 bg-secondary-50 text-center">
                    <p className="text-sm text-secondary-600">
                        This conversation has been {thread.status}. No further replies are allowed.
                    </p>
                </div>
            )}
        </div>

        <ConfirmModal
            isOpen={!!deleteConfirmId}
            onClose={() => setDeleteConfirmId(null)}
            onConfirm={() => deleteConfirmId && handleDeleteMessage(deleteConfirmId)}
            title="Delete Message"
            message="Are you sure you want to delete this message?"
            confirmLabel="Delete"
            variant="danger"
        />
        </>
    );
};