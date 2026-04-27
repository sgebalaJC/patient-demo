import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Rocket,
  Server,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { PageHeader } from '../components/ui/PageHeader';
import { AdminGuard } from '../components/ui/AdminGuard';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AlertBanner } from '../components/ui/AlertBanner';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import {
  installWizardOps,
  liveBrandingOps,
} from '../lib/firestore/install-wizard';
import {
  WIZARD_STEPS,
  WIZARD_FIELD_LIMITS,
  WIZARD_NUMERIC_LIMITS,
  type InstallWizardState,
  type WizardStepId,
} from '../types/install-wizard';
import { BRANDING } from '../config/branding';
import { FORK_CONFIG } from '../../../fork.config';
import { useAuth } from '../hooks/useAuth';

const STEP_LABELS: Record<WizardStepId, string> = {
  identity: 'Identity',
  contact: 'Contact + URLs',
  address: 'Address + Hours',
  practice: 'Practice model',
  branding: 'Logos + Colors',
  agents: 'AI agents',
  openclaw: 'OpenClaw bind',
  confirm: 'Confirm',
};

const AdminInstallWizardPageInner: React.FC = () => {
  const { user } = useAuth();
  const [state, setState] = useState<InstallWizardState>({});
  const [loading, setLoading] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [downloadUrl, setDownloadUrl] = useState<string>('');

  const currentStep = WIZARD_STEPS[stepIndex];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await installWizardOps.get();
      if (cancelled) return;
      const initial: InstallWizardState = r.success && r.data ? r.data : {};
      // Seed identity / contact from BRANDING so the operator only edits diffs.
      if (!initial.identity) {
        initial.identity = {
          appName: BRANDING.appName,
          practiceName: BRANDING.practiceName,
          shortName: BRANDING.shortName,
          legalEntity: BRANDING.legalEntity,
          smsSenderName: BRANDING.smsSenderName ?? BRANDING.shortName,
        };
      }
      if (!initial.contact) {
        initial.contact = {
          supportEmail: BRANDING.supportEmail,
          fromEmail: BRANDING.fromEmail,
          supportPhone: BRANDING.supportPhone ?? null,
          supportFax: BRANDING.fax ?? null,
          portalUrl: `https://${BRANDING.domain}`,
          domain: BRANDING.domain,
        };
      }
      setState(initial);
      // Resume from the last in-progress step rather than the start.
      if (initial.lastCompletedStep) {
        const idx = WIZARD_STEPS.indexOf(initial.lastCompletedStep as WizardStepId);
        if (idx >= 0 && idx < WIZARD_STEPS.length - 1) setStepIndex(idx + 1);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (patch: Partial<InstallWizardState>) => {
    setSaving(true);
    setError('');
    const next: InstallWizardState = { ...state, ...patch, lastCompletedStep: currentStep };
    setState(next);
    const r = await installWizardOps.save({ ...patch, lastCompletedStep: currentStep });
    setSaving(false);
    if (!r.success) {
      setError(r.error ?? 'Failed to save');
      return false;
    }
    return true;
  };

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));
  const goNext = async (patch: Partial<InstallWizardState>) => {
    const ok = await persist(patch);
    if (ok) setStepIndex((i) => Math.min(WIZARD_STEPS.length - 1, i + 1));
  };

  const handleDownloadForkConfig = () => {
    // The currently-authenticated super admin IS the operator running the
    // wizard (page is gated by AdminGuard superOnly). Their email is the
    // right value for FORK_CONFIG.superAdmin.email — falling back to the
    // build-time fork.config.ts value preserves the existing setting on
    // re-download. Never use supportEmail (a public mailbox).
    const superAdminEmail = user?.email ?? FORK_CONFIG.superAdmin.email;
    const ts = renderForkConfigTs(state, superAdminEmail);
    const blob = new Blob([ts], { type: 'text/typescript' });
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fork.config.ts';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleApplyBrandingLive = async () => {
    if (!state.branding) return;
    setSaving(true);
    const r = await liveBrandingOps.save(state.branding);
    setSaving(false);
    if (!r.success) setError(r.error ?? 'Failed to apply branding');
  };

  const handleOpenclawSync = async () => {
    setSaving(true);
    setError('');
    try {
      // The repo-wide pattern is to assert non-null at the callsite — `functions`
      // is initialised by firebase.ts before any user-driven call could fire.
      const fn = httpsCallable<unknown, { ok: boolean; output: string }>(functions!, 'installerSyncAgentWorkspace');
      const r = await fn();
      const data = r.data;
      if (!data.ok) {
        // Surface a one-line summary instead of dumping raw subprocess
        // stdout (which can include bucket names, error stack traces, and
        // unrelated noise). The full output is still in Cloud Logging for
        // operators who need it.
        const firstLine = (data.output ?? '').split('\n').find((l) => l.trim().length > 0) ?? 'Sync failed';
        setError(firstLine.slice(0, 240));
      } else {
        // state.openclaw may be undefined if the operator hits Sync from the
        // OpenclawStep before `persist({openclaw: ...})` has fired (the step
        // captures values into local React state and only persists on Next).
        // Match the OpenclawStep's seeded defaults so we don't silently
        // overwrite them with empty strings on the operator's eventual
        // Next click.
        const baseOpenclaw = state.openclaw ?? {
          vmName: 'openclaw',
          vmZone: 'us-central1-a',
          vmProject: '',
          vmInternalIp: '',
          vmExternalIp: '',
        };
        await persist({
          openclaw: { ...baseOpenclaw, lastPingAt: new Date().toISOString() },
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/admin/settings"
        icon={Rocket}
        title="Install wizard"
        subtitle="WordPress-style setup. Re-openable any time to edit."
        iconColor="bg-amber-100 text-amber-700"
      />

      <AlertBanner message={error || null} variant="error" />

      <Card className="p-4">
        <ol className="flex flex-wrap gap-2 mb-4 text-xs">
          {WIZARD_STEPS.map((id, i) => (
            <li
              key={id}
              className={`px-2 py-1 rounded ${
                i === stepIndex
                  ? 'bg-primary-600 text-white'
                  : i < stepIndex
                    ? 'bg-primary-100 text-primary-700'
                    : 'bg-secondary-100 text-secondary-600'
              }`}
            >
              {i + 1}. {STEP_LABELS[id]}
            </li>
          ))}
        </ol>

        {currentStep === 'identity' && (
          <IdentityStep state={state} onNext={(p) => goNext({ identity: p })} />
        )}
        {currentStep === 'contact' && (
          <ContactStep state={state} onBack={goBack} onNext={(p) => goNext({ contact: p })} />
        )}
        {currentStep === 'address' && (
          <AddressStep state={state} onBack={goBack} onNext={(p) => goNext({ address: p })} />
        )}
        {currentStep === 'practice' && (
          <PracticeStep state={state} onBack={goBack} onNext={(p) => goNext({ practice: p })} />
        )}
        {currentStep === 'branding' && (
          <BrandingStep
            state={state}
            onBack={goBack}
            onNext={(p) => goNext({ branding: p })}
            onApplyLive={handleApplyBrandingLive}
            saving={saving}
          />
        )}
        {currentStep === 'agents' && (
          <AgentsStep state={state} onBack={goBack} onNext={(p) => goNext({ agents: p })} />
        )}
        {currentStep === 'openclaw' && (
          <OpenclawStep
            state={state}
            onBack={goBack}
            onNext={(p) => goNext({ openclaw: p })}
            onSync={handleOpenclawSync}
            saving={saving}
          />
        )}
        {currentStep === 'confirm' && (
          <ConfirmStep
            state={state}
            onBack={goBack}
            onComplete={async () => {
              await persist({ installComplete: true });
            }}
            onDownload={handleDownloadForkConfig}
            saving={saving}
            downloadUrl={downloadUrl}
          />
        )}
      </Card>
    </div>
  );
};

// ─── Step components ─────────────────────────────────────────────────

interface StepProps<T> {
  state: InstallWizardState;
  onBack?: () => void;
  onNext: (data: T) => void | Promise<void>;
}

const NavRow: React.FC<{ onBack?: () => void; onNext: () => void; nextDisabled?: boolean; nextLabel?: string }> = ({
  onBack,
  onNext,
  nextDisabled,
  nextLabel = 'Next',
}) => (
  <div className="flex justify-between mt-4">
    {onBack ? (
      <Button variant="ghost" onClick={onBack}>
        <ChevronLeft className="h-4 w-4 mr-1" /> Back
      </Button>
    ) : (
      <span />
    )}
    <Button onClick={onNext} disabled={nextDisabled}>
      {nextLabel} <ChevronRight className="h-4 w-4 ml-1" />
    </Button>
  </div>
);

const IdentityStep: React.FC<StepProps<InstallWizardState['identity']>> = ({ state, onNext }) => {
  const [v, setV] = useState(state.identity ?? { appName: '', practiceName: '', shortName: '', legalEntity: '', smsSenderName: '' });
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Identity</h2>
      <Input label="App name" maxLength={WIZARD_FIELD_LIMITS.appName} value={v.appName} onChange={(e) => setV({ ...v, appName: e.target.value })} />
      <Input label="Practice name (legal/display)" maxLength={WIZARD_FIELD_LIMITS.practiceName} value={v.practiceName} onChange={(e) => setV({ ...v, practiceName: e.target.value })} />
      <Input label="Short name (SMS, email subjects)" maxLength={WIZARD_FIELD_LIMITS.shortName} value={v.shortName} onChange={(e) => setV({ ...v, shortName: e.target.value })} />
      <Input label="Legal entity" maxLength={WIZARD_FIELD_LIMITS.legalEntity} value={v.legalEntity} onChange={(e) => setV({ ...v, legalEntity: e.target.value })} />
      <Input label="SMS sender prefix" maxLength={WIZARD_FIELD_LIMITS.smsSenderName} value={v.smsSenderName} onChange={(e) => setV({ ...v, smsSenderName: e.target.value })} />
      <NavRow
        onNext={() => onNext(v)}
        nextDisabled={!v.appName.trim() || !v.practiceName.trim()}
      />
    </div>
  );
};

const ContactStep: React.FC<StepProps<InstallWizardState['contact']>> = ({ state, onBack, onNext }) => {
  const [v, setV] = useState(
    state.contact ?? { supportEmail: '', fromEmail: '', supportPhone: null, supportFax: null, portalUrl: '', domain: '' },
  );
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Contact + URLs</h2>
      <Input label="Support email" type="email" maxLength={WIZARD_FIELD_LIMITS.supportEmail} value={v.supportEmail} onChange={(e) => setV({ ...v, supportEmail: e.target.value })} />
      <Input label="From email (transactional)" type="email" maxLength={WIZARD_FIELD_LIMITS.fromEmail} value={v.fromEmail} onChange={(e) => setV({ ...v, fromEmail: e.target.value })} />
      <Input label="Support phone" maxLength={WIZARD_FIELD_LIMITS.phone} value={v.supportPhone ?? ''} onChange={(e) => setV({ ...v, supportPhone: e.target.value || null })} />
      <Input label="Support fax" maxLength={WIZARD_FIELD_LIMITS.fax} value={v.supportFax ?? ''} onChange={(e) => setV({ ...v, supportFax: e.target.value || null })} />
      <Input label="Portal URL" maxLength={WIZARD_FIELD_LIMITS.url} value={v.portalUrl} onChange={(e) => setV({ ...v, portalUrl: e.target.value })} />
      <Input label="Portal domain (no protocol)" maxLength={WIZARD_FIELD_LIMITS.domain} value={v.domain} onChange={(e) => setV({ ...v, domain: e.target.value })} />
      <NavRow onBack={onBack} onNext={() => onNext(v)} />
    </div>
  );
};

const AddressStep: React.FC<StepProps<InstallWizardState['address']>> = ({ state, onBack, onNext }) => {
  const [v, setV] = useState(
    state.address ?? {
      street: '',
      city: '',
      state: '',
      zip: '',
      full: '',
      mapsQuery: '',
      hours: [
        { day: 'Monday – Friday', time: '9:00 AM – 5:00 PM' },
        { day: 'Saturday – Sunday', time: 'Closed' },
      ],
    },
  );
  // Auto-derive `full` and `mapsQuery` from parts.
  useEffect(() => {
    const full = `${v.street}, ${v.city}, ${v.state} ${v.zip}`.trim();
    const mapsQuery = `${v.street} ${v.city} ${v.state} ${v.zip}`.replace(/\s+/g, '+');
    if (full !== v.full || mapsQuery !== v.mapsQuery) setV((p) => ({ ...p, full, mapsQuery }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.street, v.city, v.state, v.zip]);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Address + Hours</h2>
      <Input label="Street" maxLength={WIZARD_FIELD_LIMITS.street} value={v.street} onChange={(e) => setV({ ...v, street: e.target.value })} />
      <div className="grid grid-cols-3 gap-2">
        <Input label="City" maxLength={WIZARD_FIELD_LIMITS.city} value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />
        <Input label="State" maxLength={WIZARD_FIELD_LIMITS.state} value={v.state} onChange={(e) => setV({ ...v, state: e.target.value })} />
        <Input label="ZIP" maxLength={WIZARD_FIELD_LIMITS.zip} value={v.zip} onChange={(e) => setV({ ...v, zip: e.target.value })} />
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Hours</div>
        {v.hours.map((h, i) => (
          <div key={i} className="grid grid-cols-2 gap-2">
            <Input
              maxLength={WIZARD_FIELD_LIMITS.hoursDay}
              value={h.day}
              onChange={(e) => {
                const next = [...v.hours];
                next[i] = { ...next[i], day: e.target.value };
                setV({ ...v, hours: next });
              }}
            />
            <Input
              maxLength={WIZARD_FIELD_LIMITS.hoursTime}
              value={h.time}
              onChange={(e) => {
                const next = [...v.hours];
                next[i] = { ...next[i], time: e.target.value };
                setV({ ...v, hours: next });
              }}
            />
          </div>
        ))}
        <Button
          variant="ghost"
          onClick={() => setV({ ...v, hours: [...v.hours, { day: '', time: '' }] })}
        >
          + Add row
        </Button>
      </div>
      <NavRow onBack={onBack} onNext={() => onNext(v)} />
    </div>
  );
};

const PracticeStep: React.FC<StepProps<InstallWizardState['practice']>> = ({ state, onBack, onNext }) => {
  const [v, setV] = useState(state.practice ?? { practiceType: 'standard' as const, defaultAppointmentDuration: 30 });
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Practice model</h2>
      <div className="space-y-2">
        <label className="text-sm font-medium">Type</label>
        <div className="flex gap-3">
          {(['standard', 'concierge'] as const).map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input
                type="radio"
                checked={v.practiceType === t}
                onChange={() => setV({ ...v, practiceType: t })}
              />
              {t}
            </label>
          ))}
        </div>
      </div>
      <Input
        label="Default appointment duration (minutes)"
        type="number"
        min={WIZARD_NUMERIC_LIMITS.appointmentDurationMin}
        max={WIZARD_NUMERIC_LIMITS.appointmentDurationMax}
        value={String(v.defaultAppointmentDuration)}
        onChange={(e) => {
          const raw = Number(e.target.value);
          const clamped = Number.isFinite(raw)
            ? Math.max(
                WIZARD_NUMERIC_LIMITS.appointmentDurationMin,
                Math.min(WIZARD_NUMERIC_LIMITS.appointmentDurationMax, Math.floor(raw)),
              )
            : 30;
          setV({ ...v, defaultAppointmentDuration: clamped });
        }}
      />
      <NavRow onBack={onBack} onNext={() => onNext(v)} />
    </div>
  );
};

const BrandingStep: React.FC<StepProps<InstallWizardState['branding']> & { onApplyLive: () => void; saving: boolean }> = ({
  state,
  onBack,
  onNext,
  onApplyLive,
  saving,
}) => {
  const [v, setV] = useState(
    state.branding ?? {
      colors: { primary: '#2563eb', secondary: '#475569', accent: '#0ea5e9' },
      logos: { full: '/branding/logo.png', fullDark: '/branding/logo.png', icon: '/branding/logo.png', alt: '' },
    },
  );
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Logos + Colors</h2>
      <div className="grid grid-cols-3 gap-2">
        <Input label="Primary" type="color" value={v.colors.primary} onChange={(e) => setV({ ...v, colors: { ...v.colors, primary: e.target.value } })} />
        <Input label="Secondary" type="color" value={v.colors.secondary} onChange={(e) => setV({ ...v, colors: { ...v.colors, secondary: e.target.value } })} />
        <Input label="Accent" type="color" value={v.colors.accent} onChange={(e) => setV({ ...v, colors: { ...v.colors, accent: e.target.value } })} />
      </div>
      <Input label="Logo path (light)" maxLength={WIZARD_FIELD_LIMITS.logoPath} value={v.logos.full} onChange={(e) => setV({ ...v, logos: { ...v.logos, full: e.target.value } })} />
      <Input label="Logo path (dark)" maxLength={WIZARD_FIELD_LIMITS.logoPath} value={v.logos.fullDark} onChange={(e) => setV({ ...v, logos: { ...v.logos, fullDark: e.target.value } })} />
      <Input label="Icon path" maxLength={WIZARD_FIELD_LIMITS.logoPath} value={v.logos.icon} onChange={(e) => setV({ ...v, logos: { ...v.logos, icon: e.target.value } })} />
      <Input label="Alt text" maxLength={WIZARD_FIELD_LIMITS.logoAlt} value={v.logos.alt} onChange={(e) => setV({ ...v, logos: { ...v.logos, alt: e.target.value } })} />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onApplyLive} disabled={saving}>
          Apply colors live (system/branding)
        </Button>
      </div>
      <p className="text-xs text-secondary-500">
        Heads-up: "Apply colors live" writes to <code>system/branding</code>, which is a
        runtime <em>override</em>. After you commit the regenerated <code>fork.config.ts</code>
        and redeploy, this override still wins at runtime — clear it via the admin
        Settings page (or delete the doc) when you want the deployed config to take effect.
      </p>
      <NavRow onBack={onBack} onNext={() => onNext(v)} />
    </div>
  );
};

const AgentsStep: React.FC<StepProps<InstallWizardState['agents']>> = ({ state, onBack, onNext }) => {
  const [v, setV] = useState(
    state.agents ?? {
      admin: { name: 'Sunny', tagline: 'Practice management assistant', pronouns: 'they/them' },
      patient: { name: 'Aurelia', tagline: 'Here to help with your questions', pronouns: 'they/them' },
    },
  );
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">AI agents</h2>
      <div className="space-y-2">
        <div className="font-medium text-sm">Admin agent</div>
        <Input label="Name" maxLength={WIZARD_FIELD_LIMITS.agentName} value={v.admin.name} onChange={(e) => setV({ ...v, admin: { ...v.admin, name: e.target.value } })} />
        <Input label="Tagline" maxLength={WIZARD_FIELD_LIMITS.agentTagline} value={v.admin.tagline} onChange={(e) => setV({ ...v, admin: { ...v.admin, tagline: e.target.value } })} />
        <Input label="Pronouns" maxLength={WIZARD_FIELD_LIMITS.agentPronouns} value={v.admin.pronouns} onChange={(e) => setV({ ...v, admin: { ...v.admin, pronouns: e.target.value } })} />
      </div>
      <div className="space-y-2">
        <div className="font-medium text-sm">Patient agent</div>
        <Input label="Name" maxLength={WIZARD_FIELD_LIMITS.agentName} value={v.patient.name} onChange={(e) => setV({ ...v, patient: { ...v.patient, name: e.target.value } })} />
        <Input label="Tagline" maxLength={WIZARD_FIELD_LIMITS.agentTagline} value={v.patient.tagline} onChange={(e) => setV({ ...v, patient: { ...v.patient, tagline: e.target.value } })} />
        <Input label="Pronouns" maxLength={WIZARD_FIELD_LIMITS.agentPronouns} value={v.patient.pronouns} onChange={(e) => setV({ ...v, patient: { ...v.patient, pronouns: e.target.value } })} />
      </div>
      <NavRow onBack={onBack} onNext={() => onNext(v)} />
    </div>
  );
};

const OpenclawStep: React.FC<
  StepProps<InstallWizardState['openclaw']> & { onSync: () => void; saving: boolean }
> = ({ state, onBack, onNext, onSync, saving }) => {
  const [v, setV] = useState(
    state.openclaw ?? { vmName: 'openclaw', vmZone: 'us-central1-a', vmProject: '', vmInternalIp: '', vmExternalIp: '' },
  );
  const lastPing = state.openclaw?.lastPingAt;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Server className="h-5 w-5" /> OpenClaw bind
      </h2>
      <p className="text-sm text-secondary-600">
        Paste the values printed by the CLI installer (step 09). The "Sync" button calls the
        <code className="mx-1">installerSyncAgentWorkspace</code> Cloud Function which renders the
        agent workspace, uploads to GCS, and signals the gateway.
      </p>
      <Input label="VM name" maxLength={WIZARD_FIELD_LIMITS.vmName} value={v.vmName} onChange={(e) => setV({ ...v, vmName: e.target.value })} />
      <Input label="VM zone" maxLength={WIZARD_FIELD_LIMITS.vmZone} value={v.vmZone} onChange={(e) => setV({ ...v, vmZone: e.target.value })} />
      <Input label="VM project" maxLength={WIZARD_FIELD_LIMITS.vmProject} value={v.vmProject} onChange={(e) => setV({ ...v, vmProject: e.target.value })} />
      <Input label="Internal IP" maxLength={WIZARD_FIELD_LIMITS.ip} value={v.vmInternalIp} onChange={(e) => setV({ ...v, vmInternalIp: e.target.value })} />
      <Input label="External IP" maxLength={WIZARD_FIELD_LIMITS.ip} value={v.vmExternalIp} onChange={(e) => setV({ ...v, vmExternalIp: e.target.value })} />
      <div className="flex items-center gap-2">
        <Button onClick={onSync} disabled={saving}>
          <Server className="h-4 w-4 mr-1" /> Sync agent workspace + ping gateway
        </Button>
        {lastPing && (
          <span className="text-xs text-green-700 flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4" /> Last sync: {new Date(lastPing).toLocaleString()}
          </span>
        )}
      </div>
      <NavRow onBack={onBack} onNext={() => onNext(v)} />
    </div>
  );
};

const ConfirmStep: React.FC<{
  state: InstallWizardState;
  onBack: () => void;
  onComplete: () => Promise<void>;
  onDownload: () => void;
  saving: boolean;
  downloadUrl: string;
}> = ({ state, onBack, onComplete, onDownload, saving, downloadUrl }) => {
  const summary = useMemo(
    () => ({
      identity: state.identity,
      contact: state.contact,
      address: state.address,
      practice: state.practice,
      branding: state.branding,
      agents: state.agents,
      openclaw: state.openclaw,
    }),
    [state],
  );
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Confirm</h2>
      <p className="text-sm text-secondary-600">
        Review below. "Mark complete" sets <code>installComplete: true</code> and is reversible — you
        can re-open this wizard at any time. Use "Download fork.config.ts" to get the regenerated
        file; commit it to git so the next deploy bakes the new branding into the bundle.
      </p>
      <p className="text-xs text-amber-700">
        ⚠ Mobile app: <code>mobile/lib/config/branding.dart</code> is a manual mirror of
        <code>fork.config.ts</code> (Flutter cannot import TS). Hand-edit it to match the values
        in the downloaded <code>fork.config.ts</code> before building the mobile binary.
      </p>
      <pre className="bg-secondary-50 p-3 text-xs overflow-auto rounded max-h-80">
        {JSON.stringify(summary, null, 2)}
      </pre>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onDownload}>
          <Download className="h-4 w-4 mr-1" /> Download fork.config.ts
        </Button>
        <Button onClick={onComplete} disabled={saving}>
          <CheckCircle2 className="h-4 w-4 mr-1" /> Mark install complete
        </Button>
      </div>
      {downloadUrl && (
        <p className="text-xs text-secondary-500">
          File downloaded — overwrite <code>/fork.config.ts</code> in your repo and commit.
        </p>
      )}
      <NavRow onBack={onBack} onNext={() => undefined} nextDisabled />
    </div>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────

// Allowlist of practiceType values. Anything not on this list serializes
// as the safe default to prevent the wizard's `practiceType` field from
// landing arbitrary user input in the emitted TS literal.
const VALID_PRACTICE_TYPES = ['concierge', 'standard'] as const;
type PracticeType = (typeof VALID_PRACTICE_TYPES)[number];

/**
 * Render the wizard state as a fork.config.ts blob the operator commits.
 *
 * Every interpolated value goes through one of:
 *   - `j(...)` (JSON.stringify) — safe for arbitrary strings, neutralizes
 *     quotes / backslashes / newlines so a malicious "practice name" can't
 *     break out of the string literal and inject TS code into the file.
 *   - `Number(...)` then `j(...)` — for numeric fields, ensures the emitted
 *     value is a number literal (no fall-through to raw input concatenation).
 *   - A fixed allowlist coercion (practiceType) — for enums.
 *
 * Never interpolate a string from `state.*` directly without `j()`.
 */
function renderForkConfigTs(s: InstallWizardState, superAdminEmail: string): string {
  const j = (v: unknown) => JSON.stringify(v);
  const i = s.identity ?? { appName: '', practiceName: '', shortName: '', legalEntity: '', smsSenderName: '' };
  const c = s.contact ?? { supportEmail: '', fromEmail: '', supportPhone: null, supportFax: null, portalUrl: '', domain: '' };
  const a = s.address ?? { street: '', city: '', state: '', zip: '', full: '', mapsQuery: '', hours: [] };
  const p = s.practice ?? { practiceType: 'standard' as const, defaultAppointmentDuration: 30 };
  const b = s.branding ?? {
    colors: { primary: '#2563eb', secondary: '#475569', accent: '#0ea5e9' },
    logos: { full: '/branding/logo.png', fullDark: '/branding/logo.png', icon: '/branding/logo.png', alt: i.appName },
  };
  const ag = s.agents ?? {
    admin: { name: 'Sunny', tagline: '', pronouns: 'they/them' },
    patient: { name: 'Aurelia', tagline: '', pronouns: 'they/them' },
  };
  const duration = (() => {
    const n = Number(p.defaultAppointmentDuration);
    const min = WIZARD_NUMERIC_LIMITS.appointmentDurationMin;
    const max = WIZARD_NUMERIC_LIMITS.appointmentDurationMax;
    return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : 30;
  })();
  const practiceType: PracticeType = (VALID_PRACTICE_TYPES as readonly string[]).includes(p.practiceType)
    ? (p.practiceType as PracticeType)
    : 'standard';
  return `// Generated from /admin/install. Overwrite /fork.config.ts in the repo.
import type { ForkConfig } from './fork.config';

export const FORK_CONFIG: ForkConfig = {
  identity: {
    appName: ${j(i.appName)},
    practiceName: ${j(i.practiceName)},
    shortName: ${j(i.shortName)},
    legalEntity: ${j(i.legalEntity)},
    smsSenderName: ${j(i.smsSenderName)},
  },
  contact: {
    supportEmail: ${j(c.supportEmail)},
    fromEmail: ${j(c.fromEmail)},
    supportPhone: ${j(c.supportPhone)},
    fax: ${j(c.supportFax)},
  },
  urls: {
    portalUrl: ${j(c.portalUrl)},
    domain: ${j(c.domain)},
    additionalOrigins: [${j(c.portalUrl)}],
  },
  address: {
    street: ${j(a.street)},
    city: ${j(a.city)},
    state: ${j(a.state)},
    zip: ${j(a.zip)},
    full: ${j(a.full)},
    mapsQuery: ${j(a.mapsQuery)},
  },
  hours: ${j(a.hours)},
  defaultAppointmentDuration: ${j(duration)},
  practiceType: ${j(practiceType)},
  logos: ${j(b.logos)},
  colors: ${j(b.colors)},
  agents: ${j(ag)},
  platformVendor: { name: 'Patient Portal Inc.', supportEmail: 'billing@patientportal.example', billingDescriptor: 'PATIENT PORTAL' },
  superAdmin: { email: ${j(superAdminEmail)} },
  limits: { maxFieldChars: 250 },
  isDemo: false,
};
`;
}

export const AdminInstallWizardPage: React.FC = () => (
  <AdminGuard superOnly>
    <AdminInstallWizardPageInner />
  </AdminGuard>
);
