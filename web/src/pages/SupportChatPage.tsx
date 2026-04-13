import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Headphones, Loader } from 'lucide-react';
import { DocumentSnapshot } from 'firebase/firestore';
import { sidecar } from '../lib/sidecar';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { ChatBubble } from '../components/chat/ChatBubble';
import { ChatInput, fileToBase64 } from '../components/chat/ChatInput';
import {
  SupportChatMessage,
  ChatAttachment,
  saveSupportChatMessage,
  loadSupportChatMessages,
} from '../lib/firestore/support-chat';
import logger from '../lib/logger';

const PAGE_SIZE = 50;


export const SupportChatPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const [messages, setMessages] = useState<SupportChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [oldestCursor, setOldestCursor] = useState<DocumentSnapshot | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const hasScrolledInitial = useRef(false);
  const isLoadingOlder = useRef(false);

  const patientId = user?.uid;

  useEffect(() => {
    if (patientId) loadInitial();
  }, [patientId]);

  // Check agent health
  useEffect(() => {
    const check = async () => {
      try {
        const ok = await sidecar.healthCheck();
        setHealthy(ok);
      } catch { setHealthy(false); }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

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
    if (!patientId) return;
    setLoading(true);
    try {
      const result = await loadSupportChatMessages(patientId, PAGE_SIZE);
      logger.log('[SupportChat] Loaded', result.messages.length, 'messages');
      result.messages.forEach((m, i) => logger.log(`[SupportChat] msg[${i}] role=${m.role} content="${(m.content || '').slice(0, 80)}"`));
      setMessages(result.messages);
      setOldestCursor(result.lastDoc);
      setHasMore(result.hasMore);
    } catch (err) {
      logger.error('Failed to load support chat history:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore || !oldestCursor || !patientId) return;
    setLoadingMore(true);
    const el = scrollRef.current;
    const prevScrollHeight = el?.scrollHeight || 0;
    try {
      const result = await loadSupportChatMessages(patientId, PAGE_SIZE, oldestCursor);
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
  }, [loadingMore, hasMore, oldestCursor, patientId]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 50 && hasMore && !loadingMore) loadOlder();
  }, [loadOlder, hasMore, loadingMore]);

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || sending || !user || !patientId) return;

    const senderName = userProfile
      ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim()
      : 'Patient';

    const attachmentMeta: ChatAttachment[] = pendingFiles.map(f => ({
      name: f.name, mimeType: f.type, size: f.size,
    }));

    const msgContent = text || (pendingFiles.length > 0 ? `[${pendingFiles.length} file(s) attached]` : '');

    // Optimistic UI — show message immediately, persist in background
    const tempId = `temp-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempId, role: 'user' as const, content: msgContent,
      senderId: user.uid, senderName,
      ...(attachmentMeta.length > 0 ? { attachments: attachmentMeta } : {}),
      createdAt: { toDate: () => new Date() } as any,
    }]);
    setInput('');
    const filesToSend = [...pendingFiles];
    setPendingFiles([]);
    setSending(true);

    // Save to Firestore in background (don't block send)
    saveSupportChatMessage({
      patientId, role: 'user', content: msgContent, senderId: user.uid, senderName,
      ...(attachmentMeta.length > 0 ? { attachments: attachmentMeta } : {}),
    }).catch(err => logger.error('Failed to persist user message:', err));

    try {
      const base64Attachments = await Promise.all(
        filesToSend.map(async f => ({ mimeType: f.type, content: await fileToBase64(f), name: f.name }))
      );
      const res = await sidecar.chat(
        [{ role: 'user', content: text || 'See attached file(s)' }],
        base64Attachments.length > 0 ? base64Attachments : undefined,
        { support: true },
      );
      logger.log('[SupportChat] sidecar response:', JSON.stringify(res));
      const replyContent = res.content || '';
      logger.log('[SupportChat] replyContent:', JSON.stringify(replyContent));
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`, role: 'assistant', content: replyContent,
        createdAt: { toDate: () => new Date() } as any,
      }]);
      saveSupportChatMessage({ patientId, role: 'assistant', content: replyContent })
        .catch(e => logger.error('Failed to persist assistant message:', e));
    } catch (err) {
      const errorContent = 'Sorry, I\'m having trouble connecting right now. Please try again in a moment.';
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`, role: 'assistant', content: errorContent,
        createdAt: { toDate: () => new Date() } as any,
      }]);
      saveSupportChatMessage({ patientId, role: 'assistant', content: errorContent })
        .catch(e => logger.error('Failed to persist error message:', e));
    } finally {
      setSending(false);
    }
  };

  const firstName = userProfile?.firstName || 'there';

  return (
    <div className="w-full flex flex-col flex-1 min-h-0 border border-secondary-200 rounded-xl overflow-hidden bg-surface-card">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-secondary-200">
        <Link to="/dashboard" className="text-secondary-500 hover:text-secondary-700 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
            <Headphones className="h-4 w-4 text-primary-600" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-secondary-900">Support Chat</h1>
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${
                healthy === null ? 'bg-secondary-300' : healthy ? 'bg-green-500' : 'bg-red-500'
              }`} />
              <p className="text-xs text-secondary-500">
                {healthy === null ? 'Connecting...' : healthy ? 'Online' : 'Offline'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 bg-secondary-50/50">
        {loading ? (
          <div className="flex items-center justify-center h-full"><LoadingSpinner size="md" /></div>
        ) : (
          <>
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
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center mb-4">
                  <Headphones className="h-7 w-7 text-primary-600" />
                </div>
                <h2 className="text-lg font-semibold text-secondary-900 mb-1">Hi {firstName}!</h2>
                <p className="text-sm text-secondary-500 max-w-sm">
                  I can help you check your appointments, messages, prescriptions, documents, and profile. What would you like to know?
                </p>
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
                <div className="bg-surface-card rounded-xl px-4 py-2.5 rounded-bl-sm border border-secondary-200">
                  <LoadingSpinner size="sm" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </>
        )}
      </div>

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        sending={sending}
        placeholder="Ask a question..."
        pendingFiles={pendingFiles}
        onFilesChange={setPendingFiles}
      />
    </div>
  );
};
