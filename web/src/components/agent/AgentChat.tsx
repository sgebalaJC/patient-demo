import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Loader } from 'lucide-react';
import { DocumentSnapshot } from 'firebase/firestore';
import { sidecar } from '../../lib/sidecar';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { ChatBubble } from '../chat/ChatBubble';
import { ChatInput, fileToBase64 } from '../chat/ChatInput';
import {
  AgentChatMessage,
  ChatAttachment,
  saveAgentChatMessage,
  loadAgentChatMessages,
} from '../../lib/firestore/agent-chat';
import logger from '../../lib/logger';

const PAGE_SIZE = 50;


export const AgentChat: React.FC = () => {
  const { user, userProfile } = useAuth();
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [oldestCursor, setOldestCursor] = useState<DocumentSnapshot | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const hasScrolledInitial = useRef(false);
  const isLoadingOlder = useRef(false);

  useEffect(() => { loadInitial(); }, []);

  // Auto-scroll: instant on first load, smooth on new messages/sending, skip when loading older
  useEffect(() => {
    if (isLoadingOlder.current) {
      isLoadingOlder.current = false;
      return;
    }
    if (messages.length > 0 || sending) {
      if (!hasScrolledInitial.current) {
        hasScrolledInitial.current = true;
        endRef.current?.scrollIntoView({ behavior: 'instant' });
      } else {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, sending]);

  const loadInitial = async () => {
    setLoading(true);
    try {
      const result = await loadAgentChatMessages(PAGE_SIZE);
      setMessages(result.messages);
      setOldestCursor(result.lastDoc);
      setHasMore(result.hasMore);
    } catch (err) {
      logger.error('Failed to load chat history:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore || !oldestCursor) return;
    setLoadingMore(true);
    const el = scrollRef.current;
    const prevScrollHeight = el?.scrollHeight || 0;
    try {
      const result = await loadAgentChatMessages(PAGE_SIZE, oldestCursor);
      isLoadingOlder.current = true;
      setMessages(prev => [...result.messages, ...prev]);
      setOldestCursor(result.lastDoc);
      setHasMore(result.hasMore);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevScrollHeight; });
    } catch (err) {
      logger.error('Failed to load older messages:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, oldestCursor]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 50 && hasMore && !loadingMore) loadOlder();
  }, [loadOlder, hasMore, loadingMore]);

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || sending || !user) return;

    const senderName = userProfile
      ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim()
      : 'Admin';

    const attachmentMeta: ChatAttachment[] = pendingFiles.map(f => ({
      name: f.name, mimeType: f.type, size: f.size,
    }));

    const msgContent = text || (pendingFiles.length > 0 ? `[${pendingFiles.length} file(s) attached]` : '');

    // Optimistic UI — show message immediately
    const tempId = `temp-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempId, role: 'user' as const, content: msgContent,
      senderId: user.uid, senderName,
      attachments: attachmentMeta.length > 0 ? attachmentMeta : undefined,
      createdAt: { toDate: () => new Date() } as any,
    }]);
    setInput('');
    const filesToSend = [...pendingFiles];
    setPendingFiles([]);
    setSending(true);

    // Persist in background
    saveAgentChatMessage({
      role: 'user', content: msgContent, senderId: user.uid, senderName,
      ...(attachmentMeta.length > 0 ? { attachments: attachmentMeta } : {}),
    }).catch(err => logger.error('Failed to persist user message:', err));

    try {
      const base64Attachments = await Promise.all(
        filesToSend.map(async f => ({ mimeType: f.type, content: await fileToBase64(f), name: f.name }))
      );
      const res = await sidecar.chat(
        [{ role: 'user', content: text || 'See attached file(s)' }],
        base64Attachments.length > 0 ? base64Attachments : undefined
      );
      logger.log('[AgentChat] sidecar response:', JSON.stringify(res).slice(0, 300));
      const replyContent = res.content || '';
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`, role: 'assistant', content: replyContent,
        createdAt: { toDate: () => new Date() } as any,
      }]);
      saveAgentChatMessage({ role: 'assistant', content: replyContent })
        .catch(err => logger.error('Failed to persist assistant message:', err));
    } catch (err) {
      logger.error('[AgentChat] Error:', err);
      const errorContent = `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`;
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`, role: 'assistant', content: errorContent,
        createdAt: { toDate: () => new Date() } as any,
      }]);
      saveAgentChatMessage({ role: 'assistant', content: errorContent })
        .catch(e => logger.error('Failed to persist error message:', e));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center flex-1"><LoadingSpinner size="md" /></div>;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-secondary-200">
        <h2 className="text-sm font-semibold text-secondary-900">Chat</h2>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {loadingMore && (
          <div className="flex justify-center py-2">
            <Loader className="h-4 w-4 animate-spin text-secondary-400" />
          </div>
        )}
        {hasMore && !loadingMore && (
          <button onClick={loadOlder} className="w-full text-center text-xs text-secondary-400 hover:text-secondary-600 py-2">
            Load older messages
          </button>
        )}

        {messages.length === 0 && !sending && (
          <div className="flex items-center justify-center h-full text-secondary-400 text-sm">
            Send a message to start chatting with the agent.
          </div>
        )}

        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            attachments={msg.attachments}
            onDelete={() => setMessages(prev => prev.filter(m => m.id !== msg.id))}
          />
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-surface-card border border-secondary-200 rounded-xl px-4 py-2.5 rounded-bl-sm">
              <LoadingSpinner size="sm" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        sending={sending}
        pendingFiles={pendingFiles}
        onFilesChange={setPendingFiles}
      />
    </div>
  );
};
