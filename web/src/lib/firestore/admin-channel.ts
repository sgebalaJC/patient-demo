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
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';

export interface AdminChannelMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt?: Timestamp | null;
}

const COLLECTION = 'admin-channel-messages';

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
    collection(db, COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(max),
  );
  return onSnapshot(
    q,
    (snap) => {
      const next: AdminChannelMessage[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AdminChannelMessage, 'id'>),
      }));
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
  const ref = await addDoc(collection(db, COLLECTION), {
    senderId,
    senderName,
    text,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
