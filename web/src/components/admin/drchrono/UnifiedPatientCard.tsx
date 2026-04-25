import React, { useEffect, useState } from 'react';
import {
  ExternalLink,
  Loader2,
  Mail,
  Phone,
  MapPin,
  Shield,
  AlertCircle,
  Activity,
  CalendarClock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card } from '../../ui/Card';
import {
  sidecar,
  type UnifiedDrChronoPatient,
  type DrChronoPatientDetails,
} from '../../../lib/sidecar';
import { drchronoChartUrl, getDrChronoStatus } from '../../../lib/drchrono';
import {
  getCachedPatientDetails,
  setCachedPatientDetails,
} from '../../../lib/drchronoSessionCache';
import { formatPhoneDisplay } from '../../../lib/phone';
import logger from '../../../lib/logger';

interface Props {
  patient: UnifiedDrChronoPatient;
  /** When `embedded`, renders without its own outer Card (e.g. inside a batch row). */
  embedded?: boolean;
  /** When true, extras are fetched immediately. Otherwise user must click "Load clinical details". */
  autoLoadExtras?: boolean;
}

// Practice-subdomain chart URLs — `app.drchrono.com/patient/chart/<id>/`
// 404s for many practice accounts, so we let the admin configure the
// practice subdomain in integrations/drchrono.
let _subdomainCache: string | undefined;
function chartUrl(id: number): string {
  return drchronoChartUrl(id, _subdomainCache);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtPhone(raw: string | null): string | null {
  if (!raw) return null;
  return formatPhoneDisplay(raw) || raw;
}

function statusLabel(s: string | null): { label: string; tone: 'green' | 'amber' | 'red' | 'gray' } {
  switch (s) {
    case 'A': return { label: 'Active', tone: 'green' };
    case 'I': return { label: 'Inactive', tone: 'amber' };
    case 'D': return { label: 'Deceased', tone: 'red' };
    case 'P': return { label: 'Prospective', tone: 'gray' };
    default: return { label: s || 'Unknown', tone: 'gray' };
  }
}

export const UnifiedPatientCard: React.FC<Props> = ({
  patient,
  embedded = false,
  autoLoadExtras = false,
}) => {
  const [details, setDetails] = useState<DrChronoPatientDetails | null>(() =>
    getCachedPatientDetails(patient.drchronoId),
  );
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [showClinical, setShowClinical] = useState(autoLoadExtras);

  const loadDetails = async () => {
    if (details || detailsLoading) return;
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const d = await sidecar.getDrChronoPatientDetails(patient.drchronoId);
      setCachedPatientDetails(patient.drchronoId, d);
      setDetails(d);
    } catch (err: any) {
      logger.error('Patient details fetch failed:', err);
      setDetailsError(err?.message || 'Failed to load clinical details');
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    if (autoLoadExtras) void loadDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoadExtras, patient.drchronoId]);

  // Populate the chart-URL subdomain cache from integrations/drchrono the
  // first time any card renders. Cheap, idempotent, and keeps chartUrl()
  // synchronous so the href works without suspending.
  useEffect(() => {
    if (_subdomainCache !== undefined) return;
    getDrChronoStatus().then((i) => {
      _subdomainCache = i?.practiceSubdomain ?? '';
    }).catch(() => {
      _subdomainCache = '';
    });
  }, []);

  const status = statusLabel(patient.patientStatus);
  const statusClass = {
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    gray: 'bg-secondary-100 text-secondary-700',
  }[status.tone];

  const body = (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-secondary-900 flex items-center gap-2 flex-wrap">
            {patient.firstName} {patient.middleName ? `${patient.middleName} ` : ''}{patient.lastName}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass}`}>
              {status.label}
            </span>
          </h3>
          <p className="text-xs text-secondary-500 mt-0.5">
            DOB {fmtDate(patient.dateOfBirth)} · {patient.gender || 'gender unknown'} · DrChrono #{patient.drchronoId}
          </p>
        </div>
        <a
          href={chartUrl(patient.drchronoId)}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-primary-600 text-primary-700 hover:bg-primary-50 inline-flex items-center gap-1"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open chart
        </a>
      </div>

      {/* Contact */}
      <section>
        <h4 className="text-xs font-semibold text-secondary-500 uppercase tracking-wide mb-2">Contact</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 text-sm">
          <Field icon={Mail} label="Email" value={patient.email} mono />
          <Field icon={Phone} label="Cell" value={fmtPhone(patient.cellPhone)} mono />
          <Field icon={Phone} label="Home" value={fmtPhone(patient.homePhone)} mono />
          <Field icon={Phone} label="Office" value={fmtPhone(patient.officePhone)} mono />
          <div className="sm:col-span-2">
            <Field
              icon={MapPin}
              label="Address"
              value={[patient.address, patient.city, patient.state, patient.zip]
                .filter(Boolean)
                .join(', ') || null}
            />
          </div>
        </div>
      </section>

      {/* Insurance */}
      {(patient.insurance.carrier || patient.insurance.policyNumber) && (
        <section>
          <h4 className="text-xs font-semibold text-secondary-500 uppercase tracking-wide mb-2">Insurance</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 text-sm">
            <Field icon={Shield} label="Carrier" value={patient.insurance.carrier} />
            <Field icon={Shield} label="Plan" value={patient.insurance.planName} />
            <Field icon={Shield} label="Policy #" value={patient.insurance.policyNumber} mono />
            <Field icon={Shield} label="Group #" value={patient.insurance.groupNumber} mono />
          </div>
        </section>
      )}

      {/* Clinical snapshot — lazy */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-secondary-500 uppercase tracking-wide">
            Clinical Snapshot
          </h4>
          <button
            type="button"
            onClick={() => {
              setShowClinical(v => !v);
              if (!details) void loadDetails();
            }}
            className="text-xs text-primary-700 hover:text-primary-800 inline-flex items-center gap-1"
          >
            {showClinical ? <><ChevronUp className="h-3.5 w-3.5" /> Hide</> : <><ChevronDown className="h-3.5 w-3.5" /> Show</>}
          </button>
        </div>

        {showClinical && (
          <>
            {detailsLoading && (
              <p className="text-xs text-secondary-500 inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading allergies, problems, appointments…
              </p>
            )}
            {detailsError && !detailsLoading && (
              <p className="text-xs text-red-600 inline-flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                {detailsError}
                <button onClick={loadDetails} className="underline ml-1">Retry</button>
              </p>
            )}
            {details && !detailsLoading && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <ClinicalList
                  icon={AlertCircle}
                  title="Allergies"
                  emptyLabel="No allergies on file"
                  items={details.allergies.map(a => ({
                    primary: a.name,
                    secondary: [a.reaction, a.status].filter(Boolean).join(' · ') || null,
                  }))}
                />
                <ClinicalList
                  icon={Activity}
                  title="Problems"
                  emptyLabel="No problems on file"
                  items={details.problems.map(p => ({
                    primary: p.name,
                    secondary: [p.status, p.dateDiagnosed && `since ${fmtDate(p.dateDiagnosed)}`]
                      .filter(Boolean)
                      .join(' · ') || null,
                  }))}
                />
                <ClinicalList
                  icon={CalendarClock}
                  title="Recent appointments"
                  emptyLabel="No appointments"
                  items={details.appointments.map(ap => ({
                    primary: fmtDateTime(ap.date),
                    secondary: [ap.reason, ap.status, ap.notesLocked ? 'note signed' : null]
                      .filter(Boolean)
                      .join(' · ') || null,
                  }))}
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );

  if (embedded) return body;
  return <Card className="p-5">{body}</Card>;
};

const Field: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string | null;
  mono?: boolean;
}> = ({ icon: Icon, label, value, mono }) => (
  <div className="flex items-start gap-2">
    <Icon className="h-3.5 w-3.5 mt-0.5 text-secondary-400 shrink-0" />
    <div className="min-w-0">
      <p className="text-xs text-secondary-500">{label}</p>
      <p className={`text-sm text-secondary-900 truncate ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-secondary-400 font-sans">—</span>}
      </p>
    </div>
  </div>
);

const ClinicalList: React.FC<{
  icon: React.ElementType;
  title: string;
  emptyLabel: string;
  items: { primary: string; secondary: string | null }[];
}> = ({ icon: Icon, title, emptyLabel, items }) => (
  <div>
    <p className="text-xs font-medium text-secondary-700 mb-1.5 inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" />
      {title}
      <span className="text-secondary-400 font-normal">({items.length})</span>
    </p>
    {items.length === 0 ? (
      <p className="text-xs text-secondary-400">{emptyLabel}</p>
    ) : (
      <ul className="space-y-1">
        {items.slice(0, 10).map((it, i) => (
          <li key={i} className="text-xs">
            <span className="text-secondary-900">{it.primary}</span>
            {it.secondary && <span className="text-secondary-500"> — {it.secondary}</span>}
          </li>
        ))}
        {items.length > 10 && (
          <li className="text-xs text-secondary-400">… and {items.length - 10} more</li>
        )}
      </ul>
    )}
  </div>
);

