import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus, AlertCircle, ShieldCheck, Clock, FileWarning } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { StatsGrid } from '../components/ui/StatsGrid';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { Button } from '../components/ui/Button';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';
import { subscribeToPriorAuths } from '../lib/firestore/prior-auths';
import { PaStatusBadge } from '../components/prior-auth/StatusBadge';
import type { PriorAuth, PriorAuthStatus } from '../types/prior-auth';

type TabKey = 'all' | 'open' | 'followup' | 'approved' | 'denied';

const OPEN_STATUSES: PriorAuthStatus[] = ['draft', 'submitted', 'pending', 'needs_info', 'peer_to_peer'];

export const AdminPriorAuthPage: React.FC = () => {
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<PriorAuth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('open');

  useEffect(() => {
    if (!isAdminRole(userProfile?.role)) return;
    const unsub = subscribeToPriorAuths(
      (r) => {
        setRows(r);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [userProfile?.role]);

  const counts = useMemo(() => {
    const open = rows.filter((r) => OPEN_STATUSES.includes(r.status)).length;
    const followup = rows.filter((r) => r.needsFollowup).length;
    const approved = rows.filter((r) => r.status === 'approved').length;
    const denied = rows.filter((r) => r.status === 'denied').length;
    return { total: rows.length, open, followup, approved, denied };
  }, [rows]);

  const filtered = useMemo(() => {
    switch (tab) {
      case 'all':
        return rows;
      case 'open':
        return rows.filter((r) => OPEN_STATUSES.includes(r.status));
      case 'followup':
        return rows.filter((r) => r.needsFollowup);
      case 'approved':
        return rows.filter((r) => r.status === 'approved');
      case 'denied':
        return rows.filter((r) => r.status === 'denied');
    }
  }, [rows, tab]);

  if (!isAdminRole(userProfile?.role)) return <AccessDenied />;

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

      {error && (
        <Card className="p-4 border border-red-200 bg-red-50 text-red-800 text-sm">
          Failed to load: {error}
        </Card>
      )}

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
        </Card>
      )}
    </div>
  );
};
