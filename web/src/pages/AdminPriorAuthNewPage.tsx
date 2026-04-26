import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Search, CheckCircle2, AlertCircle, ArrowRight, X } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { AlertBanner } from '../components/ui/AlertBanner';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';
import { listPayersOnce, listTargetCpts, getPolicy } from '../lib/firestore/prior-auths';
import { userOperations } from '../lib/firestore/users';
import type { Payer, PayerPolicy, TargetCpt } from '../types/prior-auth';
import { PolicyStatusBadge } from '../components/prior-auth/StatusBadge';
import { FreshnessBadge } from '../components/prior-auth/FreshnessBadge';

interface PatientOption {
  id: string;
  name: string;
  email?: string;
  dateOfBirth?: string;
}

export const AdminPriorAuthNewPage: React.FC = () => {
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const [payers, setPayers] = useState<Payer[]>([]);
  const [cpts, setCpts] = useState<TargetCpt[]>([]);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<PatientOption[]>([]);
  const [patientSearching, setPatientSearching] = useState(false);
  const [payerId, setPayerId] = useState('');
  const [memberNumber, setMemberNumber] = useState('');
  const [cptCode, setCptCode] = useState('');
  const [icd10Input, setIcd10Input] = useState('');
  const [icd10Codes, setIcd10Codes] = useState<string[]>([]);
  const [policy, setPolicy] = useState<PayerPolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdminRole(userProfile?.role)) return;
    (async () => {
      const [p, c] = await Promise.all([listPayersOnce(), listTargetCpts()]);
      setPayers(p.filter((x) => x.active));
      setCpts(c.filter((x) => x.active));
    })();
  }, [userProfile?.role]);

  // Debounced patient search. Admins search across all patients by name/email.
  useEffect(() => {
    if (patientSearch.trim().length < 2) {
      setPatientResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setPatientSearching(true);
      try {
        const res = await userOperations.getAllUsers(20, 1, patientSearch);
        if (cancelled) return;
        if (res.success && res.data) {
          setPatientResults(
            res.data.users
              .filter((u) => u.role === 'patient')
              .map((u) => ({
                id: u.id,
                name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || u.id,
                email: u.email,
                dateOfBirth:
                  typeof u.dateOfBirth === 'string'
                    ? u.dateOfBirth
                    : u.dateOfBirth
                    ? new Date(u.dateOfBirth.toMillis()).toISOString().slice(0, 10)
                    : undefined,
              })),
          );
        }
      } finally {
        if (!cancelled) setPatientSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [patientSearch]);

  // When payer + cpt selected, load the policy so step 3 can render the
  // criteria gap check.
  useEffect(() => {
    if (!payerId || !cptCode) {
      setPolicy(null);
      return;
    }
    let cancelled = false;
    setPolicyLoading(true);
    getPolicy(`${payerId}_${cptCode}`)
      .then((p) => {
        if (!cancelled) setPolicy(p);
      })
      .finally(() => {
        if (!cancelled) setPolicyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payerId, cptCode]);

  const selectedPayer = useMemo(() => payers.find((p) => p.id === payerId) || null, [payers, payerId]);
  const selectedCpt = useMemo(() => cpts.find((c) => c.cptCode === cptCode) || null, [cpts, cptCode]);

  const addIcd10 = () => {
    const v = icd10Input.trim().toUpperCase();
    if (!v || icd10Codes.includes(v)) return;
    setIcd10Codes((prev) => [...prev, v]);
    setIcd10Input('');
  };

  async function handleCreate(): Promise<void> {
    if (!patient || !payerId || !cptCode) return;
    setSubmitting(true);
    setError(null);
    try {
      const call = httpsCallable(functions, 'createPriorAuth');
      const res = (await call({
        patientId: patient.id,
        payerId,
        cptCode,
        icd10Codes,
        memberNumber: memberNumber || undefined,
        procedureLabel: selectedCpt?.label,
      })) as { data: { paId: string } };
      navigate(`/admin/prior-auth/${res.data.paId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create PA');
      setSubmitting(false);
    }
  }

  if (!isAdminRole(userProfile?.role)) return <AccessDenied />;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-5">
      <PageHeader
        backTo="/admin/prior-auth"
        icon={ClipboardCheck}
        title="New Prior Authorization"
        subtitle="Match the patient's chart against the payer's criteria before you submit."
      />

      <Card className="p-5 space-y-3">
        <StepHeader n={1} label="Patient" active={step === 1} done={!!patient} />
        {step === 1 ? (
          <>
            <label className="flex items-center gap-2 border border-secondary-200 rounded-md px-3 py-2 bg-surface-elevated">
              <Search className="h-4 w-4 text-secondary-500" />
              <input
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                placeholder="Search patient by name or email…"
                className="flex-1 bg-transparent outline-none text-sm"
              />
              {patientSearching && <LoadingSpinner size="sm" />}
            </label>
            {patientResults.length > 0 && (
              <div className="max-h-80 overflow-y-auto divide-y divide-secondary-100 border border-secondary-200 rounded-md">
                {patientResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPatient(p);
                      setStep(2);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-primary-50 text-sm"
                  >
                    <div className="font-medium text-secondary-900">{p.name}</div>
                    <div className="text-xs text-secondary-500">
                      {p.email ?? ''}{p.dateOfBirth ? ` · DOB ${p.dateOfBirth}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : patient ? (
          <SummaryRow
            label={patient.name}
            subtitle={[patient.email, patient.dateOfBirth ? `DOB ${patient.dateOfBirth}` : null].filter(Boolean).join(' · ')}
            onClear={() => {
              setPatient(null);
              setStep(1);
            }}
          />
        ) : null}
      </Card>

      <Card className="p-5 space-y-3" aria-disabled={!patient}>
        <StepHeader n={2} label="Payer & procedure" active={step === 2} done={!!payerId && !!cptCode} />
        {step === 2 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary-700 mb-1">Payer</label>
              <select
                value={payerId}
                onChange={(e) => setPayerId(e.target.value)}
                className="w-full border border-secondary-200 rounded-md px-2 py-2 bg-surface-elevated text-sm"
              >
                <option value="">Select payer…</option>
                {payers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.adapterStatus !== 'implemented' ? ' (manual lookup)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-700 mb-1">Member ID</label>
              <Input
                value={memberNumber}
                onChange={(e) => setMemberNumber(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-700 mb-1">CPT</label>
              <select
                value={cptCode}
                onChange={(e) => setCptCode(e.target.value)}
                className="w-full border border-secondary-200 rounded-md px-2 py-2 bg-surface-elevated text-sm"
              >
                <option value="">Select procedure…</option>
                {cpts.map((c) => (
                  <option key={c.cptCode} value={c.cptCode}>
                    {c.cptCode} — {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-700 mb-1">
                ICD-10 (add with Enter)
              </label>
              <Input
                value={icd10Input}
                onChange={(e) => setIcd10Input(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addIcd10();
                  }
                }}
                placeholder="e.g. M54.5"
              />
              {icd10Codes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {icd10Codes.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-secondary-100 text-secondary-700">
                      {c}
                      <button
                        onClick={() => setIcd10Codes((prev) => prev.filter((x) => x !== c))}
                        className="hover:text-red-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button
                disabled={!payerId || !cptCode}
                onClick={() => setStep(3)}
                className="flex items-center gap-1.5"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : payerId && cptCode ? (
          <SummaryRow
            label={`${selectedPayer?.name} · CPT ${cptCode}`}
            subtitle={selectedCpt?.label}
            onClear={() => {
              setPayerId('');
              setCptCode('');
              setPolicy(null);
              setStep(2);
            }}
          />
        ) : null}
      </Card>

      {step >= 3 && (
        <Card className="p-5 space-y-3">
          <StepHeader n={3} label="Criteria gap check" active={step === 3} done={step > 3} />
          {selectedPayer?.adapterStatus && selectedPayer.adapterStatus !== 'implemented' && (
            <AlertBanner
              variant="warning"
              message={
                <div className="space-y-1">
                  <div className="font-medium flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4" />
                    Manual lookup required
                  </div>
                  <div>
                    {selectedPayer.adapterNotes ?? 'This payer does not have an automated adapter.'}
                  </div>
                  {selectedPayer.policyIndexUrl && (
                    <a
                      href={selectedPayer.policyIndexUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-yellow-900 underline"
                    >
                      Open {selectedPayer.name} policy index ↗
                    </a>
                  )}
                </div>
              }
            />
          )}
          {policyLoading ? (
            <LoadingSpinner />
          ) : policy ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <PolicyStatusBadge status={policy.status} />
                <FreshnessBadge
                  sourceFetchedAt={policy.sourceFetchedAt}
                  humanReviewedAt={policy.humanReviewedAt}
                />
                <a
                  href={policy.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary-600 hover:underline"
                >
                  View source ↗
                </a>
              </div>
              {policy.extractedCriteria ? (
                <CriteriaPreview policy={policy} />
              ) : (
                <div className="text-sm text-secondary-500 italic">
                  Criteria pending review — the coordinator will manually cross-check against the source.
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-secondary-500 italic">
              No stored policy for this payer + CPT. We'll create the PA without
              a gap-check baseline; the coordinator should consult the payer site.
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => setStep(4)} className="flex items-center gap-1.5">
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {step >= 4 && (
        <Card className="p-5 space-y-3">
          <StepHeader n={4} label="Create" active={step === 4} done={false} />
          <AlertBanner message={error} variant="error" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
            <Button onClick={handleCreate} disabled={submitting} className="flex items-center gap-1.5">
              {submitting ? <LoadingSpinner size="sm" /> : <CheckCircle2 className="h-4 w-4" />}
              Create PA
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};

const StepHeader: React.FC<{ n: number; label: string; active: boolean; done: boolean }> = ({ n, label, active, done }) => (
  <div className="flex items-center gap-2 text-sm font-semibold">
    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${done ? 'bg-green-600 text-white' : active ? 'bg-primary-600 text-white' : 'bg-secondary-200 text-secondary-600'}`}>
      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
    </div>
    <span className="text-secondary-900">{label}</span>
  </div>
);

const SummaryRow: React.FC<{ label: string; subtitle?: string | null; onClear: () => void }> = ({ label, subtitle, onClear }) => (
  <div className="flex items-start justify-between gap-2 p-2 bg-surface-elevated rounded-md">
    <div>
      <div className="text-sm font-medium text-secondary-900">{label}</div>
      {subtitle && <div className="text-xs text-secondary-500">{subtitle}</div>}
    </div>
    <button onClick={onClear} className="text-xs text-primary-600 hover:underline">
      Change
    </button>
  </div>
);

const CriteriaPreview: React.FC<{ policy: PayerPolicy }> = ({ policy }) => {
  const c = policy.extractedCriteria!;
  return (
    <div className="space-y-2 text-sm">
      {c.requiredDiagnoses?.length > 0 && (
        <Section title="Required diagnoses">
          {c.requiredDiagnoses.map((d, i) => (
            <div key={i} className="text-secondary-700">
              <code className="text-xs bg-secondary-100 px-1 py-0.5 rounded">{d.icd10}</code>
              {d.label ? ` — ${d.label}` : ''}
            </div>
          ))}
        </Section>
      )}
      {c.requiredPriorTrials?.length > 0 && (
        <Section title="Prior trials required">
          {c.requiredPriorTrials.map((t, i) => (
            <div key={i} className="text-secondary-700">• {t.description}</div>
          ))}
        </Section>
      )}
      {c.requiredDocumentation?.length > 0 && (
        <Section title="Documentation required">
          {c.requiredDocumentation.map((d, i) => (
            <div key={i} className="text-secondary-700">• {d.type}: {d.description}</div>
          ))}
        </Section>
      )}
      {c.exclusions?.length > 0 && (
        <Section title="Exclusions">
          {c.exclusions.map((e, i) => (
            <div key={i} className="text-secondary-700">• {e.description}</div>
          ))}
        </Section>
      )}
      {c.narrativeSummary && (
        <Section title="Summary">
          <p className="text-secondary-700 whitespace-pre-wrap">{c.narrativeSummary}</p>
        </Section>
      )}
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border-t border-secondary-100 pt-2">
    <div className="text-xs font-medium text-secondary-500 uppercase tracking-wide mb-1">{title}</div>
    <div className="space-y-0.5">{children}</div>
  </div>
);
