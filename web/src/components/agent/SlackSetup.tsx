import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, X } from 'lucide-react';
import {
  configureSlack,
  disconnectSlack,
  buildSlackManifest,
  type SlackWorkspace,
} from '../../lib/slack';
import { ConfirmModal } from '../ui/ConfirmModal';

type Status = 'idle' | 'saving' | 'connected' | 'disconnecting';

interface SlackSetupProps {
  /** Display name used in the manifest and connected-state label. */
  agentName?: string;
  /** Initial connected state, usually derived from getConfig() in the parent. */
  initialConnected: boolean;
  initialWorkspaceName?: string;
  /** Called after a successful connect/disconnect so parent can refresh. */
  onStateChange: () => void;
}

const SLACK_LOGO = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    {/* Bottom arm — green */}
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" fill="#2EB67D" />
    <path d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#2EB67D" />
    {/* Left arm — blue */}
    <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" fill="#36C5F0" />
    <path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
    {/* Top arm — yellow */}
    <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" fill="#ECB22E" />
    <path d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#ECB22E" />
    {/* Right arm — pink */}
    <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" fill="#E01E5A" />
    <path d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#E01E5A" />
  </svg>
);

export const SlackSetup: React.FC<SlackSetupProps> = ({
  agentName = 'Aurelia',
  initialConnected,
  initialWorkspaceName,
  onStateChange,
}) => {
  const [status, setStatus] = useState<Status>(initialConnected ? 'connected' : 'idle');
  const [workspaceName, setWorkspaceName] = useState<string | undefined>(initialWorkspaceName);
  const [expanded, setExpanded] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [error, setError] = useState('');
  const [manifestCopied, setManifestCopied] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStatus('saving');
    try {
      const workspace: SlackWorkspace = await configureSlack(botToken, appToken);
      setWorkspaceName(workspace.name);
      setStatus('connected');
      setExpanded(false);
      setBotToken('');
      setAppToken('');
      onStateChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStatus('idle');
    }
  };

  const performDisconnect = async () => {
    setConfirmDisconnect(false);
    setStatus('disconnecting');
    setError('');
    try {
      await disconnectSlack();
      setWorkspaceName(undefined);
      setStatus('idle');
      onStateChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
      setStatus('connected');
    }
  };

  const copyManifest = async () => {
    try {
      const manifest = buildSlackManifest(agentName);
      await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
      setManifestCopied(true);
      setTimeout(() => setManifestCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy manifest');
    }
  };

  return (
    <div className="card overflow-hidden">
      {/* Header row */}
      <div className="p-4 flex items-center gap-4">
        <div className="shrink-0 bg-secondary-50 rounded-lg p-2">{SLACK_LOGO}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-secondary-900">Slack</h3>
            {status === 'connected' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                Connected
              </span>
            )}
            {status !== 'connected' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-500">
                Not setup
              </span>
            )}
          </div>
          <p className="text-xs text-secondary-500 mt-0.5">
            {status === 'connected' && workspaceName
              ? `Connected to ${workspaceName} — ${agentName} will respond to DMs and mentions`
              : `Connect a Slack workspace so ${agentName} can chat with your team`}
          </p>
        </div>
        <div className="shrink-0">
          {status === 'connected' ? (
            <button
              onClick={() => setConfirmDisconnect(true)}
              disabled={(status as Status) === 'disconnecting'}
              className="text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {(status as Status) === 'disconnecting' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button
              onClick={() => setExpanded((v) => !v)}
              disabled={status === 'saving'}
              className="text-xs px-3 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {expanded ? 'Cancel' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded setup form */}
      {expanded && status !== 'connected' && (
        <div className="border-t border-secondary-200 p-4 bg-secondary-50/50">
          <ol className="text-xs text-secondary-600 space-y-1.5 mb-4 list-decimal list-inside">
            <li>
              Go to{' '}
              <a
                href="https://api.slack.com/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:underline inline-flex items-center gap-0.5"
              >
                api.slack.com/apps <ExternalLink className="h-3 w-3" />
              </a>{' '}
              and click <strong>Create New App → From a manifest</strong>
            </li>
            <li>
              <button
                type="button"
                onClick={copyManifest}
                className="text-primary-600 hover:underline inline-flex items-center gap-1"
              >
                {manifestCopied ? (
                  <>
                    <Check className="h-3 w-3" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy manifest JSON
                  </>
                )}
              </button>{' '}
              and paste it into Slack
            </li>
            <li>
              Under <strong>Basic Information → App-Level Tokens</strong>, generate a token with{' '}
              <code className="bg-secondary-200 px-1 rounded">connections:write</code> scope — this
              is your <strong>App Token</strong> (starts with <code>xapp-</code>)
            </li>
            <li>
              Install the app to your workspace, then copy the{' '}
              <strong>Bot User OAuth Token</strong> from <strong>OAuth & Permissions</strong> (starts
              with <code>xoxb-</code>)
            </li>
          </ol>

          <form onSubmit={handleConnect} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-secondary-700 mb-1">
                Bot Token
              </label>
              <input
                type="password"
                required
                autoComplete="off"
                placeholder="xoxb-..."
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-secondary-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-700 mb-1">
                App Token
              </label>
              <input
                type="password"
                required
                autoComplete="off"
                placeholder="xapp-..."
                value={appToken}
                onChange={(e) => setAppToken(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-secondary-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                <X className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={status === 'saving' || !botToken || !appToken}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {status === 'saving' && <Loader2 className="h-4 w-4 animate-spin" />}
                {status === 'saving' ? 'Connecting…' : 'Connect Slack'}
              </button>
              <p className="text-xs text-secondary-400">
                Gateway will restart after saving (~10s)
              </p>
            </div>
          </form>
        </div>
      )}

      {/* Inline error when connected */}
      {error && !expanded && (
        <div className="border-t border-secondary-200 px-4 py-2 text-xs text-red-600 bg-red-50">
          {error}
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={performDisconnect}
        title="Disconnect Slack"
        message={`Disconnect Slack from ${agentName}? Tokens will be cleared.`}
        confirmLabel="Disconnect"
        variant="danger"
      />
    </div>
  );
};
