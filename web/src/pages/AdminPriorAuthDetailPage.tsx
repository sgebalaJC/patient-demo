import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ClipboardCheck, CheckCircle2, XCircle, HelpCircle, MessageSquarePlus, Send, ExternalLink } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../hooks/useAuth';
import { useSimulationMode } from '../hooks/useSimulationMode';
import { isAdminRole } from '../lib/roles';
import { subscribeToPriorAuth, appendNote, updateChecklist } from '../lib/firestore/prior-auths';
import { PaStatusBadge } from '../components/prior-auth/StatusBadge';
import { FreshnessBadge } from '../components/prior-auth/FreshnessBadge';
import type { PriorAuth, PriorAuthStatus, CriteriaChecklistItem } from '../types/prior-auth';

const TRANSITIONS: Record<PriorAuthStatus, PriorAuthStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['pending', 'needs_info', 'approved', 'denied', 'peer_to_peer', 'cancelled'],
  pending: ['needs_info', 'approved', 'denied', 'peer_to_peer', 'cancelled'],
  needs_info: ['submitted', 'approved', 'denied', 'cancelled'],
  peer_to_peer: ['approved', 'denied', 'appeal', 'cancelled'],
  approved: ['cancelled'],
  denied: ['appeal', 'cancelled'],
  appeal: ['approved', 'denied', 'cancelled'],
  cancelled: [],
};

export const AdminPriorAuthDetailPage: React.FC = () => {
  const { paId } = useParams();
  const navigate = useNavigate();
  const { user, userProfile } = useAuth();
  const { enabled: simulated } = useSimulationMode();
  const [pa, setPa] = useState<PriorAuth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [statusAction, setStatusAction] = useState<PriorAuthStatus | ''>('');
  const [statusMeta, setStatusMeta] = useState<Record<string, string>>({});
  const [runningCheck, setRunningCheck] = useState(false);

  useEffect(() => {
    if (!paId) return;
    const unsub = subscribeToPriorAuth(
      paId,
      (next) => {
        setPa(next);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
      simulated,
    );
    return unsub;
  }, [paId, simulated]);

  async function addNote(): Promise<void> {
    if (!paId || !user || !userProfile || !noteText.trim()) return;
    const name = [userProfile.firstName, userProfile.lastName].filter(Boolean).join(' ').trim() || userProfile.email || 'Admin';
    await appendNote(paId, user.uid, name, noteText.trim(), simulated);
    setNoteText('');
  }

  async function runGapCheck(): Promise<void> {
    if (!paId) return;
    setRunningCheck(true);
    setError(null);
    try {
      const call = httpsCallable(functions, 'runChartGapCheck');
      await call({ paId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gap check failed');
    } finally {
      setRunningCheck(false);
    }
  }

  async function transition(): Promise<void> {
    if (!paId || !statusAction) return;
    try {
      const call = httpsCallable(functions, 'updatePriorAuthStatus');
      await call({ paId, newStatus: statusAction, meta: statusMeta });
      setStatusAction('');
      setStatusMeta({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status change failed');
    }
  }

  async function toggleCriterion(idx: number, value: boolean | null): Promise<void> {
    if (!pa || !paId) return;
    const next = pa.criteriaChecklist.map((c, i) => (i === idx ? { ...c, met: value, manuallyOverridden: true } : c));
    await updateChecklist(paId, next, simulated);
  }

  async function setEvidence(idx: number, evidence: string): Promise<void> {
    if (!pa || !paId) return;
    const next = pa.criteriaChecklist.map((c, i) => (i === idx ? { ...c, evidence } : c));
    await updateChecklist(paId, next, simulated);
  }

  if (!isAdminRole(userProfile?.role)) return <AccessDenied />;
  if (loading) return <LoadingSpinner />;
  if (!pa) return <div className="p-6 text-secondary-500">Not found.</div>;

  const transitions = TRANSITIONS[pa.status];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          backTo="/admin/prior-auth"
          icon={ClipboardCheck}
          title={`${pa.patientName} · CPT ${pa.cptCode}`}
          subtitle={`${pa.payerName}${pa.procedureLabel ? ` — ${pa.procedureLabel}` : ''}`}
        />
        <PaStatusBadge status={pa.status} />
      </div>

      {error && (
        <Card className="p-3 border border-red-200 bg-red-50 text-sm text-red-800">
          {error}
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm font-semibold text-secondary-900">Policy criteria checklist</div>
          {pa.policyFreshness && (
            <FreshnessBadge
              sourceFetchedAt={pa.policyFreshness.sourceFetchedAt}
              humanReviewedAt={pa.policyFreshness.humanReviewedAt}
            />
          )}
          <div className="flex-1" />
          <Button onClick={runGapCheck} disabled={runningCheck} variant="secondary" className="text-sm">
            {runningCheck ? <LoadingSpinner size="sm" /> : null}
            Re-run chart gap check
          </Button>
          {pa.policyFreshness?.policyId && (
            <a
              className="text-xs text-primary-600 hover:underline inline-flex items-center gap-1"
              href={`/admin/prior-auth/policies/${pa.policyFreshness.policyId}`}
            >
              View policy source <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {pa.criteriaChecklist.length === 0 ? (
          <div className="text-sm text-secondary-500 italic">
            No criteria attached — the policy for this (payer, CPT) had no extracted criteria. Consult the payer site manually.
          </div>
        ) : (
          <div className="divide-y divide-secondary-100">
            {pa.criteriaChecklist.map((c, i) => (
              <ChecklistRow
                key={c.criterionId}
                item={c}
                onToggle={(v) => toggleCriterion(i, v)}
                onEvidence={(text) => setEvidence(i, text)}
              />
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold text-secondary-900">Status & submission</div>
        {transitions.length === 0 ? (
          <div className="text-sm text-secondary-500 italic">Terminal status — no further transitions.</div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusAction}
              onChange={(e) => setStatusAction(e.target.value as PriorAuthStatus)}
              className="border border-secondary-200 rounded-md px-2 py-1.5 bg-surface-elevated text-sm"
            >
              <option value="">Transition to…</option>
              {transitions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {statusAction === 'submitted' && (
              <Input
                placeholder="Payer reference #"
                value={statusMeta.referenceNumber ?? ''}
                onChange={(e) => setStatusMeta((prev) => ({ ...prev, referenceNumber: e.target.value }))}
              />
            )}
            {statusAction === 'approved' && (
              <Input
                placeholder="Auth number (optional)"
                value={statusMeta.authNumber ?? ''}
                onChange={(e) => setStatusMeta((prev) => ({ ...prev, authNumber: e.target.value }))}
              />
            )}
            {statusAction === 'denied' && (
              <Input
                placeholder="Denial reason (required)"
                value={statusMeta.denialReason ?? ''}
                onChange={(e) => setStatusMeta((prev) => ({ ...prev, denialReason: e.target.value }))}
              />
            )}
            <Button onClick={transition} disabled={!statusAction}>Apply</Button>
          </div>
        )}
        {pa.referenceNumber && (
          <div className="text-sm text-secondary-600">Reference: <span className="font-mono">{pa.referenceNumber}</span></div>
        )}
        {pa.authNumber && (
          <div className="text-sm text-secondary-600">Auth #: <span className="font-mono">{pa.authNumber}</span></div>
        )}
        {pa.denialReason && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md p-2">
            Denial reason: {pa.denialReason}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold text-secondary-900 flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4" /> Notes
        </div>
        <div className="space-y-2">
          {(pa.notes ?? []).map((n) => (
            <div key={n.id} className="bg-surface-elevated rounded-md p-2 text-sm">
              <div className="font-medium text-secondary-900">{n.authorName}</div>
              <div className="text-secondary-700 whitespace-pre-wrap">{n.text}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Add a note…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addNote();
              }
            }}
          />
          <Button onClick={addNote} disabled={!noteText.trim()} className="flex items-center gap-1">
            <Send className="h-4 w-4" /> Add
          </Button>
        </div>
      </Card>

      <button
        onClick={() => navigate('/admin/prior-auth')}
        className="text-sm text-secondary-500 hover:text-secondary-700"
      >
        ← Back to tracker
      </button>
    </div>
  );
};

const ChecklistRow: React.FC<{
  item: CriteriaChecklistItem;
  onToggle: (value: boolean | null) => void;
  onEvidence: (text: string) => void;
}> = ({ item, onToggle, onEvidence }) => {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(item.evidence ?? '');
  return (
    <div className="py-2.5 flex items-start gap-3">
      <div className="pt-0.5">
        {item.met === true ? (
          <button onClick={() => onToggle(null)} title="Clear">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          </button>
        ) : item.met === false ? (
          <button onClick={() => onToggle(null)} title="Clear">
            <XCircle className="h-5 w-5 text-red-600" />
          </button>
        ) : (
          <div className="flex flex-col gap-0.5">
            <button onClick={() => onToggle(true)} title="Met" className="text-green-600 hover:text-green-700">
              <CheckCircle2 className="h-4 w-4" />
            </button>
            <button onClick={() => onToggle(false)} title="Not met" className="text-red-600 hover:text-red-700">
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-secondary-900">
          <span className="text-xs uppercase font-medium text-secondary-500 mr-2">{item.category}</span>
          {item.description}
          {item.manuallyOverridden && (
            <span className="ml-2 text-xs text-amber-700">(manual override)</span>
          )}
        </div>
        {editing ? (
          <div className="flex items-center gap-2 mt-1">
            <Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Evidence from chart" />
            <Button
              variant="secondary"
              onClick={() => {
                onEvidence(local);
                setEditing(false);
              }}
              className="text-xs"
            >
              Save
            </Button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="text-xs text-primary-600 hover:underline mt-0.5 text-left">
            {item.evidence ? item.evidence : <span className="text-secondary-400 italic">+ Add evidence</span>}
          </button>
        )}
        {item.chartRef && (
          <div className="text-xs text-secondary-400 mt-0.5 inline-flex items-center gap-1">
            <HelpCircle className="h-3 w-3" /> Ref: {item.chartRef}
          </div>
        )}
      </div>
    </div>
  );
};
