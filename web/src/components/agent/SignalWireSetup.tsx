import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  getSignalwireStatus,
  saveSignalwireCredentials,
  disconnectSignalwire,
  type SignalwireIntegration,
} from '../../lib/signalwire';
import { ConfirmModal } from '../ui/ConfirmModal';
import { SignalWireIcon } from './icons/ProductIcons';

export const SignalWireSetup: React.FC = () => {
  const [integration, setIntegration] = useState<SignalwireIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Form state
  const [projectId, setProjectId] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [spaceUrl, setSpaceUrl] = useState('');
  const [smsFrom, setSmsFrom] = useState('');
  const [faxNumber, setFaxNumber] = useState('');
  const [faxLabel, setFaxLabel] = useState('');
  const [faxFromEmail, setFaxFromEmail] = useState('');
  const [faxCcEmail, setFaxCcEmail] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const data = await getSignalwireStatus();
      setIntegration(data);
      if (data) {
        setProjectId(data.projectId ?? '');
        setSpaceUrl(data.spaceUrl ?? '');
        setSmsFrom(data.smsFrom ?? '');
        setFaxNumber(data.faxNumber ?? '');
        setFaxLabel(data.faxLabel ?? '');
        setFaxFromEmail(data.faxFromEmail ?? '');
        setFaxCcEmail(data.faxCcEmail ?? '');
      }
    } finally {
      setLoading(false);
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await saveSignalwireCredentials({
        projectId,
        authToken,
        spaceUrl,
        smsFrom,
        faxNumber,
        faxLabel,
        faxFromEmail,
        faxCcEmail,
      });
      setAuthToken('');
      setSuccess('Credentials saved');
      await load();
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setConfirmDisconnect(false);
    setDisconnecting(true);
    setError('');
    try {
      await disconnectSignalwire();
      setIntegration(null);
      setProjectId('');
      setSpaceUrl('');
      setSmsFrom('');
      setFaxNumber('');
      setFaxLabel('');
      setFaxFromEmail('');
      setFaxCcEmail('');
      setSuccess('Disconnected');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="card overflow-hidden">
        <div className="p-4 flex items-center gap-4">
          <div className="shrink-0"><SignalWireIcon /></div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-secondary-900">SignalWire</h3>
            <p className="text-xs text-secondary-500 mt-0.5">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  const isActive = integration?.status === 'active' && !!integration?.projectId;

  return (
    <div className="card overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <div className="shrink-0"><SignalWireIcon /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-secondary-900">SignalWire</h3>
            {isActive ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                Connected
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-500">
                Not configured
              </span>
            )}
          </div>
          <p className="text-xs text-secondary-500 mt-0.5">
            {isActive
              ? `${integration.spaceUrl} — ${integration.smsFrom ? `SMS ${integration.smsFrom}` : 'SMS not set'}${integration.faxNumber ? ` · fax ${integration.faxLabel || integration.faxNumber}` : ''}`
              : 'Configure SignalWire for outbound SMS, voice, and fax'}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-md border border-secondary-300 text-secondary-700 hover:bg-secondary-50"
          >
            {expanded ? 'Cancel' : isActive ? 'Edit' : 'Configure'}
          </button>
          {isActive && (
            <button
              onClick={() => setConfirmDisconnect(true)}
              disabled={disconnecting}
              className="text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
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

      {expanded && (
        <form onSubmit={handleSave} className="border-t border-secondary-200 p-4 bg-secondary-50/50 space-y-3">
          <p className="text-xs text-secondary-600">
            Create a project in the SignalWire dashboard, buy a phone number for SMS and/or fax,
            and paste the credentials below. The auth token is stored in Google Secret Manager
            and is never shown again — leave blank to keep the existing token.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field
              label="Project ID"
              required
              value={projectId}
              onChange={setProjectId}
              placeholder="UUID from the SignalWire dashboard"
            />
            <Field
              label="Space URL"
              required
              value={spaceUrl}
              onChange={setSpaceUrl}
              placeholder="your-space.signalwire.com"
            />
            <Field
              label={isActive ? 'Auth Token (blank to keep existing)' : 'Auth Token'}
              type="password"
              required={!isActive}
              value={authToken}
              onChange={setAuthToken}
              placeholder="PT••••••••••••••••"
            />
            <Field
              label="SMS sender number (E.164)"
              value={smsFrom}
              onChange={setSmsFrom}
              placeholder="+14155551234"
            />
            <Field
              label="Fax number (E.164)"
              value={faxNumber}
              onChange={setFaxNumber}
              placeholder="+14155551234"
            />
            <Field
              label="Fax label (displayed on cover sheet)"
              value={faxLabel}
              onChange={setFaxLabel}
              placeholder="(415) 555-1234"
            />
            <Field
              label="Fax-forward From (Gmail address)"
              type="email"
              value={faxFromEmail}
              onChange={setFaxFromEmail}
              placeholder="fax@practice.com"
            />
            <Field
              label="Fax-forward CC (optional)"
              type="email"
              value={faxCcEmail}
              onChange={setFaxCcEmail}
              placeholder="records@practice.com"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || !projectId || !spaceUrl || (!isActive && !authToken)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      <ConfirmModal
        isOpen={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={handleDisconnect}
        title="Disconnect SignalWire"
        message="Clear SignalWire credentials? Outbound SMS, voice, and fax will stop working until reconfigured."
        confirmLabel="Disconnect"
        variant="danger"
      />
    </div>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'password' | 'email';
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, placeholder, required, type = 'text' }) => (
  <div>
    <label className="block text-xs font-medium text-secondary-700 mb-1">{label}</label>
    <input
      type={type}
      required={required}
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 text-sm border border-secondary-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
    />
  </div>
);
