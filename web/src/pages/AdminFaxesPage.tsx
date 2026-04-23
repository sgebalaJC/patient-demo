import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../hooks/useAuth';
import { Timestamp } from 'firebase/firestore';
import { functions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import {
  Inbox, Send, Copy, FileText, AlertTriangle,
  CheckCircle2, Clock, Loader2, X, Trash, Sparkles, Paperclip, RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { PageHeader } from '../components/ui/PageHeader';
import { StatsGrid } from '../components/ui/StatsGrid';
import { FilterTabs } from '../components/ui/FilterTabs';
import { EmptyState } from '../components/ui/EmptyState';
import { PaginationBar } from '../components/ui/PaginationBar';
import { formatDateTime } from '../lib/date-helpers';
import { isAdminRole } from '../lib/roles';
import { usePagedCollection, type WhereClause } from '../hooks/usePagedCollection';
import { useCollectionCounts } from '../hooks/useCollectionCounts';
import { usePdfPreview } from '../hooks/usePdfPreview';
import { faxes as faxesApi } from '../lib/integrations';
import { alert as modalAlert } from '../lib/modals';

type FaxStatus = 'pending' | 'processing' | 'needs_review' | 'completed' | 'failed';

interface InboundFax {
  faxSid: string;
  receivedAt?: Timestamp | null;
  from?: string;
  to?: string;
  pageCount?: number;
  pdfPath?: string | null;
  status: FaxStatus;
  attempts?: number;
  lastError?: { message?: string } | null;
  aurelia?: {
    sessionId?: string;
    summary?: string;
    summaryForAdmin?: string;
    currentStep?: string;
    confidence?: number;
  } | null;
  matchedPatient?: {
    drchronoId?: number;
    patientId?: string;
    confidence?: string;
  } | null;
  extracted?: {
    patientName?: string;
    patientDob?: string;
    documentType?: string;
    senderProvider?: string;
  } | null;
  drchronoDocumentId?: number | null;
  emailMode?: 'draft_only' | 'auto_send';
  emailDraft?: {
    to: string;
    cc?: string[];
    subject: string;
    body: string;
    generatedAt?: Timestamp;
  } | null;
  emailSent?: {
    messageId: string;
    sentAt?: Timestamp;
    sentBy?: 'aurelia_auto' | 'admin_manual';
  } | null;
  notes?: string;
}

type ChipState =
  | { tone: 'pending'; label: string; detail?: string }
  | { tone: 'success'; label: string; detail?: string }
  | { tone: 'warning'; label: string; detail?: string }
  | { tone: 'error';   label: string; detail?: string };

function patientMatchState(fax: InboundFax): ChipState {
  if (!fax.matchedPatient) return { tone: 'pending', label: 'Not yet matched' };
  const c = fax.matchedPatient.confidence;
  if (c === 'exact') {
    return {
      tone: 'success',
      label: 'Patient matched',
      detail: fax.matchedPatient.drchronoId ? `DrChrono #${fax.matchedPatient.drchronoId}` : undefined,
    };
  }
  if (c === 'ambiguous') return { tone: 'warning', label: 'Multiple candidates', detail: 'Needs admin review' };
  if (c === 'none') return { tone: 'error', label: 'No patient found', detail: 'Needs manual match' };
  return { tone: 'pending', label: 'Not yet matched' };
}

function drchronoUploadState(fax: InboundFax): ChipState {
  if (fax.drchronoDocumentId) {
    return { tone: 'success', label: 'Uploaded to chart', detail: `Document #${fax.drchronoDocumentId}` };
  }
  if (fax.matchedPatient?.confidence === 'none' || fax.matchedPatient?.confidence === 'ambiguous') {
    return { tone: 'warning', label: 'Skipped', detail: 'Awaiting patient confirmation' };
  }
  if (fax.aurelia?.currentStep === 'done' && !fax.drchronoDocumentId) {
    return { tone: 'error', label: 'Upload failed', detail: 'Check Aurelia notes' };
  }
  return { tone: 'pending', label: 'Not yet uploaded' };
}

const CHIP_TONE: Record<ChipState['tone'], string> = {
  pending: 'bg-secondary-500/10 text-secondary-600 dark:text-secondary-400 border-secondary-500/30',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  error:   'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
};
const CHIP_ICON: Record<ChipState['tone'], any> = {
  pending: Clock,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: X,
};

const StatusChip: React.FC<{ label: string; state: ChipState }> = ({ label, state }) => {
  const Icon = CHIP_ICON[state.tone];
  return (
    <div className={`rounded-lg border px-3 py-2 ${CHIP_TONE[state.tone]}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="flex items-center gap-2 mt-1">
        <Icon className="w-4 h-4 flex-shrink-0" />
        <div className="font-medium text-sm">{state.label}</div>
      </div>
      {state.detail && <div className="text-xs opacity-80 mt-0.5 ml-6">{state.detail}</div>}
    </div>
  );
};

const STATUS_BADGE: Record<FaxStatus, { label: string; className: string; icon: any }> = {
  pending: { label: 'Pending', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30', icon: Clock },
  processing: { label: 'Processing', className: 'bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-500/30', icon: Loader2 },
  needs_review: { label: 'Needs Review', className: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30', icon: AlertTriangle },
  completed: { label: 'Completed', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', icon: CheckCircle2 },
  failed: { label: 'Failed', className: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30', icon: X },
};

export const AdminFaxesPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { user, userProfile, loading: authLoading } = useAuth();
  const isAdminUser = !!user && isAdminRole(userProfile?.role);
  const [filter, setFilter] = useState<'all' | FaxStatus>('all');

  // Server-side status filter — needs composite (status, receivedAt) index,
  // declared in firestore.indexes.json for both `inbound-faxes` and the
  // simulation/faxes/inbound collection-group.
  const whereClauses = useMemo<WhereClause[] | undefined>(
    () => (filter === 'all' ? undefined : [['status', '==', filter]]),
    [filter],
  );

  const paged = usePagedCollection<InboundFax>({
    enabled: isAdminUser,
    real: 'inbound-faxes',
    sim: 'simulation/faxes/inbound',
    orderField: 'receivedAt',
    pageSize: 25,
    whereClauses,
    mapDoc: (d) => ({ faxSid: d.id, ...(d.data() as Omit<InboundFax, 'faxSid'>) }),
  });
  const { rows: faxes, loading, simulated } = paged;

  const countsPredicates = useMemo(() => ({
    all: [] as [string, '==', string][],
    needs_review: [['status', '==', 'needs_review']] as [string, '==', string][],
    pending: [['status', '==', 'pending']] as [string, '==', string][],
    processing: [['status', '==', 'processing']] as [string, '==', string][],
    failed: [['status', '==', 'failed']] as [string, '==', string][],
    completed: [['status', '==', 'completed']] as [string, '==', string][],
  }), []);
  const { counts } = useCollectionCounts({
    enabled: isAdminUser,
    real: 'inbound-faxes',
    sim: 'simulation/faxes/inbound',
    predicates: countsPredicates,
  });
  const [selectedFaxSid, setSelectedFaxSid] = useState<string | null>(null);
  const [inlineDeleteTarget, setInlineDeleteTarget] = useState<InboundFax | null>(null);
  const [inlineDeleting, setInlineDeleting] = useState(false);
  const [injecting, setInjecting] = useState(false);

  async function confirmInlineDelete() {
    if (!inlineDeleteTarget) return;
    setInlineDeleting(true);
    try {
      const fn = httpsCallable(functions, 'deleteFax');
      await fn({ faxSid: inlineDeleteTarget.faxSid });
      setInlineDeleteTarget(null);
      if (selectedFaxSid === inlineDeleteTarget.faxSid) setSelectedFaxSid(null);
    } catch (err: any) {
      void modalAlert({ tone: 'error', title: 'Delete failed', message: err?.message || String(err) });
    } finally {
      setInlineDeleting(false);
    }
  }

  async function handleInjectInbound() {
    setInjecting(true);
    try {
      await faxesApi.injectInbound();
    } catch (err: any) {
      void modalAlert({ tone: 'error', title: 'Inject failed', message: err?.message || String(err) });
    } finally {
      setInjecting(false);
    }
  }

  if (authLoading) return <LoadingSpinner />;
  if (!user || !isAdminRole(userProfile?.role)) return <AccessDenied />;

  // Pagination already applies the status filter server-side, so `faxes` is
  // already the filtered set. `counts` come from useCollectionCounts (server
  // aggregation queries), not from the current page — so the stats grid and
  // tab counts are accurate across the whole dataset.
  const selected = faxes.find((f) => f.faxSid === selectedFaxSid) || null;

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    embedded ? <div className="space-y-6">{children}</div> : (
      <div className="space-y-6">{children}</div>
    );

  return (
    <Wrapper>
      {!embedded && (
        <PageHeader
          backTo="/admin"
          title="Inbound Faxes"
          subtitle="SignalWire fax pipeline — review, edit drafts, send emails to patients."
          icon={Inbox}
        />
      )}

      <StatsGrid
        items={[
          { label: 'Total', value: counts.all, icon: FileText, iconColor: 'bg-secondary-100 text-secondary-700' },
          { label: 'Needs Review', value: counts.needs_review, icon: AlertTriangle, iconColor: 'bg-orange-100 text-orange-700' },
          { label: 'Pending', value: counts.pending, icon: Clock, iconColor: 'bg-yellow-100 text-yellow-700' },
          { label: 'Failed', value: counts.failed, icon: X, iconColor: 'bg-red-100 text-red-700' },
        ]}
      />

      <FilterTabs
        activeKey={filter}
        onChange={(v) => setFilter(v as any)}
        tabs={[
          { key: 'all', label: 'All', count: counts.all },
          { key: 'needs_review', label: 'Needs Review', count: counts.needs_review },
          { key: 'pending', label: 'Pending', count: counts.pending },
          { key: 'processing', label: 'Processing', count: counts.processing },
          { key: 'failed', label: 'Failed', count: counts.failed },
          { key: 'completed', label: 'Completed', count: counts.completed },
        ]}
      />

      <div className="flex justify-end gap-2">
        <Button onClick={paged.refresh} loading={loading} variant="secondary" size="sm">
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
        {simulated && (
          <Button onClick={handleInjectInbound} loading={injecting} variant="secondary" size="sm">
            <Sparkles className="h-4 w-4 mr-1.5" />
            Simulate incoming fax
          </Button>
        )}
      </div>

      {loading ? <LoadingSpinner /> : faxes.length === 0 ? (
        <EmptyState icon={Inbox} title="No faxes" description="Inbound faxes will appear here." />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-secondary-200">
              <thead className="bg-secondary-100/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-secondary-600 uppercase">Received</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-secondary-600 uppercase">From</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-secondary-600 uppercase">Patient</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-secondary-600 uppercase">Pages</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-secondary-600 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-secondary-600 uppercase">Aurelia Step</th>
                  <th className="px-2 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-200/60">
                {faxes.map((f) => {
                  const badge = STATUS_BADGE[f.status];
                  const Icon = badge.icon;
                  return (
                    <tr
                      key={f.faxSid}
                      onClick={() => setSelectedFaxSid(f.faxSid)}
                      className="cursor-pointer hover:bg-primary-50/40"
                    >
                      <td className="px-4 py-3 text-sm text-secondary-800">
                        {f.receivedAt ? formatDateTime(f.receivedAt.toDate()) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary-800 font-mono">{f.from || '—'}</td>
                      <td className="px-4 py-3 text-sm text-secondary-800">
                        {f.extracted?.patientName || (
                          <span className="text-secondary-500 italic">not yet extracted</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary-800">{f.pageCount || '—'}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${badge.className}`}>
                          <Icon className={`w-3 h-3 ${f.status === 'processing' ? 'animate-spin' : ''}`} />
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-secondary-600 max-w-xs truncate">
                        {f.aurelia?.currentStep || '—'}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); setInlineDeleteTarget(f); }}
                          title="Delete this fax + PDF + notifications"
                          className="p-1.5 rounded text-secondary-400 hover:text-rose-600 hover:bg-rose-50"
                          aria-label="Delete inbound fax"
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-secondary-200">
            <PaginationBar
              currentPage={paged.page}
              pageSize={paged.pageSize}
              totalItems={(paged.page - 1) * paged.pageSize + faxes.length + (paged.hasNext ? 1 : 0)}
              hasMore={paged.hasNext}
              onPreviousPage={paged.prev}
              onNextPage={paged.next}
              label="faxes"
            />
          </div>
        </Card>
      )}

      {selected && (
        <FaxDetailDrawer fax={selected} onClose={() => setSelectedFaxSid(null)} />
      )}

      <ConfirmModal
        isOpen={!!inlineDeleteTarget}
        onClose={() => (inlineDeleting ? null : setInlineDeleteTarget(null))}
        onConfirm={confirmInlineDelete}
        title="Delete this inbound fax?"
        message={
          inlineDeleteTarget
            ? `Removes the row, the stored PDF, and any notifications tied to it. Cannot be undone.`
            : ''
        }
        confirmLabel={inlineDeleting ? 'Deleting…' : 'Delete'}
        variant="danger"
      />
    </Wrapper>
  );
};

// =============================================================================
// Detail drawer
// =============================================================================

const FaxDetailDrawer: React.FC<{ fax: InboundFax; onClose: () => void }> = ({ fax, onClose }) => {
  const navigate = useNavigate();
  const { url: pdfUrl, loading: pdfLoading, error: pdfError } = usePdfPreview(
    async () => {
      if (!fax.pdfPath) return null;
      const fn = httpsCallable(functions, 'getFaxPdfUrl');
      const res = (await fn({ faxSid: fax.faxSid })).data as { url: string };
      return res.url;
    },
    [fax.faxSid, fax.pdfPath],
  );
  const [draft, setDraft] = useState({
    to: fax.emailDraft?.to || '',
    subject: fax.emailDraft?.subject || '',
    body: fax.emailDraft?.body || '',
  });
  const [notes, setNotes] = useState(fax.notes || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDetachConfirm, setShowDetachConfirm] = useState(false);

  useEffect(() => {
    setDraft({
      to: fax.emailDraft?.to || '',
      subject: fax.emailDraft?.subject || '',
      body: fax.emailDraft?.body || '',
    });
    setNotes(fax.notes || '');
  }, [fax.faxSid, fax.emailDraft, fax.notes]);

  async function call(name: string, data: any, label: string): Promise<void> {
    setBusy(label);
    setMsg(null);
    try {
      const fn = httpsCallable(functions, name);
      await fn(data);
      setMsg({ kind: 'ok', text: `${label} succeeded` });
    } catch (err: any) {
      console.error(`${name} failed`, err);
      setMsg({ kind: 'err', text: err.message || `${label} failed` });
    } finally {
      setBusy(null);
    }
  }

  const handleSaveDraft = () => call('updateFaxDraft', {
    faxSid: fax.faxSid,
    patch: { emailDraft: { to: draft.to, subject: draft.subject, body: draft.body }, notes },
  }, 'Save');

  const handleSend = () => call('sendFaxEmail', {
    faxSid: fax.faxSid,
    overrideDraft: { to: draft.to, subject: draft.subject, body: draft.body },
  }, 'Send email');

  const handleProcessWithAurelia = async () => {
    setBusy('Process');
    setMsg(null);
    try {
      if (!pdfUrl) throw new Error('PDF not loaded yet');
      const res = await fetch(pdfUrl);
      if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
      const blob = await res.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const result = r.result as string;
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        r.onerror = reject;
        r.readAsDataURL(blob);
      });

      const prompt = `Fax \`${fax.faxSid}\` — extract + match only (do NOT upload to DrChrono).

From the attached PDF, extract patient name, DOB, document type, sending provider. Write a short patient-friendly summary and a longer internal summary. Search DrChrono for the patient. Draft the email.

Write results back via PATCH /admin-api/faxes/${fax.faxSid}. Include: \`extracted\`, \`matchedPatient\` (with \`drchronoId\` + \`confidence\`), \`aurelia.summary\`, \`aurelia.summaryForAdmin\`, \`aurelia.confidence\`, \`emailDraft\`, \`status: "needs_review"\`. Skip DrChrono upload — that's a separate button.`;

      sessionStorage.setItem('agent_prefill', JSON.stringify({
        message: prompt,
        attachment: {
          name: `fax-${fax.faxSid.slice(0, 8)}.pdf`,
          mimeType: 'application/pdf',
          base64,
        },
      }));
      navigate('/admin/agent');
    } catch (err: any) {
      console.error('Process with Aurelia failed', err);
      setMsg({ kind: 'err', text: err.message || 'Failed to prepare Aurelia task' });
      setBusy(null);
    }
  };

  const handleAttach = async () => {
    setBusy('Attach');
    setMsg(null);
    try {
      const fn = httpsCallable(functions, 'attachFaxToDrChrono');
      const res = (await fn({ faxSid: fax.faxSid })).data as {
        ok: boolean; alreadyAttached: boolean; drchronoDocumentId: number;
      };
      setMsg({
        kind: 'ok',
        text: res.alreadyAttached
          ? `Already attached (document #${res.drchronoDocumentId})`
          : `Attached to DrChrono (document #${res.drchronoDocumentId})`,
      });
    } catch (err: any) {
      console.error('attachFaxToDrChrono failed', err);
      setMsg({ kind: 'err', text: err.message || 'Attach failed' });
    } finally {
      setBusy(null);
    }
  };

  const handleDetach = async () => {
    setShowDetachConfirm(false);
    setBusy('Detach');
    setMsg(null);
    try {
      const fn = httpsCallable(functions, 'detachFaxFromDrChrono');
      await fn({ faxSid: fax.faxSid });
      setMsg({ kind: 'ok', text: 'Detached — you can re-attach now' });
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message || 'Detach failed' });
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    setBusy('Delete');
    setMsg(null);
    try {
      const fn = httpsCallable(functions, 'deleteFax');
      await fn({ faxSid: fax.faxSid });
      onClose();
    } catch (err: any) {
      console.error('deleteFax failed', err);
      setMsg({ kind: 'err', text: err.message || 'Delete failed' });
      setBusy(null);
    }
  };

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() =>
    setMsg({ kind: 'ok', text: 'Copied to clipboard' })
  );

  return createPortal(
    <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose}>
      <div
        className="bg-secondary-50 w-full h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-secondary-50/95 backdrop-blur border-b border-secondary-200 px-6 py-4 z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-secondary-900 truncate">Fax {fax.faxSid.slice(0, 16)}…</h2>
              <p className="text-xs text-secondary-500 mt-0.5">
                From {fax.from || '—'} • {fax.pageCount || '?'} pages • Status: {STATUS_BADGE[fax.status].label}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
              <Button
                onClick={handleProcessWithAurelia}
                disabled={!!busy || !pdfUrl}
                variant="secondary"
                className="!border-primary-600 !text-primary-700 hover:!bg-primary-50"
              >
                <Sparkles className="w-4 h-4 mr-1.5" />
                {busy === 'Process' ? 'Opening…' : 'Extract & Match'}
              </Button>
              {fax.drchronoDocumentId ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    disabled
                    className="!text-emerald-600 dark:!text-emerald-400 !border-emerald-500/30"
                    title={`Attached to DrChrono as document #${fax.drchronoDocumentId}`}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1.5" />
                    Attached #{fax.drchronoDocumentId}
                  </Button>
                  <button
                    onClick={() => setShowDetachConfirm(true)}
                    disabled={!!busy}
                    title="Remove the PDF from the DrChrono chart (for testing / corrections)"
                    className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Button
                  onClick={handleAttach}
                  variant="secondary"
                  disabled={!!busy || !fax.matchedPatient?.drchronoId}
                  title={fax.matchedPatient?.drchronoId
                    ? 'Upload PDF to matched DrChrono patient chart (one-time)'
                    : 'Run Extract & Match first to match a patient'}
                >
                  <Paperclip className="w-4 h-4 mr-1.5" />
                  {busy === 'Attach' ? 'Attaching…' : 'Attach to DrChrono'}
                </Button>
              )}
              <Button
                onClick={handleSend}
                variant="secondary"
                disabled={!!busy || !draft.to || !draft.subject || !draft.body}
              >
                <Send className="w-4 h-4 mr-1.5" />
                {busy === 'Send email' ? 'Sending…' : 'Send Email'}
              </Button>
              <button onClick={onClose} className="p-2 hover:bg-secondary-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 pb-6 pt-0 space-y-4">
          {msg && (
            <div className={`rounded-md px-4 py-2 text-sm border ${
              msg.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                 : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
            }`}>{msg.text}</div>
          )}

          {fax.lastError && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-md px-4 py-2 text-sm text-rose-700 dark:text-rose-300">
              <strong>Last error:</strong> {fax.lastError.message}
            </div>
          )}

          {/* Aurelia summary panel */}
          {fax.aurelia && (
            <Card className="p-4 bg-primary-50/40">
              <h3 className="text-sm font-semibold text-secondary-800 mb-2">Aurelia</h3>
              {fax.aurelia.currentStep && (
                <p className="text-xs text-secondary-600 mb-2"><strong>Current step:</strong> {fax.aurelia.currentStep}</p>
              )}
              {typeof fax.aurelia.confidence === 'number' && (
                <p className="text-xs text-secondary-600 mb-2"><strong>Confidence:</strong> {(fax.aurelia.confidence * 100).toFixed(0)}%</p>
              )}
              {fax.aurelia.summaryForAdmin && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-secondary-700 mb-1">Internal summary:</p>
                  <p className="text-sm text-secondary-800 whitespace-pre-wrap">{fax.aurelia.summaryForAdmin}</p>
                </div>
              )}
            </Card>
          )}

          {/* Processing status — visual chips for key outcomes */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-secondary-800 mb-3">Processing Status</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <StatusChip
                label="Patient match"
                state={patientMatchState(fax)}
              />
              <StatusChip
                label="DrChrono document"
                state={drchronoUploadState(fax)}
              />
            </div>
          </Card>

          {/* Extracted */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-secondary-800 mb-3">Extracted Info</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <dt className="text-secondary-500">Patient name</dt>
              <dd>{fax.extracted?.patientName || '—'}</dd>
              <dt className="text-secondary-500">DOB</dt>
              <dd>{fax.extracted?.patientDob || '—'}</dd>
              <dt className="text-secondary-500">Document type</dt>
              <dd>{fax.extracted?.documentType || '—'}</dd>
              <dt className="text-secondary-500">Sender</dt>
              <dd>{fax.extracted?.senderProvider || '—'}</dd>
              <dt className="text-secondary-500">DrChrono patient ID</dt>
              <dd>{fax.matchedPatient?.drchronoId || '—'}</dd>
              <dt className="text-secondary-500">DrChrono document ID</dt>
              <dd>{fax.drchronoDocumentId || '—'}</dd>
            </dl>
          </Card>

          {/* PDF preview */}
          {(pdfLoading || pdfUrl || pdfError) && (
            <Card className="p-2">
              {pdfLoading && (
                <div className="flex items-center justify-center h-[600px] text-secondary-500 text-sm gap-2">
                  <LoadingSpinner size="md" />
                  Loading PDF…
                </div>
              )}
              {!pdfLoading && pdfError && (
                <div className="flex items-center justify-center h-[600px] text-rose-600 text-sm">
                  {pdfError}
                </div>
              )}
              {!pdfLoading && pdfUrl && (
                <iframe src={pdfUrl} title="Fax PDF" className="w-full h-[600px] rounded" />
              )}
            </Card>
          )}

          {/* Email draft */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-secondary-800 mb-3">Email Draft</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-secondary-600">To (patient email)</label>
                <input
                  type="email"
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                  className="input w-full mt-1 text-sm"
                  placeholder="patient@example.com"
                />
              </div>
              <div>
                <label className="text-xs text-secondary-600 flex items-center justify-between">
                  <span>Subject</span>
                  <button onClick={() => copy(draft.subject)} className="text-primary-600 hover:underline flex items-center gap-1">
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                </label>
                <input
                  type="text"
                  value={draft.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  className="input w-full mt-1 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-secondary-600 flex items-center justify-between">
                  <span>Body</span>
                  <button onClick={() => copy(draft.body)} className="text-primary-600 hover:underline flex items-center gap-1">
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                </label>
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  rows={16}
                  className="input w-full mt-1 text-sm font-mono resize-y overflow-y-auto leading-relaxed"
                  style={{ minHeight: '16rem', maxHeight: '32rem' }}
                />
              </div>
              <div>
                <label className="text-xs text-secondary-600">Internal notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="input w-full mt-1 text-sm"
                />
              </div>
            </div>
          </Card>

          {/* Secondary actions */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSaveDraft} disabled={!!busy} variant="secondary">
              {busy === 'Save' ? 'Saving…' : 'Save Draft'}
            </Button>
            <Button
              onClick={() => setShowDeleteConfirm(true)}
              variant="secondary"
              disabled={!!busy}
              className="!text-rose-600 dark:!text-rose-400 hover:!bg-rose-500/10 !border-rose-500/30"
            >
              <Trash className="w-4 h-4 mr-1.5" />
              {busy === 'Delete' ? 'Deleting…' : 'Delete'}
            </Button>
          </div>

          <ConfirmModal
            isOpen={showDeleteConfirm}
            onClose={() => setShowDeleteConfirm(false)}
            onConfirm={handleDelete}
            title="Delete this fax?"
            message={`Permanently delete fax ${fax.faxSid.slice(0, 16)}… including the PDF and all related notifications. This cannot be undone.`}
            confirmLabel="Delete Permanently"
            variant="danger"
          />

          <ConfirmModal
            isOpen={showDetachConfirm}
            onClose={() => setShowDetachConfirm(false)}
            onConfirm={handleDetach}
            title="Detach from DrChrono?"
            message={`Document #${fax.drchronoDocumentId} will be removed from the patient chart so you can re-attach.`}
            confirmLabel="Detach"
            variant="warning"
          />

          {fax.emailSent && (
            <div className="text-xs text-secondary-500 border-t pt-4">
              Email sent: {fax.emailSent.sentAt ? formatDateTime(fax.emailSent.sentAt.toDate()) : '—'}
              {' '}(via {fax.emailSent.sentBy}) · Message ID: <span className="font-mono">{fax.emailSent.messageId}</span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
