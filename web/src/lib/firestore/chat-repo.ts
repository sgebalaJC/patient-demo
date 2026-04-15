/**
 * ChatRepo — common interface for both `agent-chat` (admin) and `support-chat`
 * (patient) collections, consumed by `useChatThread` so the hook stays
 * collection-agnostic.
 *
 * Both collections share the same message shape (role/content/attachments/
 * timestamps); only the doc-creation predicate (admin-vs-patient scope) and
 * the read filter (admin sees all admin chat; patient sees their own thread)
 * differ. The two factory functions below produce a `ChatRepo` instance
 * tuned for the right collection.
 */

import {
  collection,
  addDoc,
  deleteDoc,
  doc,
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

export type { ChatAttachment, AgentChatMessage as ChatMessage };

export interface ChatLoadResult {
  messages: AgentChatMessage[];
  lastDoc: DocumentSnapshot | null;
  hasMore: boolean;
}

export interface ChatSaveInput {
  role: 'user' | 'assistant';
  content: string;
  senderId?: string;
  senderName?: string;
  attachments?: ChatAttachment[];
}

export interface ChatRepo {
  /** Stable identifier for the collection (used in logs). */
  collectionName: string;
  load(pageSize: number, cursor?: DocumentSnapshot): Promise<ChatLoadResult>;
  save(msg: ChatSaveInput): Promise<string>;
  /** Hard delete from Firestore. Caller is responsible for scope/role checks. */
  remove(messageId: string): Promise<void>;
}

function buildLoad(
  collName: string,
  patientId?: string,
): (pageSize: number, cursor?: DocumentSnapshot) => Promise<ChatLoadResult> {
  const coll = collection(db, collName);
  const baseConstraints = patientId ? [where('patientId', '==', patientId)] : [];
  return async (pageSize, cursor) => {
    const constraints: any[] = [
      ...baseConstraints,
      orderBy('createdAt', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageSize + 1),
    ];
    const snapshot = await getDocs(query(coll, ...constraints));
    const hasMore = snapshot.docs.length > pageSize;
    const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
    const messages = docs.map(
      (d) => ({ id: d.id, ...d.data() } as AgentChatMessage),
    );
    messages.reverse();
    return {
      messages,
      lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
      hasMore,
    };
  };
}

function stripUndefined(msg: ChatSaveInput, extra: Record<string, unknown>) {
  const data: Record<string, unknown> = {
    role: msg.role,
    content: msg.content,
    createdAt: serverTimestamp(),
    ...extra,
  };
  if (msg.senderId) data.senderId = msg.senderId;
  if (msg.senderName) data.senderName = msg.senderName;
  if (msg.attachments && msg.attachments.length > 0) {
    data.attachments = msg.attachments;
  }
  return data;
}

/** Repo for the admin agent chat (`agent-chat` collection, no per-user scope). */
export function agentChatRepo(): ChatRepo {
  const coll = collection(db, 'agent-chat');
  return {
    collectionName: 'agent-chat',
    load: buildLoad('agent-chat'),
    async save(msg) {
      const ref = await addDoc(coll, stripUndefined(msg, {}));
      return ref.id;
    },
    async remove(messageId) {
      await deleteDoc(doc(coll, messageId));
    },
  };
}

/** Repo for the patient support chat — scoped to a single patientId. */
export function supportChatRepo(patientId: string): ChatRepo {
  const coll = collection(db, 'support-chat');
  return {
    collectionName: 'support-chat',
    load: buildLoad('support-chat', patientId),
    async save(msg) {
      const ref = await addDoc(coll, stripUndefined(msg, { patientId }));
      return ref.id;
    },
    async remove(messageId) {
      await deleteDoc(doc(coll, messageId));
    },
  };
}
