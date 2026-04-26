import {
    doc,
    addDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
    onSnapshot,
} from 'firebase/firestore';
import { collections, logAuthContext, mapDocStrict } from './base';
import { MessageThread, ThreadMessage, ApiResponse } from '../../types';

const THREAD_REQUIRED: ReadonlyArray<keyof MessageThread> = [
  'patientId',
  'subject',
  'status',
  'priority',
];

const THREAD_MESSAGE_REQUIRED: ReadonlyArray<keyof ThreadMessage> = [
  'threadId',
  'senderId',
  'senderRole',
  'content',
];

function toThread(snap: Parameters<typeof mapDocStrict>[0]): MessageThread | null {
  return mapDocStrict<MessageThread>(snap, THREAD_REQUIRED, 'message-threads');
}

function toThreadMessage(snap: Parameters<typeof mapDocStrict>[0]): ThreadMessage | null {
  return mapDocStrict<ThreadMessage>(snap, THREAD_MESSAGE_REQUIRED, 'thread-messages');
}
import { deleteMessageAttachments } from '../storage';
import logger from "../logger";
import { errorMessage } from '../errors';
import { audit } from "../audit";

export const messageThreadOperations = {
    // Create message thread
    async createThread(threadData: Omit<MessageThread, 'id' | 'createdAt' | 'updatedAt' | 'unreadForPatient' | 'unreadForAdmin'>): Promise<ApiResponse<MessageThread>> {
        try {
            const newThread = {
                ...threadData,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                isActive: threadData.isActive !== undefined ? threadData.isActive : true,
                unreadForPatient: false,
                unreadForAdmin: true,
                status: threadData.status || 'open',
                priority: threadData.priority || 'normal',
                tags: threadData.tags || [],
            };

            const docRef = await addDoc(collections.messageThreads, newThread);
            const createdDoc = await getDoc(docRef);
            const createdThread = toThread(createdDoc);
            if (!createdThread) {
                return { success: false, error: 'Thread created but could not be re-read' };
            }

            audit({ action: 'thread.created', resourceType: 'message-thread', resourceId: docRef.id, metadata: { patientId: threadData.patientId, priority: threadData.priority } });
            return { success: true, data: createdThread };
        } catch (error: unknown) {
            logger.error('Error creating thread:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Get thread by ID
    async getThreadById(threadId: string): Promise<ApiResponse<MessageThread>> {
        try {
            const threadDoc = await getDoc(doc(collections.messageThreads, threadId));
            const mapped = toThread(threadDoc);
            if (!mapped) {
                return { success: false, error: 'Thread not found' };
            }
            return { success: true, data: mapped };
        } catch (error: unknown) {
            logger.error('Error getting thread by ID:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Get patient threads with pagination
    async getPatientThreads(
        patientId: string,
        limitParam: number = 10,
        page: number = 1,
        filter: 'all' | 'unread' | 'priority' = 'all'
    ): Promise<ApiResponse<{
        threads: MessageThread[],
        total: number,
        hasMore: boolean,
        currentPage: number
    }>> {
        try {
            const threadsQuery = query(
                collections.messageThreads,
                where('isActive', '==', true),
                where('patientId', '==', patientId),
                orderBy('updatedAt', 'desc')
            );

            const snapshot = await getDocs(threadsQuery);
            let allThreads = snapshot.docs
                .map(toThread)
                .filter((t): t is MessageThread => t !== null);

            let filteredThreads = allThreads;
            switch (filter) {
                case 'unread':
                    filteredThreads = allThreads.filter(thread => thread.unreadForPatient);
                    break;
                case 'priority':
                    filteredThreads = allThreads.filter(thread =>
                        thread.priority === 'high' || thread.priority === 'urgent'
                    );
                    break;
            }

            const startIndex = (page - 1) * limitParam;
            const endIndex = startIndex + limitParam;
            const paginatedThreads = filteredThreads.slice(startIndex, endIndex);

            return {
                success: true,
                data: {
                    threads: paginatedThreads,
                    total: filteredThreads.length,
                    hasMore: endIndex < filteredThreads.length,
                    currentPage: page
                }
            };
        } catch (error: unknown) {
            logger.error('Error getting patient threads:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Get admin threads with pagination
    async getAdminThreads(
        limitParam: number = 10,
        page: number = 1,
        filter: 'all' | 'unread' | 'priority' = 'all',
        _currentUserId?: string
    ): Promise<ApiResponse<{
        threads: MessageThread[],
        total: number,
        hasMore: boolean,
        currentPage: number
    }>> {
        try {
            const threadsQuery = query(
                collections.messageThreads,
                where('isActive', '==', true),
                orderBy('updatedAt', 'desc')
            );

            const snapshot = await getDocs(threadsQuery);
            let threads = snapshot.docs
                .map(toThread)
                .filter((t): t is MessageThread => t !== null);

            let filteredThreads = threads;
            switch (filter) {
                case 'unread':
                    filteredThreads = threads.filter(thread => thread.unreadForAdmin);
                    break;
                case 'priority':
                    filteredThreads = threads.filter(thread =>
                        thread.priority === 'high' || thread.priority === 'urgent'
                    );
                    break;
            }

            const startIndex = (page - 1) * limitParam;
            const endIndex = startIndex + limitParam;
            const paginatedThreads = filteredThreads.slice(startIndex, endIndex);

            return {
                success: true,
                data: {
                    threads: paginatedThreads,
                    total: filteredThreads.length,
                    hasMore: endIndex < filteredThreads.length,
                    currentPage: page
                }
            };
        } catch (error: unknown) {
            logger.error('Error getting admin threads:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Real-time listener for patient's thread list
    onPatientThreads(patientId: string, callback: (threads: MessageThread[]) => void): () => void {
        const q = query(
            collections.messageThreads,
            where('isActive', '==', true),
            where('patientId', '==', patientId),
            orderBy('updatedAt', 'desc')
        );
        return onSnapshot(q, (snapshot) => {
            callback(
                snapshot.docs
                    .map(toThread)
                    .filter((t): t is MessageThread => t !== null),
            );
        }, (error) => {
            logger.error('Error listening to patient threads:', error);
        });
    },

    // Real-time listener for admin thread list
    onAdminThreads(callback: (threads: MessageThread[]) => void): () => void {
        const q = query(
            collections.messageThreads,
            where('isActive', '==', true),
            orderBy('updatedAt', 'desc')
        );
        return onSnapshot(q, (snapshot) => {
            callback(
                snapshot.docs
                    .map(toThread)
                    .filter((t): t is MessageThread => t !== null),
            );
        }, (error) => {
            logger.error('Error listening to admin threads:', error);
        });
    },

    // Send message to thread
    async sendMessage(messageData: Omit<ThreadMessage, 'id' | 'createdAt' | 'readBy' | 'isEdited' | 'editedAt'>): Promise<ApiResponse<ThreadMessage>> {
        try {
            logAuthContext('sendMessage');

            const newMessage = {
                ...messageData,
                createdAt: serverTimestamp(),
                isEdited: false,
            };

            const docRef = await addDoc(collections.threadMessages, newMessage);

            // Update thread metadata + unread flags
            const lastMessagePreview = messageData.attachments && messageData.attachments.length > 0
                ? messageData.content || `Attachment (${messageData.attachments.length})`
                : messageData.content;

            const threadRef = doc(collections.messageThreads, messageData.threadId);
            const isPatient = messageData.senderRole === 'patient';

            await updateDoc(threadRef, {
                lastMessage: lastMessagePreview,
                lastMessageAt: serverTimestamp(),
                lastMessageSenderId: messageData.senderId,
                updatedAt: serverTimestamp(),
                // Patient sent → unread for admin. Admin sent → unread for patient.
                unreadForAdmin: isPatient,
                unreadForPatient: !isPatient,
            });

            audit({ action: 'message.sent', resourceType: 'thread-message', resourceId: docRef.id, metadata: { threadId: messageData.threadId, senderRole: messageData.senderRole, hasAttachments: !!(messageData.attachments && messageData.attachments.length > 0) } });
            return { success: true, data: { id: docRef.id, ...newMessage } as ThreadMessage };
        } catch (error: unknown) {
            logger.error('Error sending thread message:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Mark thread as read for patient
    async markAsReadForPatient(threadId: string): Promise<ApiResponse<boolean>> {
        try {
            const threadRef = doc(collections.messageThreads, threadId);
            await updateDoc(threadRef, {
                unreadForPatient: false,
                updatedAt: serverTimestamp(),
            });
            return { success: true, data: true };
        } catch (error: unknown) {
            logger.error('Error marking thread as read for patient:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Mark thread as read for admin
    async markAsReadForAdmin(threadId: string, adminId: string): Promise<ApiResponse<boolean>> {
        try {
            const threadRef = doc(collections.messageThreads, threadId);
            await updateDoc(threadRef, {
                unreadForAdmin: false,
                lastReadByAdminId: adminId,
                lastReadByAdminAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            return { success: true, data: true };
        } catch (error: unknown) {
            logger.error('Error marking thread as read for admin:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Delete message and its attachments
    async deleteMessage(messageId: string): Promise<ApiResponse<boolean>> {
        try {
            logAuthContext('deleteMessage');

            const messageDoc = await getDoc(doc(collections.threadMessages, messageId));
            if (!messageDoc.exists()) {
                return { success: false, error: 'Message not found' };
            }

            const messageData = toThreadMessage(messageDoc);
            if (!messageData) {
                return { success: false, error: 'Message not found' };
            }

            if (messageData.attachments && messageData.attachments.length > 0) {
                const deleteResult = await deleteMessageAttachments(messageData.attachments);
                if (!deleteResult.success) {
                    logger.warn('Some attachments failed to delete:', deleteResult.errors);
                }
            }

            await deleteDoc(doc(collections.threadMessages, messageId));
            audit({ action: 'message.deleted', resourceType: 'thread-message', resourceId: messageId, metadata: { threadId: messageData.threadId } });
            return { success: true, data: true };
        } catch (error: unknown) {
            logger.error('Error deleting message:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Soft-delete: replace content with "Message deleted", remove attachments
    async softDeleteMessage(messageId: string): Promise<ApiResponse<boolean>> {
        try {
            const messageRef = doc(collections.threadMessages, messageId);
            const messageDoc = await getDoc(messageRef);
            if (!messageDoc.exists()) {
                return { success: false, error: 'Message not found' };
            }

            const messageData = toThreadMessage(messageDoc);
            if (!messageData) {
                return { success: false, error: 'Message not found' };
            }

            // Delete attachments from storage if any
            if (messageData.attachments && messageData.attachments.length > 0) {
                await deleteMessageAttachments(messageData.attachments);
            }

            // Replace content, keep the document
            await updateDoc(messageRef, {
                content: 'Message deleted',
                attachments: [],
                isEdited: true,
                editedAt: serverTimestamp(),
            });

            audit({ action: 'message.soft_deleted', resourceType: 'thread-message', resourceId: messageId, metadata: { threadId: messageData.threadId } });
            return { success: true, data: true };
        } catch (error: unknown) {
            logger.error('Error soft-deleting message:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Get thread messages
    async getThreadMessages(threadId: string): Promise<ApiResponse<ThreadMessage[]>> {
        try {
            const messagesQuery = query(
                collections.threadMessages,
                where('threadId', '==', threadId),
                orderBy('createdAt', 'asc')
            );

            const snapshot = await getDocs(messagesQuery);
            const messages = snapshot.docs
                .map(toThreadMessage)
                .filter((m): m is ThreadMessage => m !== null);

            return { success: true, data: messages };
        } catch (error: unknown) {
            logger.error('Error getting thread messages:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Real-time listener for thread messages
    onThreadMessages(threadId: string, callback: (messages: ThreadMessage[]) => void): () => void {
        const messagesQuery = query(
            collections.threadMessages,
            where('threadId', '==', threadId),
            orderBy('createdAt', 'asc')
        );

        return onSnapshot(messagesQuery, (snapshot) => {
            const messages = snapshot.docs
                .map(toThreadMessage)
                .filter((m): m is ThreadMessage => m !== null);
            callback(messages);
        }, (error) => {
            logger.error('Error listening to thread messages:', error);
        });
    },

    // Update thread status
    async updateThreadStatus(threadId: string, status: MessageThread['status']): Promise<ApiResponse<MessageThread>> {
        try {
            const threadRef = doc(collections.messageThreads, threadId);
            await updateDoc(threadRef, {
                status,
                updatedAt: serverTimestamp(),
            });
            const updatedThread = await getDoc(threadRef);
            const mapped = toThread(updatedThread);
            if (!mapped) {
                return { success: false, error: 'Thread updated but could not be re-read' };
            }
            audit({
                action: 'thread.status_changed',
                resourceType: 'message-thread',
                resourceId: threadId,
                metadata: { newStatus: status },
            });
            return { success: true, data: mapped };
        } catch (error: unknown) {
            logger.error('Error updating thread status:', error);
            return { success: false, error: errorMessage(error) };
        }
    },
};
