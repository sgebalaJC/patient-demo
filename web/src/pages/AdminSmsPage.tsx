import React, { useMemo, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { MessageSquare, Send, Inbox, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useIntegrationCollection } from '../hooks/useIntegrationCollection';
import { isAdminRole } from '../lib/roles';
import { sms as smsApi } from '../lib/integrations';
import { alert as modalAlert } from '../lib/modals';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { Button } from '../components/ui/Button';
import { FilterTabs } from '../components/ui/FilterTabs';
import { formatDateTime } from '../lib/date-helpers';
import { normalizePhoneNumber, formatPhoneDisplay } from '../lib/phone';

interface SmsDoc {
  sid: string;
  from: string;
  to: string;
  body: string;
  kind?: string;
  status: string;
  sentAt?: Timestamp;
  receivedAt?: Timestamp;
}

function formatTime(ts: Timestamp | undefined): string {
  if (!ts) return '—';
  return formatDateTime(ts.toDate());
}

export const AdminSmsPage: React.FC = () => {
  const { user, userProfile, loading: authLoading } = useAuth();
  const isAdminUser = !!user && isAdminRole(userProfile?.role);
  const [tab, setTab] = useState<'outbound' | 'inbound'>('outbound');
  const [injecting, setInjecting] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const composeToNormalized = useMemo(() => {
    try { return composeTo ? normalizePhoneNumber(composeTo) : ''; } catch { return ''; }
  }, [composeTo]);
  const canSend = !!composeToNormalized && composeBody.trim().length > 0 && !sending;

  const { rows, loading, simulated, hasMore, loadMore } = useIntegrationCollection<SmsDoc>({
    enabled: isAdminUser,
    real: tab === 'outbound' ? 'sms-outbound' : 'sms-inbound',
    sim: tab === 'outbound' ? 'simulation/sms/outbound' : 'simulation/sms/inbound',
    orderField: tab === 'outbound' ? 'sentAt' : 'receivedAt',
    pageSize: 50,
    mapDoc: (d) => ({ sid: d.id, ...(d.data() as Omit<SmsDoc, 'sid'>) }),
  });

  async function handleInject() {
    setInjecting(true);
    try {
      await smsApi.injectInbound();
    } catch (err: any) {
      void modalAlert({ tone: 'error', title: 'Inject failed', message: err?.message || String(err) });
    } finally {
      setInjecting(false);
    }
  }

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setSendStatus(null);
    try {
      const res = await smsApi.sendSMS({
        to: composeToNormalized,
        body: composeBody.trim(),
        kind: 'manual',
      });
      setSendStatus({
        kind: 'ok',
        text: simulated
          ? `Simulated SMS recorded — SID ${res.sid.slice(0, 12)}…`
          : `SMS sent (${res.status}) — SID ${res.sid.slice(0, 12)}…`,
      });
      setComposeTo('');
      setComposeBody('');
      setTab('outbound');
    } catch (err: any) {
      setSendStatus({ kind: 'err', text: err?.message || 'Send failed' });
    } finally {
      setSending(false);
    }
  }

  if (authLoading) return <LoadingSpinner />;
  if (!user || !isAdminRole(userProfile?.role)) return <AccessDenied />;

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        icon={MessageSquare}
        title="SMS"
        subtitle={simulated
          ? 'Simulated SMS history — reminders, welcome messages, and patient replies land here.'
          : 'Outbound admin messages + inbound replies captured from Twilio.'}
      />

      <Card className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-primary-600" />
          <h2 className="text-sm font-semibold text-secondary-900">Send SMS</h2>
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-700 mb-1">Recipient phone</label>
          <input
            type="tel"
            value={composeTo}
            onChange={(e) => setComposeTo(e.target.value)}
            placeholder="(555) 123-4567"
            className="input w-full"
          />
          {composeToNormalized && (
            <p className="text-xs text-secondary-500 mt-1">
              Normalized: {formatPhoneDisplay(composeToNormalized)} ({composeToNormalized})
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-700 mb-1">Message</label>
          <textarea
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            maxLength={1600}
            rows={3}
            placeholder="Short message to send via SMS…"
            className="input w-full font-normal"
          />
          <p className="text-xs text-secondary-500 mt-1">
            {composeBody.length}/1600 · {Math.max(1, Math.ceil(composeBody.length / 160))} segment{composeBody.length > 160 ? 's' : ''}
          </p>
        </div>
        {sendStatus && (
          <div
            className={`rounded-md border p-2 text-xs ${
              sendStatus.kind === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}
          >
            {sendStatus.text}
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={handleSend} loading={sending} disabled={!canSend} size="sm">
            <Send className="h-4 w-4 mr-1.5" />
            {simulated ? 'Send (simulated)' : 'Send SMS'}
          </Button>
        </div>
      </Card>

      <FilterTabs
        activeKey={tab}
        onChange={(v) => setTab(v as 'outbound' | 'inbound')}
        tabs={[
          { key: 'outbound', label: 'Outbound', count: tab === 'outbound' ? rows.length : undefined },
          { key: 'inbound', label: 'Inbound', count: tab === 'inbound' ? rows.length : undefined },
        ]}
      />

      {simulated && tab === 'inbound' && (
        <div className="flex justify-end">
          <Button onClick={handleInject} loading={injecting} variant="secondary" size="sm">
            <Sparkles className="h-4 w-4 mr-1.5" />
            Simulate incoming SMS
          </Button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-secondary-400">
          {simulated
            ? 'No SMS yet. Seed demo data or trigger a welcome SMS to populate.'
            : tab === 'outbound'
              ? 'No outbound SMS yet. Send one above.'
              : 'No inbound SMS yet. Register the Twilio Messaging Webhook on your number.'}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-secondary-100">
            {rows.map((row) => (
              <li key={row.sid} className="p-4 flex items-start gap-3">
                <div className="mt-0.5">
                  {tab === 'outbound' ? (
                    <Send className="h-4 w-4 text-primary-600" />
                  ) : (
                    <Inbox className="h-4 w-4 text-green-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-secondary-500">
                      {tab === 'outbound' ? `to ${row.to}` : `from ${row.from}`}
                    </span>
                    <span className="text-xs text-secondary-400 shrink-0">
                      {formatTime(tab === 'outbound' ? row.sentAt : row.receivedAt)}
                    </span>
                  </div>
                  <p className="text-sm text-secondary-800 mt-1 whitespace-pre-wrap">{row.body}</p>
                  {row.kind && (
                    <span className="inline-block mt-2 text-[10px] uppercase tracking-wide text-secondary-500 bg-secondary-100 rounded px-1.5 py-0.5">
                      {row.kind}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="p-3 text-center border-t border-secondary-100">
              <Button variant="secondary" size="sm" onClick={loadMore}>
                Load more
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
