import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus, AlertCircle, ShieldCheck, Clock, FileWarning, RefreshCw } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { StatsGrid } from '../components/ui/StatsGrid';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { PaginationBar } from '../components/ui/PaginationBar';
import { Button } from '../components/ui/Button';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';
import { usePagedCollection, type WhereClause } from '../hooks/usePagedCollection';
import { useCollectionCounts } from '../hooks/useCollectionCounts';
import { PaStatusBadge } from '../components/prior-auth/StatusBadge';
import type { PriorAuth, PriorAuthStatus } from '../types/prior-auth';

type TabKey = 'all' | 'open' | 'followup' | 'approved' | 'denied';

const OPEN_STATUSES: PriorAuthStatus[] = ['draft', 'submitted', 'pending', 'needs_info', 'peer_to_peer'];

export const AdminPriorAuthPage: React.FC = () => {
  const { userProfile } = useAuth();
  const isAdminUser = isAdminRole(userProfile?.role);
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('open');

  const whereClauses = useMemo<WhereClause[] | undefined>(() => {
    switch (tab) {
      case 'all': return undefined;
      case 'open': return [['status', 'in', OPEN_STATUSES]];
      case 'followup': return [['needsFollowup', '==', true]];
      case 'approved': return [['status', '==', 'approved']];
      case 'denied': return [['status', '==', 'denied']];
    }
  }, [tab]);

  const paged = usePagedCollection<PriorAuth>({
    enabled: isAdminUser,
    real: 'prior-auths',
    orderField: 'updatedAt',
    pageSize: 25,
    whereClauses,
    mapDoc: (d) => ({ ...(d.data() as PriorAuth), id: d.id }),
  });
  const filtered = paged.rows;
  const loading = paged.loading;

  const countsPredicates = useMemo(() => ({
    total: [] as [string, '==' | 'in', unknown][],
    open: [['status', 'in', OPEN_STATUSES]] as [string, '==' | 'in', unknown][],
    followup: [['needsFollowup', '==', true]] as [string, '==' | 'in', unknown][],
    approved: [['status', '==', 'approved']] as [string, '==' | 'in', unknown][],
    denied: [['status', '==', 'denied']] as [string, '==' | 'in', unknown][],
  }), []);
  const { counts, refresh: refreshCounts } = useCollectionCounts({
    enabled: isAdminUser,
    real: 'prior-auths',
    predicates: countsPredicates,
  });

  const refreshAll = () => { paged.refresh(); refreshCounts(); };

  if (!isAdminUser) return <AccessDenied />;

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        icon={ClipboardCheck}
        title="Prior Authorization"
        subtitle="Track payer authorizations, prevent rejections with payer-specific criteria and chart gap-checks."
        action={
          <Button
            onClick={() => navigate('/admin/prior-auth/new')}
            className="flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" /> New
          </Button>
        }
      />

      <StatsGrid
        items={[
          { icon: Clock, iconColor: 'bg-blue-100 text-blue-600', label: 'Open', value: counts.open },
          { icon: AlertCircle, iconColor: 'bg-yellow-100 text-yellow-600', label: 'Needs followup', value: counts.followup },
          { icon: ShieldCheck, iconColor: 'bg-green-100 text-green-600', label: 'Approved', value: counts.approved },
          { icon: FileWarning, iconColor: 'bg-red-100 text-red-600', label: 'Denied', value: counts.denied },
        ]}
      />

      <Card className="p-4">
        <div className="flex items-center gap-2 flex-wrap">
          {(['open', 'followup', 'approved', 'denied', 'all'] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border ${
                tab === t ? 'border-primary-600 text-primary-700 bg-primary-50' : 'border-transparent bg-surface-elevated text-secondary-700 hover:bg-primary-100'
              }`}
            >
              {t === 'open' && `Open (${counts.open})`}
              {t === 'followup' && `Followup (${counts.followup})`}
              {t === 'approved' && `Approved (${counts.approved})`}
              {t === 'denied' && `Denied (${counts.denied})`}
              {t === 'all' && `All (${counts.total})`}
            </button>
          ))}
          <div className="flex-1" />
          <Link
            to="/admin/prior-auth/policies"
            className="text-sm text-primary-600 hover:underline"
          >
            Policy library →
          </Link>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={refreshAll} loading={loading} variant="secondary" size="sm">
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No PAs yet"
          description="Create a new prior auth to gap-check a procedure against the selected payer's criteria before you submit."
          action={
            <Button onClick={() => navigate('/admin/prior-auth/new')} className="flex items-center gap-1.5 mx-auto">
              <Plus className="h-4 w-4" /> New PA
            </Button>
          }
        />
      ) : (
        <Card>
          <div className="divide-y divide-secondary-100">
            {filtered.map((pa) => (
              <Link
                key={pa.id}
                to={`/admin/prior-auth/${pa.id}`}
                className="block px-4 py-3 hover:bg-primary-50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-secondary-900 truncate">{pa.patientName}</span>
                      <PaStatusBadge status={pa.status} />
                      {pa.needsFollowup && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                          Needs followup
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-secondary-500 truncate">
                      {pa.payerName} · CPT {pa.cptCode}
                      {pa.procedureLabel ? ` — ${pa.procedureLabel}` : ''}
                      {pa.referenceNumber ? ` · Ref ${pa.referenceNumber}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-secondary-500">
                    {pa.updatedAt ? new Date(pa.updatedAt.toMillis()).toLocaleString() : ''}
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div className="p-3 border-t border-secondary-100">
            <PaginationBar
              currentPage={paged.page}
              pageSize={paged.pageSize}
              totalItems={(paged.page - 1) * paged.pageSize + filtered.length + (paged.hasNext ? 1 : 0)}
              hasMore={paged.hasNext}
              onPreviousPage={paged.prev}
              onNextPage={paged.next}
              label="prior auths"
            />
          </div>
        </Card>
      )}
    </div>
  );
};
