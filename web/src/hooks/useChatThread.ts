/**
 * useChatThread — the single shared chat state engine for AgentPage (admin)
 * and SupportChatPage (patient). Owns: message list, paginated history load,
 * per-thread send queue, optimistic user-message render, attachment upload
 * (Cloud Storage), assistant reply (streaming or final), persistence (via
 * the supplied `repo`), and hard delete (also via `repo`).
 *
 * The hook is intentionally view-agnostic — it returns refs/handlers that
 * <ChatThread> wires up to JSX. Pages compose chrome (header, health badge,
 * empty state) around the view component.
 *
 * Streaming contract: when `sidecarStream` is provided it's called with
 *   { messages, attachments, support, onChunk, signal }
 * and is expected to return the final assistant text. `onChunk` is invoked
 * for each text chunk as it arrives so the live bubble updates in real time.
 * If `sidecarStream` is omitted, falls back to the legacy non-streaming
 * `sidecar.chat()` path so the hook works during the staged rollout.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentSnapshot } from 'firebase/firestore';
import { sidecar } from '../lib/sidecar';
import {
  uploadChatAttachment,
  deleteMessageAttachment,
  validateMessageAttachment,
} from '../lib/storage';
import logger from '../lib/logger';
import type { ChatRepo, ChatMessage, ChatAttachment } from '../lib/firestore/chat-repo';

const DEFAULT_PAGE_SIZE = 50;

export type ChatStreamFn = (args: {
  messages: { role: string; content: string }[];
  attachments?: { mimeType: string; content: string; name: string }[];
  support?: boolean;
  onChunk: (text: string) => void;
  signal?: AbortSignal;
}) => Promise<string>;

export interface UseChatThreadOptions {
  repo: ChatRepo;
  /** Set to true for the patient-support agent path. */
  support?: boolean;
  /** Sender for "user" messages (uid + display name). */
  senderId?: string;
  senderName?: string;
  /** Override the default 50-message page size. */
  pageSize?: number;
  /**
   * Optional streaming send. When provided, replaces the default
   * sidecar.chat() round-trip with an SSE-driven path.
   */
  sidecarStream?: ChatStreamFn;
  /** Error-message renderer (defaults to a generic friendly message). */
  errorMessage?: (err: unknown) => string;
}

export interface ChatThreadController {
  messages: ChatMessage[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  pendingCount: number;
  /** True while a send is in-flight (queue has been drained at least once). */
  sending: boolean;
  /** Accumulating assistant text for the in-flight stream — render in the placeholder bubble. */
  streamingContent: string;
  input: string;
  setInput: (v: string) => void;
  pendingFiles: File[];
  setPendingFiles: (files: File[]) => void;
  loadOlder: () => Promise<void>;
  send: () => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
}

export function useChatThread(opts: UseChatThreadOptions): ChatThreadController {
  const {
    repo,
    support,
    senderId,
    senderName,
    pageSize = DEFAULT_PAGE_SIZE,
    // Default to the streaming SDK method. Pages can override (e.g. tests).
    sidecarStream = sidecar.streamChat.bind(sidecar),
    errorMessage = () =>
      "Sorry, I'm having trouble connecting right now. Please try again in a moment.",
  } = opts;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');

  const oldestCursorRef = useRef<DocumentSnapshot | null>(null);
  const queueRef = useRef<(() => Promise<void>)[]>([]);
  const busyRef = useRef(false);

  // Initial history load. Re-runs if the repo identity changes (new patient).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    oldestCursorRef.current = null;
    setHasMore(false);
    repo
      .load(pageSize)
      .then((res) => {
        if (cancelled) return;
        setMessages(res.messages);
        oldestCursorRef.current = res.lastDoc;
        setHasMore(res.hasMore);
      })
      .catch((err) => {
        if (!cancelled) logger.error(`[chat] load failed (${repo.collectionName}):`, err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, pageSize]);

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore || !oldestCursorRef.current) return;
    setLoadingMore(true);
    try {
      const res = await repo.load(pageSize, oldestCursorRef.current);
      setMessages((prev) => [...res.messages, ...prev]);
      oldestCursorRef.current = res.lastDoc;
      setHasMore(res.hasMore);
    } catch (err) {
      logger.error(`[chat] loadOlder failed (${repo.collectionName}):`, err);
    } finally {
      setLoadingMore(false);
    }
  }, [repo, pageSize, hasMore, loadingMore]);

  const flushQueue = useCallback(async () => {
    if (busyRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setSending(false);
      return;
    }
    busyRef.current = true;
    setSending(true);
    try {
      await next();
    } finally {
      busyRef.current = false;
      setPendingCount(queueRef.current.length);
      // Schedule next iteration outside the current call stack so React renders.
      queueMicrotask(() => flushQueue());
    }
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || !senderId) return;

    // Validate + snapshot the input bundle, then clear UI state immediately.
    const filesToSend = pendingFiles.filter((f) => {
      const v = validateMessageAttachment(f);
      if (!v.valid) logger.warn(`[chat] dropped invalid attachment ${f.name}: ${v.error}`);
      return v.valid;
    });
    setInput('');
    setPendingFiles([]);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const placeholderContent =
      text || (filesToSend.length > 0 ? `[${filesToSend.length} file(s) attached]` : '');

    // Show the user message instantly (without uploaded URLs yet).
    const placeholderAttachments: ChatAttachment[] = filesToSend.map((f) => ({
      name: f.name,
      mimeType: f.type,
      size: f.size,
    }));
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: 'user',
        content: placeholderContent,
        senderId,
        senderName,
        ...(placeholderAttachments.length > 0 ? { attachments: placeholderAttachments } : {}),
        createdAt: { toDate: () => new Date() } as any,
      },
    ]);

    queueRef.current.push(async () => {
      // 1. Upload attachments to Cloud Storage so they survive reload + are
      //    sharable to the gateway as URLs (and as base64 fallback).
      let uploaded: ChatAttachment[] = placeholderAttachments;
      let base64Attachments: { mimeType: string; content: string; name: string }[] | undefined;
      if (filesToSend.length > 0) {
        try {
          const results = await Promise.all(
            filesToSend.map((f) => uploadChatAttachment(f, senderId)),
          );
          uploaded = results.map((r) => ({
            name: r.name,
            mimeType: r.mimeType,
            size: r.size,
            url: r.url,
            storagePath: r.storagePath,
          }));
          // Patch the placeholder message in-place with the uploaded URLs so
          // image previews swap from "uploading…" to live thumbnails.
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, attachments: uploaded } : m)),
          );
        } catch (err) {
          logger.error('[chat] attachment upload failed:', err);
        }
        // Always pass base64 to the gateway too — OpenClaw can't fetch our
        // signed Storage URLs from inside the container.
        base64Attachments = await Promise.all(
          filesToSend.map(async (f) => ({
            mimeType: f.type,
            content: await fileToBase64(f),
            name: f.name,
          })),
        );
      }

      // 2. Persist the user message (fire-and-forget). Saves the live URLs.
      repo
        .save({
          role: 'user',
          content: placeholderContent,
          senderId,
          senderName,
          ...(uploaded.length > 0 ? { attachments: uploaded } : {}),
        })
        .then((realId) => {
          // Swap the temp id for the real Firestore id so the delete button
          // can target the correct doc.
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, id: realId } : m)),
          );
        })
        .catch((err) => logger.error('[chat] persist user msg failed:', err));

      // 3. Send to the gateway and capture the assistant reply.
      let replyContent = '';
      const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        if (sidecarStream) {
          setStreamingContent('');
          replyContent = await sidecarStream({
            messages: [{ role: 'user', content: text || 'See attached file(s)' }],
            attachments: base64Attachments,
            support,
            onChunk: (chunk) => {
              setStreamingContent((s) => s + chunk);
            },
          });
        } else {
          // Legacy non-streaming path.
          const res = await sidecar.chat(
            [{ role: 'user', content: text || 'See attached file(s)' }],
            base64Attachments,
            support ? { support: true } : undefined,
          );
          replyContent = res.content || '';
        }
      } catch (err) {
        logger.error('[chat] sidecar chat failed:', err);
        replyContent = errorMessage(err);
      } finally {
        setStreamingContent('');
      }

      // 4. Append assistant message + persist.
      setMessages((prev) => [
        ...prev,
        {
          id: streamId,
          role: 'assistant',
          content: replyContent,
          createdAt: { toDate: () => new Date() } as any,
        },
      ]);
      repo
        .save({ role: 'assistant', content: replyContent })
        .then((realId) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === streamId ? { ...m, id: realId } : m)),
          );
        })
        .catch((err) => logger.error('[chat] persist assistant msg failed:', err));
    });

    setPendingCount(queueRef.current.length);
    flushQueue();
  }, [
    input,
    pendingFiles,
    senderId,
    senderName,
    repo,
    support,
    sidecarStream,
    errorMessage,
    flushQueue,
  ]);

  const deleteMessage = useCallback(
    async (id: string) => {
      // Find what we're deleting so we can also clean up Storage objects.
      const target = messages.find((m) => m.id === id);
      // Optimistic removal from the UI.
      setMessages((prev) => prev.filter((m) => m.id !== id));
      if (id.startsWith('temp-') || id.startsWith('stream-')) return; // never persisted
      try {
        await repo.remove(id);
      } catch (err) {
        logger.error('[chat] hard delete failed:', err);
        // Re-add the message so the user knows it failed.
        if (target) setMessages((prev) => [...prev, target]);
        return;
      }
      // Best-effort Storage cleanup (don't block UX on this).
      const paths = target?.attachments?.map((a) => a.storagePath).filter(Boolean) as
        | string[]
        | undefined;
      if (paths?.length) {
        Promise.all(paths.map((p) => deleteMessageAttachment(p))).catch((err) =>
          logger.warn('[chat] storage cleanup partial failure:', err),
        );
      }
    },
    [messages, repo],
  );

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    pendingCount,
    sending,
    streamingContent,
    input,
    setInput,
    pendingFiles,
    setPendingFiles,
    loadOlder,
    send,
    deleteMessage,
  };
}

// Local copy — avoids importing from a UI component file.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
