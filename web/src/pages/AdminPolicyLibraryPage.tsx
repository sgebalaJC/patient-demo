import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, RefreshCw, ExternalLink } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { Button } from '../components/ui/Button';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';
import {
  subscribeToPayers,
  subscribeToPoliciesByPayer,
} from '../lib/firestore/prior-auths';
import { PolicyStatusBadge } from '../components/prior-auth/StatusBadge';
import { FreshnessBadge } from '../components/prior-auth/FreshnessBadge';
import type { Payer, PayerPolicy } from '../types/prior-auth';

export const AdminPolicyLibraryPage: React.FC = () => {
  const { userProfile } = useAuth();
  const [payers, setPayers] = useState<Payer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdminRole(userProfile?.role)) return;
    const unsub = subscribeToPayers(
      (r) => {
        setPayers(r);
        setLoading(false);
      },
      (err) => {
        setMsg(`Load error: ${err.message}`);
        setLoading(false);
      },
    );
    return unsub;
  }, [userProfile?.role]);

  async function refreshAll(): Promise<void> {
    setRefreshing(true);
    setMsg(null);
    try {
      const call = httpsCallable(functions, 'triggerPolicyRefresh');
      const res = (await call({})) as { data: { summary: { total: number; byResult: Record<string, number> } } };
      setMsg(`Fetched ${res.data.summary.total} — ${JSON.stringify(res.data.summary.byResult)}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  async function seed(): Promise<void> {
    setRefreshing(true);
    setMsg(null);
    try {
      const call = httpsCallable(functions, 'seedPaData');
      const res = (await call({})) as { data: { payers: number; cpts: number } };
      setMsg(`Seeded ${res.data.payers} payers, ${res.data.cpts} CPTs.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Seed failed');
    } finally {
      setRefreshing(false);
    }
  }

  if (!isAdminRole(userProfile?.role)) return <AccessDenied />;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          backTo="/admin/prior-auth"
          icon={ClipboardCheck}
          title="Policy Library"
          subtitle="Every tracked (payer, CPT) policy. Freshness + review status surfaced here."
        />
        <div className="flex items-center gap-2">
          {payers.length === 0 && (
            <Button variant="secondary" onClick={seed} disabled={refreshing}>
              Seed payers
            </Button>
          )}
          <Button onClick={refreshAll} disabled={refreshing} className="flex items-center gap-1.5">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh all
          </Button>
        </div>
      </div>

      {msg && (
        <Card className="p-3 text-sm bg-surface-elevated">
          {msg}
        </Card>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-3">
          {payers.map((payer) => (
            <PayerCard key={payer.id} payer={payer} />
          ))}
        </div>
      )}
    </div>
  );
};

const PayerCard: React.FC<{ payer: Payer }> = ({ payer }) => {
  const [policies, setPolicies] = useState<PayerPolicy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToPoliciesByPayer(
      payer.id,
      (rows) => {
        setPolicies(rows.sort((a, b) => a.cptCode.localeCompare(b.cptCode)));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [payer.id]);

  const statusColor = payer.adapterStatus === 'implemented'
    ? 'bg-green-100 text-green-700'
    : payer.adapterStatus === 'no_public_policy'
    ? 'bg-secondary-100 text-secondary-600'
    : 'bg-yellow-100 text-yellow-800';

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div>
          <div className="font-semibold text-secondary-900">{payer.name}</div>
          <div className="text-xs text-secondary-500">{payer.type}{payer.state ? ` · ${payer.state}` : ''}</div>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusColor}`}>
          {payer.adapterStatus.replace(/_/g, ' ')}
        </span>
        {payer.policyIndexUrl && (
          <a
            href={payer.policyIndexUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary-600 hover:underline inline-flex items-center gap-1"
          >
            Policy site <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {payer.adapterNotes && (
        <div className="text-xs text-secondary-600 italic mb-2">{payer.adapterNotes}</div>
      )}
      {loading ? (
        <LoadingSpinner size="sm" />
      ) : policies.length === 0 ? (
        <div className="text-xs text-secondary-500 italic">No policies fetched yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {policies.map((p) => (
            <Link
              key={p.id}
              to={`/admin/prior-auth/policies/${p.id}`}
              className="flex items-center gap-2 text-sm border border-secondary-200 rounded-md px-2 py-1.5 hover:bg-primary-50"
            >
              <code className="text-xs bg-secondary-100 px-1.5 py-0.5 rounded">{p.cptCode}</code>
              <div className="flex-1 min-w-0 truncate text-secondary-700">
                {p.extractedCriteria?.narrativeSummary ?? p.rawTextPreview?.slice(0, 80) ?? '(not extracted)'}
              </div>
              <PolicyStatusBadge status={p.status} />
              <FreshnessBadge sourceFetchedAt={p.sourceFetchedAt} humanReviewedAt={p.humanReviewedAt} />
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
};
