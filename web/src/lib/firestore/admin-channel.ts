/**
 * Firestore layer for the admin-to-admin broadcast channel backing
 * `AdminChannelWidget`. Distinct from `agent-chat` / `support-chat` (those
 * are user↔LLM agent threads with role/content shape); this is a live
 * many-to-many room with sender attribution and a chime on new messages.
 *
 * Kept intentionally small — subscribe to the last N, send one, that's it.
 */

import {
  addDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { collections, mapDocStrict } from './base';

export interface AdminChannelMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt?: Timestamp | null;
}

/**
 * Live subscription to the most recent `max` messages, ordered oldest-first
 * at the callback boundary. Returns an unsubscribe handle.
 */
export function subscribeAdminChannel(
  max: number,
  onMessages: (messages: AdminChannelMessage[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collections.adminChannelMessages,
    orderBy('createdAt', 'desc'),
    limit(max),
  );
  return onSnapshot(
    q,
    (snap) => {
      const next = snap.docs
        .map((d) => mapDocStrict<AdminChannelMessage>(d, ['senderId', 'text'], 'admin-channel-messages'))
        .filter((m): m is AdminChannelMessage => m !== null);
      next.reverse();
      onMessages(next);
    },
    onError,
  );
}

export async function sendAdminChannelMessage(
  senderId: string,
  senderName: string,
  text: string,
): Promise<string> {
  const ref = await addDoc(collections.adminChannelMessages, {
    senderId,
    senderName,
    text,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
