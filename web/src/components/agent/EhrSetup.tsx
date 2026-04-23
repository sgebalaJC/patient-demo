/**
 * Generic EHR setup card. One component drives every entry in the
 * provider registry — save creds, authorize, toggle enabled, disconnect.
 *
 * See web/src/lib/integrations/registry.ts for the provider definitions
 * that feed this component.
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Check, Copy, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import {
  getIntegrationStatus,
  saveIntegrationCredentials,
  getIntegrationAuthUrl,
  setIntegrationEnabled,
  disconnectIntegration,
  type IntegrationStatus,
} from '../../lib/integrations/ehr-admin';
import type { EhrProviderDef, FieldDef } from '../../lib/integrations/registry';
import { ConfirmModal } from '../ui/ConfirmModal';

interface Props {
  provider: EhrProviderDef;
  onStateChange?: () => void;
}

const BADGE_CLASSES: Record<'blue' | 'purple', string> = {
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
};

export const EhrSetup: React.FC<Props> = ({ provider, onStateChange }) => {
  const Icon = provider.icon;
  const errParamKey = `${provider.id}_error`;
  const statusParamKey = `${provider.id}_status`;

  const [searchParams, setSearchParams] = useSearchParams();
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [extras, setExtras] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      provider.extraFields.map((f) => [f.key, f.type === 'checkbox' ? false : '']),
    ),
  );
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // ── OAuth callback param handling ────────────────────────────
  useEffect(() => {
    const errParam = searchParams.get(errParamKey);
    const statusParam = searchParams.get(statusParamKey);
    if (errParam) setError(decodeURIComponent(errParam));
    if (statusParam === 'connected') setSuccess(`${provider.name} connected successfully`);
    if (errParam || statusParam) {
      setExpanded(true);
      const next = new URLSearchParams(searchParams);
      next.delete(errParamKey);
      next.delete(statusParamKey);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, errParamKey, statusParamKey, provider.name]);

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id]);

  async function loadStatus() {
    setLoading(true);
    try {
      const data = await getIntegrationStatus(provider.id);
      setIntegration(data);
      if (data?.clientId) setClientId(data.clientId as string);
      // Populate extra-field values from the stored doc.
      const next: Record<string, string | boolean> = {};
      for (const f of provider.extraFields) {
        const v = data?.[f.key];
        next[f.key] = f.type === 'checkbox' ? Boolean(v) : ((v as string) || '');
      }
      setExtras(next);
      if (!data?.clientId) setShowEdit(true);
    } catch {
      setShowEdit(true);
    } finally {
      setLoading(false);
    }
  }

  function validateExtras(): string | null {
    for (const f of provider.extraFields) {
      if (f.type === 'checkbox') continue;
      const raw = extras[f.key];
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (f.required && !value) return `${f.label} is required`;
      if (value && f.pattern && !f.pattern.test(value)) {
        return f.patternMessage || `${f.label} is invalid`;
      }
    }
    return null;
  }

  async function handleSaveCreds() {
    setError('');
    if (!clientId.trim()) {
      setError('Client ID is required');
      return;
    }
    if (provider.clientSecretRequired !== false && !clientSecret.trim()) {
      setError('Client Secret is required');
      return;
    }
    const extrasError = validateExtras();
    if (extrasError) {
      setError(extrasError);
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      };
      for (const f of provider.extraFields) {
        const v = extras[f.key];
        payload[f.key] = f.type === 'checkbox' ? Boolean(v) : (v as string).trim();
      }
      await saveIntegrationCredentials(provider.id, payload);
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
      const { url } = await getIntegrationAuthUrl(provider.id);
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
      await setIntegrationEnabled(provider.id, next);
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
      await disconnectIntegration(provider.id);
      setIntegration(null);
      setClientId('');
      setClientSecret('');
      const reset: Record<string, string | boolean> = {};
      for (const f of provider.extraFields) {
        reset[f.key] = f.type === 'checkbox' ? false : '';
      }
      setExtras(reset);
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
    const uri = integration?.redirectUri;
    if (!uri) return;
    navigator.clipboard.writeText(uri as string);
    setSuccess('Redirect URI copied');
    setTimeout(() => setSuccess(''), 1500);
  }

  const hasCreds = !!integration?.clientId;
  const isAuthorized = integration?.status === 'active';
  const isEnabled = !!integration?.enabled;
  const dynamicBadges = provider.extraBadges
    ? provider.extraBadges((integration ?? {}) as Record<string, unknown>)
    : [];
  const badges = [...(provider.staticBadges ?? []), ...dynamicBadges];

  if (loading) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-4">
          <div className="shrink-0 bg-secondary-50 rounded-lg p-2">
            <Icon className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-secondary-900">{provider.name}</h3>
            <p className="text-xs text-secondary-500 mt-0.5">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div
        className="p-4 flex items-center gap-4 cursor-pointer hover:bg-secondary-50/50"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="shrink-0 text-secondary-400">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <div className="shrink-0 bg-secondary-50 rounded-lg p-2">
          <Icon className="w-6 h-6 text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-secondary-900">{provider.name}</h3>
            {isAuthorized && isEnabled ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                Active
              </span>
            ) : isAuthorized ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">
                Authorized, disabled
              </span>
            ) : hasCreds ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-600">
                Credentials saved
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-500">
                Not configured
              </span>
            )}
            {badges.map((b) => (
              <span
                key={b.label}
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${BADGE_CLASSES[b.tone]}`}
              >
                {b.label}
              </span>
            ))}
          </div>
          <p className="text-xs text-secondary-500 mt-0.5">
            {isAuthorized ? provider.activeDescription : provider.description}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
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
                <div
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    isEnabled ? 'translate-x-4' : ''
                  }`}
                />
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

      {expanded && error && (
        <div className="border-t border-secondary-200 px-4 py-2 text-xs text-red-600 bg-red-50">{error}</div>
      )}
      {expanded && success && (
        <div className="border-t border-secondary-200 px-4 py-2 text-xs text-green-600 bg-green-50">{success}</div>
      )}

      {expanded && showEdit && (
        <div className="border-t border-secondary-200 p-4 bg-secondary-50/50 space-y-3">
          {provider.setupHelp && (
            <div>
              <p className="text-xs font-medium text-secondary-700 mb-1">{provider.name} OAuth Client</p>
              <p className="text-xs text-secondary-500 mb-3">{provider.setupHelp}</p>
            </div>
          )}
          <label className="block">
            <span className="text-xs font-medium text-secondary-700">Client ID</span>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={provider.clientIdPlaceholder || 'Client ID'}
              className="mt-1 block w-full text-xs px-3 py-2 rounded-md border border-secondary-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-secondary-700">
              Client Secret
              {provider.clientSecretRequired === false && ' (leave blank for public client)'}
            </span>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={provider.clientSecretPlaceholder || 'Client secret'}
              className="mt-1 block w-full text-xs px-3 py-2 rounded-md border border-secondary-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>
          {provider.extraFields.map((f) => (
            <ExtraFieldInput
              key={f.key}
              field={f}
              value={extras[f.key]}
              onChange={(v) => setExtras((s) => ({ ...s, [f.key]: v }))}
            />
          ))}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveCreds}
              disabled={saving || !clientId.trim()}
              className="text-xs px-3 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? 'Saving...' : 'Save credentials'}
            </button>
            {hasCreds && (
              <button
                onClick={() => {
                  setShowEdit(false);
                  setClientSecret('');
                }}
                className="text-xs px-3 py-1.5 rounded-md border border-secondary-200 text-secondary-700 hover:bg-secondary-100"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {expanded && hasCreds && !showEdit && (
        <div className="border-t border-secondary-200 p-4 bg-secondary-50/50 space-y-3">
          {integration?.redirectUri && (
            <div>
              <p className="text-xs font-medium text-secondary-700 mb-1">
                Redirect URI (register in {provider.name})
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-white border border-secondary-200 rounded px-2 py-1 flex-1 truncate">
                  {integration.redirectUri as string}
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
                {authorizing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
                Authorize with {provider.name}
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
        title={`Disconnect ${provider.name}`}
        message={`Disconnect ${provider.name}? Stored credentials and tokens will be deleted.`}
        confirmLabel="Disconnect"
        variant="danger"
      />
    </div>
  );
};

interface ExtraFieldInputProps {
  field: FieldDef;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
}

const ExtraFieldInput: React.FC<ExtraFieldInputProps> = ({ field, value, onChange }) => {
  if (field.type === 'checkbox') {
    return (
      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        <span className="text-xs text-secondary-700">{field.label}</span>
      </label>
    );
  }
  return (
    <label className="block">
      <span className="text-xs font-medium text-secondary-700">{field.label}</span>
      <input
        type={field.type === 'password' ? 'password' : 'text'}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={`mt-1 block w-full text-xs px-3 py-2 rounded-md border border-secondary-200 focus:outline-none focus:ring-1 focus:ring-primary-500 ${
          field.type === 'url' ? 'font-mono' : ''
        }`}
      />
      {field.help && <span className="block text-xs text-secondary-500 mt-1">{field.help}</span>}
    </label>
  );
};
