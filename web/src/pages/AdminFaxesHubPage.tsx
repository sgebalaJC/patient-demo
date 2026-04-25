import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Phone, Check } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { FilterTabs } from '../components/ui/FilterTabs';
import { AdminFaxesPage } from './AdminFaxesPage';
import { AdminSendFaxPage } from './AdminSendFaxPage';
import { useSimulationMode } from '../hooks/useSimulationMode';
import { faxes as faxesApi } from '../lib/integrations';
import { subscribeSignalwireStatus } from '../lib/signalwire';
import { formatPhoneDisplay } from '../lib/phone';

function formatFaxDisplay(e164: string | undefined): string {
  if (!e164) return '—';
  return formatPhoneDisplay(e164) || e164;
}

type Tab = 'inbox' | 'send';

export const AdminFaxesHubPage: React.FC<{ defaultTab?: Tab }> = ({ defaultTab = 'inbox' }) => {
  const [params, setParams] = useSearchParams();
  const urlTab = params.get('tab');
  const initial: Tab = (urlTab === 'send' || urlTab === 'inbox') ? urlTab : defaultTab;
  const [tab, setTab] = useState<Tab>(initial);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [faxNumberE164, setFaxNumberE164] = useState<string | undefined>(undefined);
  const { enabled: simulated } = useSimulationMode();

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  useEffect(() => {
    if (simulated) {
      let alive = true;
      faxesApi.getOurFaxNumber()
        .then((n) => { if (alive) setFaxNumberE164(n || undefined); })
        .catch(() => { /* keep previous */ });
      return () => { alive = false; };
    }
    return subscribeSignalwireStatus((status) => {
      setFaxNumberE164(status?.faxNumber ?? undefined);
    });
  }, [simulated]);

  function switchTab(next: string) {
    const t = (next === 'send' || next === 'inbox') ? next : 'inbox';
    setTab(t as Tab);
    const nextParams = new URLSearchParams(params);
    if (t === 'inbox') nextParams.delete('tab'); else nextParams.set('tab', t);
    setParams(nextParams, { replace: true });
  }

  async function copyFax() {
    try {
      await navigator.clipboard.writeText((faxNumberE164 ?? ''));
    } catch {
      // Fallback for browsers / contexts without async clipboard access.
      const ta = document.createElement('textarea');
      ta.value = (faxNumberE164 ?? '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        icon={FileText}
        title="Faxes"
        subtitle={
          tab === 'inbox'
            ? 'Inbound fax pipeline — review, edit drafts, send emails to patients.'
            : 'Send a fax — upload PDFs (merged into one document) and submit via SignalWire.'
        }
        action={
          <div className="relative">
            <button
              type="button"
              onClick={copyFax}
              title="Click to copy fax number"
              className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100"
            >
              <Phone className="h-4 w-4" />
              <div className="flex flex-col leading-tight text-left">
                <span className="text-[10px] uppercase tracking-wide text-primary-600/70">Our fax</span>
                <span className="font-mono">{formatFaxDisplay(faxNumberE164)}</span>
              </div>
            </button>
            <div
              role="status"
              aria-live="polite"
              className={`pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full transform transition-all duration-200 ${
                copied ? 'opacity-100 -translate-y-[120%]' : 'opacity-0 -translate-y-full'
              }`}
            >
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white text-xs font-medium px-2.5 py-1 shadow-md">
                <Check className="h-3 w-3" />
                Copied
              </span>
            </div>
          </div>
        }
      />

      <FilterTabs
        activeKey={tab}
        onChange={switchTab}
        tabs={[
          { key: 'inbox', label: 'Inbox' },
          { key: 'send', label: 'Send' },
        ]}
      />

      {tab === 'inbox' ? <AdminFaxesPage embedded /> : <AdminSendFaxPage embedded />}
    </div>
  );
};
