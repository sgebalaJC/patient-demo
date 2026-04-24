import React, { useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ChatThread } from '../chat/ChatThread';
import { useChatThread } from '../../hooks/useChatThread';
import { agentChatRepo } from '../../lib/firestore/chat-repo';
import { formatDisplayName } from '../../lib/user-helpers';

/**
 * Admin agent chat — thin wrapper around the shared ChatThread. All heavy
 * lifting (queue, persist, attachments, streaming) lives in `useChatThread`.
 */
export const AgentChat: React.FC = () => {
  const { user, userProfile } = useAuth();
  const repo = useMemo(() => agentChatRepo(), []);

  const senderName = formatDisplayName(userProfile, 'Admin');

  const controller = useChatThread({
    repo,
    senderId: user?.uid,
    senderName,
    errorMessage: (err) =>
      `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-secondary-200">
        <h2 className="text-sm font-semibold text-secondary-900">Chat</h2>
      </div>
      <ChatThread
        controller={controller}
        emptyState={
          <p className="text-secondary-400 text-sm">
            Send a message to start chatting with the agent.
          </p>
        }
      />
    </div>
  );
};
