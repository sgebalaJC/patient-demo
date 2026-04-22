import React, { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore';
import { MessageSquare, Send, Inbox, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSimulationMode } from '../hooks/useSimulationMode';
import { isAdminRole } from '../lib/roles';
import { db } from '../lib/firebase';
import { sms as smsApi } from '../lib/integrations';
import { alert as modalAlert } from '../lib/modals';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { Button } from '../components/ui/Button';
import { FilterTabs } from '../components/ui/FilterTabs';
import { formatDateTime } from '../lib/date-helpers';

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
  const { enabled: simulated } = useSimulationMode();
  const [tab, setTab] = useState<'outbound' | 'inbound'>('outbound');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SmsDoc[]>([]);
  const [injecting, setInjecting] = useState(false);

  useEffect(() => {
    if (!user || !isAdminRole(userProfile?.role)) return;
    if (!simulated) {
      // Real-path SMS not yet surfaced here.
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const path = tab === 'outbound' ? 'simulation/sms/outbound' : 'simulation/sms/inbound';
    const orderField = tab === 'outbound' ? 'sentAt' : 'receivedAt';
    const q = query(collection(db, path), orderBy(orderField, 'desc'), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ sid: d.id, ...(d.data() as Omit<SmsDoc, 'sid'>) })));
        setLoading(false);
      },
      (err) => {
        console.error('SMS subscribe failed', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [user, userProfile, simulated, tab]);

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
          : 'Real SMS history is not yet wired here. Turn on simulation mode to see the sandbox.'}
      />

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
            : 'Enable simulation mode to view the sandbox.'}
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
        </Card>
      )}
    </div>
  );
};
