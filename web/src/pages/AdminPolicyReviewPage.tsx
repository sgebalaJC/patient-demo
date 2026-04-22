import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ClipboardCheck, CheckCircle2, XCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { Button } from '../components/ui/Button';
import { useAuth } from '../hooks/useAuth';
import { getPolicy } from '../lib/firestore/prior-auths';
import type { PayerPolicy } from '../types/prior-auth';
import { PolicyStatusBadge } from '../components/prior-auth/StatusBadge';
import { FreshnessBadge } from '../components/prior-auth/FreshnessBadge';

export const AdminPolicyReviewPage: React.FC = () => {
  const { policyId } = useParams();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const [policy, setPolicy] = useState<PayerPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!policyId) return;
    (async () => {
      try {
        setPolicy(await getPolicy(policyId));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [policyId]);

  async function review(action: 'approve' | 'reject'): Promise<void> {
    if (!policyId) return;
    setSubmitting(true);
    setError(null);
    try {
      const call = httpsCallable(functions, 'submitPolicyReview');
      await call({ policyId, action, notes });
      setPolicy(await getPolicy(policyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function refetch(): Promise<void> {
    if (!policy) return;
    setSubmitting(true);
    setError(null);
    try {
      const call = httpsCallable(functions, 'triggerPolicyRefresh');
      await call({ payerIds: [policy.payerId], cptCodes: [policy.cptCode] });
      setPolicy(await getPolicy(policy.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refetch failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (userProfile?.role !== 'admin') return <AccessDenied />;
  if (loading) return <LoadingSpinner />;
  if (!policy) {
    return (
      <div className="p-6">
        <div className="text-secondary-500">Policy not found.</div>
        <button className="text-primary-600 hover:underline text-sm mt-2" onClick={() => navigate(-1)}>
          ← Back
        </button>
      </div>
    );
  }

  const c = policy.extractedCriteria;

  return (
    <div className="space-y-5">
      <PageHeader
        backTo="/admin/prior-auth/policies"
        icon={ClipboardCheck}
        title={`${policy.payerId} · CPT ${policy.cptCode}`}
        subtitle="Review extracted criteria against the source document before marking active."
      />

      {error && (
        <Card className="p-3 text-sm bg-red-50 border border-red-200 text-red-800">{error}</Card>
      )}

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <PolicyStatusBadge status={policy.status} />
          <FreshnessBadge sourceFetchedAt={policy.sourceFetchedAt} humanReviewedAt={policy.humanReviewedAt} />
          <a
            href={policy.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary-600 hover:underline inline-flex items-center gap-1"
          >
            Source <ExternalLink className="h-3 w-3" />
          </a>
          <div className="flex-1" />
          <Button variant="secondary" onClick={refetch} disabled={submitting} className="flex items-center gap-1.5">
            <RefreshCw className={`h-4 w-4 ${submitting ? 'animate-spin' : ''}`} /> Re-fetch source
          </Button>
        </div>
        {policy.sourceEffectiveDate && (
          <div className="text-xs text-secondary-500">
            Effective: {new Date(policy.sourceEffectiveDate.toMillis()).toLocaleDateString()}
          </div>
        )}
        {policy.brokenReason && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md p-2">
            Broken: {policy.brokenReason}
          </div>
        )}
      </Card>

      {c ? (
        <Card className="p-4 space-y-4 text-sm">
          <Section title={`Required diagnoses (${c.requiredDiagnoses?.length ?? 0})`}>
            {c.requiredDiagnoses?.map((d, i) => (
              <div key={i}>
                <code className="text-xs bg-secondary-100 px-1 py-0.5 rounded">{d.icd10}</code>
                {d.label ? ` — ${d.label}` : ''}
                <CitationQuote text={d.citation?.quote} />
              </div>
            ))}
          </Section>
          <Section title={`Prior trials (${c.requiredPriorTrials?.length ?? 0})`}>
            {c.requiredPriorTrials?.map((t, i) => (
              <div key={i}>
                • {t.description}
                {t.durationWeeks ? ` (≥${t.durationWeeks}w)` : ''}
                <CitationQuote text={t.citation?.quote} />
              </div>
            ))}
          </Section>
          <Section title={`Documentation (${c.requiredDocumentation?.length ?? 0})`}>
            {c.requiredDocumentation?.map((d, i) => (
              <div key={i}>
                • {d.type}: {d.description}
                <CitationQuote text={d.citation?.quote} />
              </div>
            ))}
          </Section>
          <Section title={`Exclusions (${c.exclusions?.length ?? 0})`}>
            {c.exclusions?.map((e, i) => (
              <div key={i}>
                • {e.description}
                <CitationQuote text={e.citation?.quote} />
              </div>
            ))}
          </Section>
          {c.narrativeSummary && (
            <Section title="Narrative summary">
              <div className="whitespace-pre-wrap text-secondary-700">{c.narrativeSummary}</div>
            </Section>
          )}
        </Card>
      ) : (
        <Card className="p-4 text-sm text-secondary-500 italic">
          Criteria haven't been extracted yet. Run the extraction pass or mark for manual review.
        </Card>
      )}

      {policy.status === 'pending_review' && (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-semibold text-secondary-900">Review</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reviewer notes (optional)"
            rows={3}
            className="w-full border border-secondary-200 rounded-md px-2 py-2 bg-surface-elevated text-sm"
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={() => review('approve')}
              disabled={submitting}
              className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700"
            >
              <CheckCircle2 className="h-4 w-4" /> Approve
            </Button>
            <Button
              variant="secondary"
              onClick={() => review('reject')}
              disabled={submitting}
              className="flex items-center gap-1.5"
            >
              <XCircle className="h-4 w-4" /> Reject
            </Button>
          </div>
        </Card>
      )}

      {policy.rawTextPreview && (
        <Card className="p-4 space-y-1">
          <div className="text-sm font-semibold text-secondary-900">Source preview</div>
          <pre className="text-xs text-secondary-600 whitespace-pre-wrap max-h-96 overflow-y-auto bg-surface-elevated p-2 rounded border border-secondary-100">
            {policy.rawTextPreview}
          </pre>
        </Card>
      )}
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="text-xs font-medium text-secondary-500 uppercase tracking-wide mb-1">{title}</div>
    <div className="space-y-1">{children}</div>
  </div>
);

const CitationQuote: React.FC<{ text?: string }> = ({ text }) => {
  if (!text) return null;
  return (
    <div className="text-xs italic text-secondary-500 mt-0.5 border-l-2 border-secondary-200 pl-2">
      "{text.length > 300 ? text.slice(0, 300) + '…' : text}"
    </div>
  );
};
