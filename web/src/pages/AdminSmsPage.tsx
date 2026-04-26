import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { MessageSquare, Send, Inbox, Sparkles, RefreshCw, UserCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePagedCollection } from '../hooks/usePagedCollection';
import { isAdminRole } from '../lib/roles';
import { sms as smsApi } from '../lib/integrations';
import { alert as modalAlert } from '../lib/modals';
import { findUsersByPhones } from '../lib/firestore/users';
import type { User } from '../types';
import logger from '../lib/logger';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { AlertBanner } from '../components/ui/AlertBanner';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { Button } from '../components/ui/Button';
import { FilterTabs } from '../components/ui/FilterTabs';
import { PaginationBar } from '../components/ui/PaginationBar';
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

  const paged = usePagedCollection<SmsDoc>({
    enabled: isAdminUser,
    real: tab === 'outbound' ? 'sms-outbound' : 'sms-inbound',
    sim: tab === 'outbound' ? 'simulation/sms/outbound' : 'simulation/sms/inbound',
    orderField: tab === 'outbound' ? 'sentAt' : 'receivedAt',
    pageSize: 25,
    mapDoc: (d) => ({ sid: d.id, ...(d.data() as Omit<SmsDoc, 'sid'>) }),
  });
  const { rows, loading, simulated } = paged;

  // For inbound rows, attribute each `from` phone to a known patient if we can.
  // Batched lookup per page; honors sim mode so seeded inbound matches seeded
  // patients. Map keyed by e.164 phone string.
  const [matchedByPhone, setMatchedByPhone] = useState<Map<string, User>>(new Map());
  useEffect(() => {
    if (tab !== 'inbound' || rows.length === 0) {
      setMatchedByPhone(new Map());
      return;
    }
    let cancelled = false;
    const phones = rows.map((r) => (r.from || '').trim()).filter(Boolean);
    findUsersByPhones(phones, simulated)
      .then((m) => { if (!cancelled) setMatchedByPhone(m); })
      .catch((err) => { logger.error('SMS user-match failed', err); });
    return () => { cancelled = true; };
  }, [tab, rows, simulated]);

  async function handleInject() {
    setInjecting(true);
    try {
      await smsApi.injectInbound();
    } catch (err: unknown) {
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
      paged.refresh();
    } catch (err: unknown) {
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
          : 'Outbound admin messages + inbound replies captured from SignalWire.'}
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
          <AlertBanner
            message={sendStatus.text}
            variant={sendStatus.kind === 'ok' ? 'success' : 'error'}
          />
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
          { key: 'outbound', label: 'Outbound' },
          { key: 'inbound', label: 'Inbound' },
        ]}
      />

      <div className="flex justify-end gap-2">
        <Button onClick={paged.refresh} loading={loading} variant="secondary" size="sm">
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
        {simulated && tab === 'inbound' && (
          <Button onClick={handleInject} loading={injecting} variant="secondary" size="sm">
            <Sparkles className="h-4 w-4 mr-1.5" />
            Simulate incoming SMS
          </Button>
        )}
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-secondary-400">
          {simulated
            ? 'No SMS yet. Seed demo data or trigger a welcome SMS to populate.'
            : tab === 'outbound'
              ? 'No outbound SMS yet. Send one above.'
              : 'No inbound SMS yet. Register the SignalWire Messaging Webhook on your number.'}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-secondary-100">
            {rows.map((row) => {
              const matched = tab === 'inbound'
                ? matchedByPhone.get((row.from || '').trim())
                : undefined;
              const matchedName = matched
                ? `${matched.firstName ?? ''} ${matched.lastName ?? ''}`.trim() || matched.email || ''
                : '';
              return (
                <li key={row.sid} className="p-4 flex items-start gap-3">
                  <div className="mt-0.5">
                    {tab === 'outbound' ? (
                      <Send className="h-4 w-4 text-primary-600" />
                    ) : (
                      <Inbox className="h-4 w-4 text-green-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="font-mono text-xs text-secondary-500">
                          {tab === 'outbound' ? `to ${row.to}` : `from ${row.from}`}
                        </span>
                        {matched && matchedName && (
                          <Link
                            to={`/admin/users?search=${encodeURIComponent(matched.lastName || matchedName)}`}
                            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 hover:bg-primary-100"
                            title="Open patient record"
                          >
                            <UserCircle className="h-3 w-3" />
                            {matchedName}
                          </Link>
                        )}
                      </div>
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
              );
            })}
          </ul>
          <div className="p-3 border-t border-secondary-100">
            <PaginationBar
              currentPage={paged.page}
              pageSize={paged.pageSize}
              // Lower-bound on total (cursor-based — no count query). Enough
              // to satisfy PaginationBar's "is there only one page?" check.
              totalItems={(paged.page - 1) * paged.pageSize + rows.length + (paged.hasNext ? 1 : 0)}
              hasMore={paged.hasNext}
              onPreviousPage={paged.prev}
              onNextPage={paged.next}
              label="messages"
            />
          </div>
        </Card>
      )}
    </div>
  );
};
