import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Mail, Calendar, HardDrive, Check, Loader2, AlertCircle, Unplug } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';

const SERVICES = [
  {
    id: 'gmail',
    title: 'Gmail',
    description: 'Read emails and send messages on behalf of the connected account',
    icon: Mail,
  },
  {
    id: 'calendar',
    title: 'Google Calendar',
    description: 'View, create, and manage calendar events and appointments',
    icon: Calendar,
  },
  {
    id: 'drive',
    title: 'Google Drive',
    description: 'Read-only access to files and documents in Google Drive',
    icon: HardDrive,
  },
];

interface WorkspaceStatus {
  connected: boolean;
  scope?: string;
  connectedAt?: string;
}

export const WorkspacePage: React.FC = () => {
  const { userProfile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isAdmin = isAdminRole(userProfile?.role);

  // Handle callback query params
  useEffect(() => {
    const wsStatus = searchParams.get('workspace');
    const wsError = searchParams.get('workspace_error');

    if (wsStatus === 'connected') {
      setSuccess('Google Workspace connected successfully');
      searchParams.delete('workspace');
      setSearchParams(searchParams, { replace: true });
    }
    if (wsError) {
      setError(decodeURIComponent(wsError));
      searchParams.delete('workspace_error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Fetch connection status
  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      const getStatus = httpsCallable<void, WorkspaceStatus>(functions, 'getWorkspaceStatus');
      const result = await getStatus();
      setStatus(result.data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setError('');
    try {
      const getAuthUrl = httpsCallable<void, { url: string }>(functions, 'getWorkspaceAuthUrl');
      const result = await getAuthUrl();
      window.location.href = result.data.url;
    } catch (err: any) {
      setError(err.message || 'Failed to start connection');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setConfirmDisconnect(false);
    setDisconnecting(true);
    setError('');
    try {
      const disconnect = httpsCallable(functions, 'disconnectWorkspace');
      await disconnect();
      setStatus({ connected: false });
      setSuccess('');
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Determine which scopes are connected
  const connectedScopes = status?.scope?.split(' ') || [];
  const hasGmail = connectedScopes.some(s => s.includes('gmail'));
  const hasCalendar = connectedScopes.some(s => s.includes('calendar'));
  const hasDrive = connectedScopes.some(s => s.includes('drive'));
  const serviceStatus: Record<string, boolean> = {
    gmail: hasGmail,
    calendar: hasCalendar,
    drive: hasDrive,
  };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to="/admin"
        className="inline-flex items-center text-primary-600 hover:text-primary-700 text-sm font-medium"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Admin Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3">
        <svg className="w-8 h-8" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        <div>
          <h1 className="text-3xl font-bold text-secondary-900">Google Workspace</h1>
          <p className="text-secondary-600">
            Connect Gmail, Calendar, and Drive with a single Google account.
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Success */}
      {success && !status?.connected && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-sm text-green-800">{success}</p>
        </div>
      )}

      {/* Connected State */}
      {status?.connected && (
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex h-3 w-3 rounded-full bg-green-500 animate-pulse" />
              <h2 className="text-lg font-semibold text-secondary-900">Google Workspace Connected</h2>
            </div>
            {status.connectedAt && (
              <p className="text-sm text-secondary-600">
                Connected {new Date(status.connectedAt).toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}
              </p>
            )}
          </Card>

          {/* Connected services */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-secondary-900">Connected Services</h3>
            {SERVICES.map((service) => {
              const enabled = serviceStatus[service.id];
              const Icon = service.icon;
              return (
                <Card key={service.id} className={`p-4 flex items-center gap-4 ${!enabled ? 'opacity-50' : ''}`}>
                  <div className="bg-primary-100 p-2 rounded-lg">
                    <Icon className="h-5 w-5 text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-secondary-900">{service.title}</span>
                      {enabled && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-secondary-500">{service.description}</p>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Disconnect */}
          {isAdmin && (
            <button
              onClick={() => setConfirmDisconnect(true)}
              disabled={disconnecting}
              className="btn rounded-xl border border-red-300 px-5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-all disabled:opacity-50"
            >
              <Unplug className="h-4 w-4 mr-2" />
              {disconnecting ? 'Disconnecting...' : 'Disconnect Google Workspace'}
            </button>
          )}
        </div>
      )}

      {/* Not Connected State */}
      {!status?.connected && (
        <div className="space-y-6">
          {/* Services preview */}
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-secondary-900">Services included</h2>
            <p className="text-sm text-secondary-600">
              One Google sign-in connects all services. You can disconnect at any time.
            </p>
            <div className="space-y-3">
              {SERVICES.map((service) => {
                const Icon = service.icon;
                return (
                  <div key={service.id} className="flex items-center gap-4 p-3 rounded-lg border border-secondary-200">
                    <div className="bg-primary-100 p-2 rounded-lg">
                      <Icon className="h-5 w-5 text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-secondary-900">{service.title}</span>
                      <p className="text-xs text-secondary-500">{service.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* How it works */}
          <Card className="p-6">
            <h3 className="font-semibold text-secondary-900 mb-3">How it works</h3>
            <ul className="text-sm text-secondary-600 space-y-2">
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary-600 mt-0.5 flex-shrink-0" />
                One Google sign-in connects Gmail, Calendar, and Drive
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary-600 mt-0.5 flex-shrink-0" />
                OAuth 2.0 — your Google password is never shared
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary-600 mt-0.5 flex-shrink-0" />
                Admin can disconnect at any time to revoke access
              </li>
            </ul>
          </Card>

          {/* Connect button */}
          {isAdmin ? (
            <Button
              onClick={handleConnect}
              loading={connecting}
              size="lg"
              className="w-full"
            >
              Connect Google Workspace
            </Button>
          ) : (
            <Card className="p-4 text-center">
              <p className="text-sm text-secondary-600">
                Only admins can connect Google Workspace. Contact your administrator.
              </p>
            </Card>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={handleDisconnect}
        title="Disconnect Google Workspace"
        message="This will revoke access to Gmail, Calendar, and Drive. Features that depend on these services will stop working until you reconnect."
        confirmLabel="Disconnect"
        variant="danger"
      />
    </div>
  );
};
