import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Headphones } from 'lucide-react';
import { sidecar } from '../lib/sidecar';
import { useAuth } from '../hooks/useAuth';
import { ChatThread } from '../components/chat/ChatThread';
import { useChatThread } from '../hooks/useChatThread';
import { supportChatRepo } from '../lib/firestore/chat-repo';

/**
 * Patient support chat page — uses the shared ChatThread + useChatThread.
 * Page-specific chrome: header, agent-online indicator, patient greeting.
 */
export const SupportChatPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const patientId = user?.uid;
  const [healthy, setHealthy] = useState<boolean | null>(null);

  // Repo is patient-scoped; recreate when patient changes (sign-out / sign-in).
  const repo = useMemo(
    () => (patientId ? supportChatRepo(patientId) : null),
    [patientId],
  );

  // Background health-check ping every 30s — drives the online/offline dot.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const ok = await sidecar.healthCheck();
        if (!cancelled) setHealthy(ok);
      } catch {
        if (!cancelled) setHealthy(false);
      }
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const senderName = userProfile
    ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || 'Patient'
    : 'Patient';

  // Hooks must be called unconditionally — pass a dummy repo when patient is
  // unknown so the hook stays mounted; the empty-state below covers loading.
  const controller = useChatThread({
    repo: repo ?? supportChatRepo('__pending__'),
    support: true,
    senderId: patientId,
    senderName,
  });

  const firstName = userProfile?.firstName || 'there';

  return (
    <div className="w-full flex flex-col flex-1 min-h-0 overflow-hidden bg-surface-card">
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
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  healthy === null ? 'bg-secondary-300' : healthy ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <p className="text-xs text-secondary-500">
                {healthy === null ? 'Connecting…' : healthy ? 'Online' : 'Offline'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <ChatThread
        controller={controller}
        inputPlaceholder="Ask a question..."
        emptyState={
          <div className="flex flex-col items-center justify-center text-center px-4">
            <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center mb-4">
              <Headphones className="h-7 w-7 text-primary-600" />
            </div>
            <h2 className="text-lg font-semibold text-secondary-900 mb-1">Hi {firstName}!</h2>
            <p className="text-sm text-secondary-500 max-w-sm">
              I can help you check your appointments, messages, prescriptions, documents, and profile.
              What would you like to know?
            </p>
          </div>
        }
      />
    </div>
  );
};
