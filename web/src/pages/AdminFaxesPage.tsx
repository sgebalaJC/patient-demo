import React, { useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { functions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { Inbox, FileText, Trash, Sparkles, RefreshCw } from 'lucide-react';
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
import { faxes as faxesApi } from '../lib/integrations';
import { alert as modalAlert } from '../lib/modals';
import logger from '../lib/logger';
import { errorMessage } from '../lib/errors';
import { FAX_STATUS_BADGE, type FaxRowStatus } from '../components/faxes/FaxStatusChip';
import { InboundFaxDrawer, type InboundFax } from '../components/faxes/InboundFaxDrawer';

type FaxStatus = FaxRowStatus;

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
    mapDoc: (d) => {
      const data = d.data() as Partial<InboundFax>;
      if (!data.status) {
        logger.warn(`[inbound-faxes] doc ${d.id} missing required field "status"`);
      }
      return { ...data, faxSid: d.id } as InboundFax;
    },
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
    } catch (err: unknown) {
      void modalAlert({ tone: 'error', title: 'Delete failed', message: errorMessage(err) });
    } finally {
      setInlineDeleting(false);
    }
  }

  async function handleInjectInbound() {
    setInjecting(true);
    try {
      await faxesApi.injectInbound();
    } catch (err: unknown) {
      void modalAlert({ tone: 'error', title: 'Inject failed', message: errorMessage(err) });
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
        onChange={(v) => setFilter(v as 'all' | FaxStatus)}
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-secondary-600 uppercase">{AGENT_NAME} Step</th>
                  <th className="px-2 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-200/60">
                {faxes.map((f) => {
                  const badge = FAX_STATUS_BADGE[f.status];
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
        <InboundFaxDrawer fax={selected} onClose={() => setSelectedFaxSid(null)} />
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

