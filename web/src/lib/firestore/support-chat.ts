import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  where,
  serverTimestamp,
  DocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { ChatAttachment, AgentChatMessage } from './agent-chat';

export type { ChatAttachment, AgentChatMessage as SupportChatMessage };

const chatCollection = collection(db, 'support-chat');

/**
 * Save a support chat message scoped to a patient.
 */
export async function saveSupportChatMessage(msg: {
  patientId: string;
  role: 'user' | 'assistant';
  content: string;
  senderId?: string;
  senderName?: string;
  attachments?: ChatAttachment[];
}): Promise<string> {
  // Strip undefined fields — Firestore rejects them
  const data: Record<string, unknown> = {
    patientId: msg.patientId,
    role: msg.role,
    content: msg.content,
    createdAt: serverTimestamp(),
  };
  if (msg.senderId) data.senderId = msg.senderId;
  if (msg.senderName) data.senderName = msg.senderName;
  if (msg.attachments && msg.attachments.length > 0) data.attachments = msg.attachments;
  const docRef = await addDoc(chatCollection, data);
  return docRef.id;
}

/**
 * Load support chat messages for a specific patient.
 * Newest first with cursor-based pagination, returned in chronological order.
 */
export async function loadSupportChatMessages(
  patientId: string,
  pageSize: number = 50,
  lastDoc?: DocumentSnapshot
): Promise<{
  messages: AgentChatMessage[];
  lastDoc: DocumentSnapshot | null;
  hasMore: boolean;
}> {
  let q = query(
    chatCollection,
    where('patientId', '==', patientId),
    orderBy('createdAt', 'desc'),
    limit(pageSize + 1)
  );

  if (lastDoc) {
    q = query(
      chatCollection,
      where('patientId', '==', patientId),
      orderBy('createdAt', 'desc'),
      startAfter(lastDoc),
      limit(pageSize + 1)
    );
  }

  const snapshot = await getDocs(q);
  const hasMore = snapshot.docs.length > pageSize;
  const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;

  const messages = docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  } as AgentChatMessage));

  // Return in chronological order
  messages.reverse();

  return {
    messages,
    lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore,
  };
}
