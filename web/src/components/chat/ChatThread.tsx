/**
 * ChatThread — single shared view for both admin agent + patient support.
 * All state/queue/persist/upload logic lives in `useChatThread`; this
 * component is just JSX + scroll behavior.
 *
 * Pages compose chrome (page header, health badge, layout) around it.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Loader } from 'lucide-react';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { ChatBubble } from './ChatBubble';
import { ChatInput } from './ChatInput';
import type { ChatThreadController } from '../../hooks/useChatThread';

interface ChatThreadProps {
  controller: ChatThreadController;
  /** Placeholder shown above the empty thread (welcome screen). */
  emptyState?: React.ReactNode;
  /** Input placeholder text. */
  inputPlaceholder?: string;
}

export const ChatThread: React.FC<ChatThreadProps> = ({
  controller,
  emptyState,
  inputPlaceholder,
}) => {
  const {
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
  } = controller;

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const hasScrolledInitial = useRef(false);
  const isLoadingOlder = useRef(false);

  // Auto-scroll: instant on first paint with content, smooth on new
  // messages / queued sends, skip when prepending older history.
  useEffect(() => {
    if (isLoadingOlder.current) {
      isLoadingOlder.current = false;
      return;
    }
    if (messages.length > 0 || sending || pendingCount > 0 || streamingContent) {
      if (!hasScrolledInitial.current) {
        hasScrolledInitial.current = true;
        endRef.current?.scrollIntoView({ behavior: 'instant' });
      } else {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, sending, pendingCount, streamingContent]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 50 && hasMore && !loadingMore) {
      isLoadingOlder.current = true;
      const prevScrollHeight = el.scrollHeight;
      loadOlder().then(() => {
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevScrollHeight;
        });
      });
    }
  }, [hasMore, loadingMore, loadOlder]);

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
      >
        {loadingMore && (
          <div className="flex justify-center py-2">
            <Loader className="h-4 w-4 animate-spin text-secondary-400" />
          </div>
        )}
        {hasMore && !loadingMore && (
          <button
            onClick={() => loadOlder()}
            className="w-full text-center text-xs text-secondary-400 hover:text-secondary-600 py-2"
          >
            Load older messages
          </button>
        )}

        {messages.length === 0 && !sending && pendingCount === 0 && emptyState && (
          <div className="flex items-center justify-center h-full">{emptyState}</div>
        )}

        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            attachments={msg.attachments}
            onDelete={() => deleteMessage(msg.id)}
          />
        ))}

        {/* Live streaming bubble — replaced by a real assistant message when done */}
        {sending && streamingContent && (
          <ChatBubble role="assistant" content={streamingContent} />
        )}

        {(sending || pendingCount > 0) && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-surface-card border border-secondary-200 rounded-xl px-4 py-2.5 rounded-bl-sm flex items-center gap-2">
              <LoadingSpinner size="sm" />
              {pendingCount > 0 && (
                <span className="text-xs text-secondary-400">+{pendingCount} queued</span>
              )}
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={send}
        sending={false}
        placeholder={inputPlaceholder}
        pendingFiles={pendingFiles}
        onFilesChange={setPendingFiles}
      />
    </div>
  );
};
