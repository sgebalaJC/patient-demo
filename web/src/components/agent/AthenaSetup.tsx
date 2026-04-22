import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Stethoscope, Check, Copy, ExternalLink } from 'lucide-react';
import {
  getAthenaStatus,
  saveAthenaCredentials,
  getAthenaAuthUrl,
  setAthenaEnabled,
  disconnectAthena,
  type AthenaIntegration,
} from '../../lib/athena';
import { ConfirmModal } from '../ui/ConfirmModal';

interface Props {
  onStateChange?: () => void;
}

export const AthenaSetup: React.FC<Props> = ({ onStateChange }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [integration, setIntegration] = useState<AthenaIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [practiceId, setPracticeId] = useState('');
  const [preview, setPreview] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    const errParam = searchParams.get('athena_error');
    const statusParam = searchParams.get('athena_status');
    if (errParam) setError(decodeURIComponent(errParam));
    if (statusParam === 'connected') setSuccess('Athena connected successfully');
    if (errParam || statusParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('athena_error');
      next.delete('athena_status');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    setLoading(true);
    try {
      const data = await getAthenaStatus();
      setIntegration(data);
      if (data?.clientId) setClientId(data.clientId);
      if (data?.practiceId) setPracticeId(data.practiceId);
      if (typeof data?.preview === 'boolean') setPreview(data.preview);
      if (!data?.clientId) setShowEdit(true);
    } catch {
      setShowEdit(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCreds() {
    setError('');
    if (!clientId.trim() || !clientSecret.trim() || !practiceId.trim()) {
      setError('Client ID, Client Secret, and Practice ID are all required');
      return;
    }
    if (!/^[0-9]+$/.test(practiceId.trim())) {
      setError('Practice ID must be numeric');
      return;
    }
    setSaving(true);
    try {
      await saveAthenaCredentials(clientId.trim(), clientSecret.trim(), practiceId.trim(), preview);
      setClientSecret('');
      setShowEdit(false);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  }

  async function handleAuthorize() {
    setError('');
    setAuthorizing(true);
    try {
      const { url } = await getAthenaAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth flow');
      setAuthorizing(false);
    }
  }

  async function handleToggle(next: boolean) {
    setError('');
    setTogglePending(true);
    try {
      await setAthenaEnabled(next);
      await loadStatus();
      onStateChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle integration');
    } finally {
      setTogglePending(false);
    }
  }

  async function performDisconnect() {
    setConfirmDisconnect(false);
    setDisconnecting(true);
    setError('');
    try {
      await disconnectAthena();
      setIntegration(null);
      setClientId('');
      setClientSecret('');
      setPracticeId('');
      setShowEdit(true);
      setSuccess('');
      onStateChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  function copyRedirect() {
    if (!integration?.redirectUri) return;
    navigator.clipboard.writeText(integration.redirectUri);
    setSuccess('Redirect URI copied');
    setTimeout(() => setSuccess(''), 1500);
  }

  const hasCreds = !!integration?.clientId;
  const isAuthorized = integration?.status === 'active';
  const isEnabled = !!integration?.enabled;

  if (loading) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-4">
          <div className="shrink-0 bg-secondary-50 rounded-lg p-2">
            <Stethoscope className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-secondary-900">Athenahealth</h3>
            <p className="text-xs text-secondary-500 mt-0.5">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <div className="shrink-0 bg-secondary-50 rounded-lg p-2">
          <Stethoscope className="w-6 h-6 text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-secondary-900">Athenahealth</h3>
            {isAuthorized && isEnabled ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Active</span>
            ) : isAuthorized ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">Authorized, disabled</span>
            ) : hasCreds ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-600">Credentials saved</span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-500">Not configured</span>
            )}
            {integration?.preview && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">Preview sandbox</span>
            )}
          </div>
          <p className="text-xs text-secondary-500 mt-0.5">
            {isAuthorized
              ? 'The admin agent can read Athena patient and appointment data when this integration is enabled'
              : 'Connect Athenahealth so the admin agent can query the practice EHR'}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {isAuthorized && (
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => handleToggle(e.target.checked)}
                disabled={togglePending}
                className="sr-only peer"
              />
              <div className="relative w-9 h-5 bg-secondary-200 rounded-full peer peer-checked:bg-primary-600 transition-colors">
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${isEnabled ? 'translate-x-4' : ''}`} />
              </div>
            </label>
          )}
          {hasCreds && (
            <button
              onClick={() => setConfirmDisconnect(true)}
              disabled={disconnecting}
              className="text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-t border-secondary-200 px-4 py-2 text-xs text-red-600 bg-red-50">{error}</div>
      )}
      {success && (
        <div className="border-t border-secondary-200 px-4 py-2 text-xs text-green-600 bg-green-50">{success}</div>
      )}

      {showEdit && (
        <div className="border-t border-secondary-200 p-4 bg-secondary-50/50 space-y-3">
          <div>
            <p className="text-xs font-medium text-secondary-700 mb-1">Athenahealth OAuth Client</p>
            <p className="text-xs text-secondary-500 mb-3">
              Register an application on Athena's developer portal, paste its Client ID and Client Secret, and set the
              practice (tenant) ID you want to connect. Use the preview sandbox toggle for test credentials.
            </p>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-secondary-700">Client ID</span>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Athena-issued client ID"
              className="mt-1 block w-full text-xs px-3 py-2 rounded-md border border-secondary-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-secondary-700">Client Secret</span>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Athena-issued client secret"
              className="mt-1 block w-full text-xs px-3 py-2 rounded-md border border-secondary-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-secondary-700">Practice ID</span>
            <input
              type="text"
              value={practiceId}
              onChange={(e) => setPracticeId(e.target.value)}
              placeholder="Numeric tenant id, e.g. 195900"
              className="mt-1 block w-full text-xs px-3 py-2 rounded-md border border-secondary-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={preview}
              onChange={(e) => setPreview(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span className="text-xs text-secondary-700">Use preview sandbox (api.preview.platform.athenahealth.com)</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveCreds}
              disabled={saving || !clientId.trim() || !clientSecret.trim() || !practiceId.trim()}
              className="text-xs px-3 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? 'Saving...' : 'Save credentials'}
            </button>
            {hasCreds && (
              <button
                onClick={() => { setShowEdit(false); setClientSecret(''); }}
                className="text-xs px-3 py-1.5 rounded-md border border-secondary-200 text-secondary-700 hover:bg-secondary-100"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {hasCreds && !showEdit && (
        <div className="border-t border-secondary-200 p-4 bg-secondary-50/50 space-y-3">
          {integration?.redirectUri && (
            <div>
              <p className="text-xs font-medium text-secondary-700 mb-1">Redirect URI (register in Athena)</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-white border border-secondary-200 rounded px-2 py-1 flex-1 truncate">
                  {integration.redirectUri}
                </code>
                <button
                  onClick={copyRedirect}
                  className="text-xs p-1.5 rounded-md border border-secondary-200 text-secondary-600 hover:bg-secondary-100"
                  title="Copy"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            {isAuthorized ? (
              <div className="flex items-center gap-1.5 text-xs text-green-700">
                <Check className="h-3.5 w-3.5" /> OAuth complete — tokens stored
              </div>
            ) : (
              <button
                onClick={handleAuthorize}
                disabled={authorizing}
                className="text-xs px-3 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {authorizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                Authorize with Athena
              </button>
            )}
            <button
              onClick={() => setShowEdit(true)}
              className="text-xs px-3 py-1.5 rounded-md border border-secondary-200 text-secondary-700 hover:bg-secondary-100"
            >
              Change credentials
            </button>
          </div>
          {isAuthorized && (
            <p className="text-xs text-secondary-500">
              Agent skill is injected automatically when enabled. Toggle above to turn access on/off without disconnecting.
            </p>
          )}
        </div>
      )}
      <ConfirmModal
        isOpen={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={performDisconnect}
        title="Disconnect Athenahealth"
        message="Disconnect Athenahealth? Stored credentials and tokens will be deleted."
        confirmLabel="Disconnect"
        variant="danger"
      />
    </div>
  );
};
