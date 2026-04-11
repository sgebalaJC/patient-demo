import React, { useState, useEffect, useCallback } from 'react';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { sidecar } from '../../lib/sidecar';
import { readSlackStatus, type SlackChannelStatus } from '../../lib/slack';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { SlackSetup } from './SlackSetup';

export const AgentChannels: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [slack, setSlack] = useState<SlackChannelStatus>({ enabled: false });

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const config = await sidecar.getConfig();
      const status = await readSlackStatus(config);
      setSlack(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channel status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-secondary-900">Channels</h2>
        <button
          onClick={loadStatus}
          className="flex items-center gap-1.5 text-sm text-secondary-500 hover:text-primary-600 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>
      <p className="text-sm text-secondary-500 mb-6">
        Connect messaging channels to chat with Aurelia from anywhere.
      </p>

      {loading && <LoadingSpinner />}

      {!loading && error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4">
          {error}
        </div>
      )}

      {!loading && (
        <div className="space-y-3 max-w-2xl">
          {/* Web Chat — always on, read-only card */}
          <div className="card p-4 flex items-center gap-4">
            <div className="shrink-0 bg-primary-50 rounded-lg p-2">
              <MessageSquare className="h-6 w-6 text-primary-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-secondary-900">Web Chat</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                  Always on
                </span>
              </div>
              <p className="text-xs text-secondary-500 mt-0.5">
                Chat with Aurelia through this admin interface
              </p>
            </div>
          </div>

          {/* Slack */}
          <SlackSetup
            agentName="Aurelia"
            initialConnected={slack.enabled}
            initialWorkspaceName={slack.workspace?.name}
            onStateChange={loadStatus}
          />

          {/* Coming soon placeholders */}
          <div className="text-xs text-secondary-400 uppercase tracking-wider pt-4 pb-1">
            Coming soon
          </div>
          <ComingSoonCard name="Telegram" description="Telegram bot for on-the-go access" />
          <ComingSoonCard name="Discord" description="Discord bot for team notifications" />
          <ComingSoonCard name="WhatsApp" description="WhatsApp via phone pairing" />
        </div>
      )}
    </div>
  );
};

const ComingSoonCard: React.FC<{ name: string; description: string }> = ({ name, description }) => (
  <div className="card p-4 flex items-center gap-4 opacity-60">
    <div className="shrink-0 bg-secondary-100 rounded-lg p-2 w-10 h-10 flex items-center justify-center">
      <span className="text-secondary-500 font-semibold text-xs">{name.slice(0, 2).toUpperCase()}</span>
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-secondary-900">{name}</h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-500">
          Not setup
        </span>
      </div>
      <p className="text-xs text-secondary-500 mt-0.5">{description}</p>
    </div>
  </div>
);
