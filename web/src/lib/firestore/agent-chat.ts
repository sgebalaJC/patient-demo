import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  Timestamp,
  DocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';

const chatCollection = collection(db, 'agent-chat');

export interface ChatAttachment {
  name: string;
  mimeType: string;
  size?: number;
}

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  senderId?: string;
  senderName?: string;
  attachments?: ChatAttachment[];
  createdAt: Timestamp;
}

/**
 * Save a chat message to Firestore.
 */
export async function saveAgentChatMessage(msg: {
  role: 'user' | 'assistant';
  content: string;
  senderId?: string;
  senderName?: string;
  attachments?: ChatAttachment[];
}): Promise<string> {
  // Strip undefined fields — Firestore rejects them
  const data: Record<string, unknown> = {
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
 * Load chat messages, newest first, with cursor-based pagination.
 * Returns messages in chronological order (oldest first) for display.
 */
export async function loadAgentChatMessages(
  pageSize: number = 50,
  lastDoc?: DocumentSnapshot
): Promise<{
  messages: AgentChatMessage[];
  lastDoc: DocumentSnapshot | null;
  hasMore: boolean;
}> {
  let q = query(
    chatCollection,
    orderBy('createdAt', 'desc'),
    limit(pageSize + 1) // +1 to check if there are more
  );

  if (lastDoc) {
    q = query(
      chatCollection,
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

  // Return in chronological order (reverse the desc query)
  messages.reverse();

  return {
    messages,
    lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore,
  };
}
