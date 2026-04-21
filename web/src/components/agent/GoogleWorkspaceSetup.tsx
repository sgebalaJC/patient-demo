import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Mail, Calendar, HardDrive, Check } from 'lucide-react';
import {
  getGoogleWorkspaceStatus,
  getGoogleWorkspaceAuthUrl,
  disconnectGoogleWorkspace,
  type GoogleWorkspaceIntegration,
} from '../../lib/google-workspace';
import { ConfirmModal } from '../ui/ConfirmModal';

const SERVICE_IDS = ['gmail', 'calendar', 'drive'] as const;

const SERVICE_META: Record<string, { label: string; desc: string; icon: React.ElementType }> = {
  gmail: { label: 'Gmail', desc: 'Read inbox, send & reply to emails', icon: Mail },
  calendar: { label: 'Google Calendar', desc: 'List, create, update & delete events', icon: Calendar },
  drive: { label: 'Google Drive', desc: 'Search, read & create files', icon: HardDrive },
};

const GOOGLE_LOGO = (
  <svg className="w-6 h-6" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

interface GoogleWorkspaceSetupProps {
  onStateChange?: () => void;
}

export const GoogleWorkspaceSetup: React.FC<GoogleWorkspaceSetupProps> = ({ onStateChange }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [integration, setIntegration] = useState<GoogleWorkspaceIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>(['gmail', 'calendar', 'drive']);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Handle OAuth callback params
  useEffect(() => {
    const gwsError = searchParams.get('gws_error');
    const gwsStatus = searchParams.get('gws_status');
    const gwsEmail = searchParams.get('gws_email');
    const gwsServices = searchParams.get('gws_services');

    if (gwsError) setError(decodeURIComponent(gwsError));
    if (gwsStatus === 'connected' && gwsEmail) {
      setSuccess(`Connected as ${gwsEmail}${gwsServices ? ` (${gwsServices})` : ''}`);
    }

    if (gwsError || gwsStatus) {
      // Clean URL params
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('gws_error');
      newParams.delete('gws_status');
      newParams.delete('gws_email');
      newParams.delete('gws_services');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Load integration status
  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const data = await getGoogleWorkspaceStatus();
      setIntegration(data);
      if (data?.enabledServices) {
        setSelectedServices(data.enabledServices);
      }
    } catch {
      // No integration found
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setError('');
    try {
      const url = await getGoogleWorkspaceAuthUrl(selectedServices);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth flow');
      setConnecting(false);
    }
  }

  async function performDisconnect() {
    setConfirmDisconnect(false);
    setDisconnecting(true);
    setError('');
    try {
      await disconnectGoogleWorkspace();
      setIntegration(null);
      setSuccess('');
      onStateChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  function toggleService(serviceId: string) {
    setSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((s) => s !== serviceId)
        : [...prev, serviceId],
    );
  }

  if (loading) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-4">
          <div className="shrink-0 bg-secondary-50 rounded-lg p-2">{GOOGLE_LOGO}</div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-secondary-900">Google Workspace</h3>
            <p className="text-xs text-secondary-500 mt-0.5">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  const isActive = integration?.status === 'active';

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center gap-4">
        <div className="shrink-0 bg-secondary-50 rounded-lg p-2">{GOOGLE_LOGO}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-secondary-900">Google Workspace</h3>
            {isActive ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                Connected
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-500">
                Not connected
              </span>
            )}
          </div>
          <p className="text-xs text-secondary-500 mt-0.5">
            {isActive
              ? `Connected as ${integration.email} — agent can access ${integration.enabledServices.join(', ')}`
              : 'Connect a Google account so the agent can use Gmail, Calendar, and Drive'}
          </p>
        </div>
        <div className="shrink-0">
          {isActive ? (
            <button
              onClick={() => setConfirmDisconnect(true)}
              disabled={disconnecting}
              className="text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting || selectedServices.length === 0}
              className="text-xs px-3 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {connecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {/* Error / Success banners */}
      {error && (
        <div className="border-t border-secondary-200 px-4 py-2 text-xs text-red-600 bg-red-50">
          {error}
        </div>
      )}
      {success && !isActive && (
        <div className="border-t border-secondary-200 px-4 py-2 text-xs text-green-600 bg-green-50">
          {success}
        </div>
      )}

      {/* Connected state — show services */}
      {isActive && (
        <div className="border-t border-secondary-200 p-4 bg-secondary-50/50">
          <p className="text-xs font-medium text-secondary-700 mb-2">Active services</p>
          <div className="space-y-1.5">
            {SERVICE_IDS.map((id) => {
              const meta = SERVICE_META[id];
              const enabled = integration.enabledServices.includes(id);
              const Icon = meta.icon;
              return (
                <div key={id} className={`flex items-center gap-3 py-1 ${enabled ? '' : 'opacity-40'}`}>
                  <Icon className="h-4 w-4 text-secondary-600" />
                  <span className="text-xs text-secondary-700">{meta.label}</span>
                  {enabled && (
                    <span className="text-xs text-green-600 flex items-center gap-0.5">
                      <Check className="h-3 w-3" /> Active
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Not connected — service picker */}
      {!isActive && !loading && (
        <div className="border-t border-secondary-200 p-4 bg-secondary-50/50">
          <p className="text-xs font-medium text-secondary-700 mb-2">Select services to connect</p>
          <div className="space-y-1.5">
            {SERVICE_IDS.map((id) => {
              const meta = SERVICE_META[id];
              const selected = selectedServices.includes(id);
              const Icon = meta.icon;
              return (
                <button
                  key={id}
                  onClick={() => toggleService(id)}
                  className={`w-full text-left flex items-center gap-3 p-2 rounded-md transition-colors cursor-pointer ${
                    selected ? 'bg-primary-50 border border-primary-200' : 'hover:bg-secondary-100 border border-transparent'
                  }`}
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                    selected ? 'border-primary-600 bg-primary-600' : 'border-secondary-300'
                  }`}>
                    {selected && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <Icon className="h-4 w-4 text-secondary-600" />
                  <div>
                    <span className="text-xs font-medium text-secondary-900">{meta.label}</span>
                    <p className="text-xs text-secondary-500">{meta.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-secondary-400 mt-3">
            You'll be redirected to Google to grant access. Only the selected permissions are requested.
          </p>
        </div>
      )}
      <ConfirmModal
        isOpen={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={performDisconnect}
        title="Disconnect Google Workspace"
        message="Disconnect Google Workspace? The agent will lose access to Gmail, Calendar, and Drive."
        confirmLabel="Disconnect"
        variant="danger"
      />
    </div>
  );
};
