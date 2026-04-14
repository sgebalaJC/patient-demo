import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { FileText, Upload, Copy, Trash2, ArrowLeft, Loader2, Users, CheckCircle2, XCircle, AlertTriangle, Mail, Ban } from 'lucide-react';
import { db } from '../lib/firebase';
import {
  parseUpload,
  startLookup,
  subscribeJob,
  subscribeRows,
  deleteLookup,
  looksLikeEntity,
  displayName,
  type LookupJob,
  type LookupRow,
  type ParsedUploadRow,
  type RowStatus,
} from '../lib/drchronoLookup';

export const AdminDrChronoCsvPage: React.FC = () => {
  const { jobId } = useParams();
  return jobId ? <JobView jobId={jobId} /> : <UploadAndList />;
};

// ─── List + Upload ─────────────────────────────────────────────────

const UploadAndList: React.FC = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedUploadRow[] | null>(null);
  const [parseError, setParseError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [recentJobs, setRecentJobs] = useState<LookupJob[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'drchrono-lookups'), orderBy('createdAt', 'desc'), limit(20));
    return onSnapshot(q, (snap) => {
      setRecentJobs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LookupJob, 'id'>) })));
    });
  }, []);

  const { persons, entities } = useMemo(() => {
    if (!parsed) return { persons: [] as ParsedUploadRow[], entities: [] as ParsedUploadRow[] };
    const persons: ParsedUploadRow[] = [];
    const entities: ParsedUploadRow[] = [];
    for (const r of parsed) {
      if (looksLikeEntity(r)) entities.push(r);
      else persons.push(r);
    }
    return { persons, entities };
  }, [parsed]);

  async function handleFile(f: File) {
    setFile(f);
    setParseError('');
    setParsed(null);
    try {
      const text = await f.text();
      const rows = parseUpload(f.name, text);
      if (rows.length === 0) throw new Error('No rows found in file');
      setParsed(rows);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
    }
  }

  async function handleStart() {
    if (!parsed || !file) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const { jobId } = await startLookup(parsed, file.name);
      navigate(`/admin/drchrono-csv/${jobId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start lookup');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-secondary-900">DrChrono CSV</h1>
        <p className="text-sm text-secondary-500 mt-1">
          Upload a list of names — we'll look up each in DrChrono and return their email addresses for you to copy into Gmail.
          Requires the DrChrono integration to be <span className="font-medium">enabled</span> in Admin → AI Agent → Integrations.
        </p>
      </header>

      {/* Upload card */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-secondary-900 mb-3 flex items-center gap-2">
          <Upload className="h-4 w-4" /> Upload names
        </h2>
        <label className="block">
          <span className="sr-only">Upload file</span>
          <input
            type="file"
            accept=".json,.csv,text/csv,application/json"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="block w-full text-sm text-secondary-700 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-secondary-200 file:bg-white file:text-sm file:font-medium file:text-secondary-700 hover:file:bg-secondary-50"
          />
        </label>
        <p className="mt-2 text-xs text-secondary-500">
          Accepts JSON (array of objects) or CSV. Recognized fields: <code>first_name</code>, <code>last_name</code>, <code>name</code>, <code>lf_name</code> (<code>"Last, First"</code>),
          <code>usef_no</code>, <code>is_private</code>. Entities (LLC, INC, FARM, etc.) are filtered automatically.
        </p>

        {parseError && (
          <p className="mt-3 text-xs text-red-600">{parseError}</p>
        )}

        {parsed && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5 text-secondary-700">
                <Users className="h-3.5 w-3.5" /> {persons.length} persons
              </span>
              <span className="inline-flex items-center gap-1.5 text-secondary-500">
                <Ban className="h-3.5 w-3.5" /> {entities.length} entities filtered
              </span>
              <span className="inline-flex items-center gap-1.5 text-secondary-500">
                <FileText className="h-3.5 w-3.5" /> {parsed.length} total rows
              </span>
            </div>

            <div className="border border-secondary-200 rounded-md max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary-50 text-secondary-600">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium">Name</th>
                    <th className="text-left px-3 py-1.5 font-medium">Parsed as</th>
                    <th className="text-left px-3 py-1.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-100">
                  {parsed.slice(0, 50).map((r, i) => {
                    const isEntity = looksLikeEntity(r);
                    return (
                      <tr key={i} className={isEntity ? 'opacity-50' : ''}>
                        <td className="px-3 py-1.5 text-secondary-900">{displayName(r)}</td>
                        <td className="px-3 py-1.5 text-secondary-500">
                          {r.firstName || r.lastName
                            ? `${r.firstName || ''} / ${r.lastName || ''}`
                            : <span className="italic">name-only</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {isEntity && <span className="text-secondary-400">entity — skipped</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {parsed.length > 50 && (
                <p className="px-3 py-1.5 text-xs text-secondary-400 border-t border-secondary-100">
                  … and {parsed.length - 50} more
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleStart}
                disabled={submitting || persons.length === 0}
                className="text-sm px-4 py-2 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Start lookup ({persons.length})
              </button>
              <button
                onClick={() => { setFile(null); setParsed(null); setParseError(''); }}
                className="text-sm px-3 py-2 rounded-md border border-secondary-200 text-secondary-700 hover:bg-secondary-50"
              >
                Clear
              </button>
            </div>
            {submitError && <p className="text-xs text-red-600">{submitError}</p>}
            {persons.length > 500 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Large job — DrChrono rate-limits ~60/min, so this may take {Math.ceil(persons.length / 50)} minutes to complete.
                You can close this page; progress is stored server-side.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Recent jobs */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-secondary-900 mb-3">Recent jobs</h2>
        {recentJobs.length === 0 ? (
          <p className="text-xs text-secondary-500">No jobs yet.</p>
        ) : (
          <div className="space-y-2">
            {recentJobs.map((job) => (
              <Link
                key={job.id}
                to={`/admin/drchrono-csv/${job.id}`}
                className="block p-3 rounded-md border border-secondary-200 hover:border-primary-300 hover:bg-primary-50/30 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-secondary-900 truncate">{job.sourceFilename}</p>
                    <p className="text-xs text-secondary-500 mt-0.5">
                      {job.totalRows} rows · {job.matchedRows} matched · {job.noMatchRows} no-match · {job.skippedRows} multi · {job.noEmailRows} no-email
                    </p>
                  </div>
                  <JobStatusChip job={job} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Job detail view ────────────────────────────────────────────────

const JobView: React.FC<{ jobId: string }> = ({ jobId }) => {
  const navigate = useNavigate();
  const [job, setJob] = useState<LookupJob | null>(null);
  const [rows, setRows] = useState<LookupRow[]>([]);
  const [filter, setFilter] = useState<RowStatus | 'all'>('all');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => subscribeJob(jobId, setJob), [jobId]);
  useEffect(() => subscribeRows(jobId, setRows), [jobId]);

  const matched = useMemo(() => rows.filter((r) => r.status === 'matched' && r.email), [rows]);
  const filtered = useMemo(() => filter === 'all' ? rows : rows.filter((r) => r.status === filter), [rows, filter]);

  function copyEmails() {
    if (matched.length === 0) return;
    const emails = matched.map((r) => r.email).filter(Boolean).join(', ');
    navigator.clipboard.writeText(emails);
    setCopyFeedback(`Copied ${matched.length} emails`);
    setTimeout(() => setCopyFeedback(''), 2000);
  }

  async function handleDelete() {
    if (!window.confirm('Delete this job? Results will be lost.')) return;
    setDeleting(true);
    try {
      await deleteLookup(jobId);
      navigate('/admin/drchrono-csv');
    } catch {
      setDeleting(false);
    }
  }

  if (!job) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Loader2 className="h-5 w-5 animate-spin text-secondary-400" />
      </div>
    );
  }

  const pct = job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/admin/drchrono-csv" className="text-xs text-secondary-500 hover:text-secondary-900 inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
      </div>

      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-secondary-900 truncate">{job.sourceFilename}</h1>
            <p className="text-xs text-secondary-500 mt-0.5">
              by {job.createdByName} · {job.totalRows} person rows ({job.entitySkippedRows} entities filtered on upload)
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <JobStatusChip job={job} />
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs px-2 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1"
              title="Delete job"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="h-1.5 bg-secondary-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-xs text-secondary-500">
            <span>{job.processedRows} / {job.totalRows} processed ({pct}%)</span>
            {job.status === 'paused' && <span>Paused — will resume automatically</span>}
          </div>
        </div>

        {/* Counters */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2">
          <StatPill icon={CheckCircle2} label="Matched" value={job.matchedRows} tone="green" onClick={() => setFilter('matched')} active={filter === 'matched'} />
          <StatPill icon={XCircle} label="No match" value={job.noMatchRows} tone="gray" onClick={() => setFilter('no-match')} active={filter === 'no-match'} />
          <StatPill icon={AlertTriangle} label="Multi-match" value={job.skippedRows} tone="amber" onClick={() => setFilter('skipped-multi')} active={filter === 'skipped-multi'} />
          <StatPill icon={Mail} label="No email" value={job.noEmailRows} tone="gray" onClick={() => setFilter('no-email')} active={filter === 'no-email'} />
          <StatPill icon={AlertTriangle} label="Errors" value={job.errorRows} tone="red" onClick={() => setFilter('error')} active={filter === 'error'} />
        </div>

        {/* Copy emails */}
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={copyEmails}
            disabled={matched.length === 0}
            className="text-sm px-4 py-2 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Copy className="h-4 w-4" />
            Copy {matched.length} emails
          </button>
          {copyFeedback && <span className="text-xs text-green-600">{copyFeedback}</span>}
          {filter !== 'all' && (
            <button
              onClick={() => setFilter('all')}
              className="text-xs px-3 py-1.5 rounded-md border border-secondary-200 text-secondary-700 hover:bg-secondary-50"
            >
              Show all
            </button>
          )}
        </div>
        {job.error && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{job.error}</p>
        )}
      </div>

      {/* Rows table */}
      <div className="card overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-secondary-50 text-secondary-600">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Email</th>
              <th className="text-left px-3 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {filtered.slice(0, 500).map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-1.5 text-secondary-900">
                  {r.firstName} {r.lastName}
                  {r.usefNo && <span className="ml-2 text-secondary-400">#{r.usefNo}</span>}
                </td>
                <td className="px-3 py-1.5"><RowStatusChip status={r.status} /></td>
                <td className="px-3 py-1.5 text-secondary-900">
                  {r.email ? (
                    <span className="font-mono text-xs">{r.email}</span>
                  ) : (
                    <span className="text-secondary-400">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-secondary-500">
                  {r.status === 'skipped-multi' && r.exactMatchesCount
                    ? `${r.exactMatchesCount} exact matches — skipped`
                    : r.errorMessage
                      ? <span className="text-red-600">{r.errorMessage}</span>
                      : r.status === 'no-match' && r.candidatesCount !== null
                        ? `${r.candidatesCount} candidates, 0 exact`
                        : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <p className="px-3 py-2 text-xs text-secondary-400 border-t border-secondary-100">
            Showing first 500 of {filtered.length}
          </p>
        )}
        {filtered.length === 0 && (
          <p className="px-3 py-8 text-xs text-secondary-400 text-center">
            {rows.length === 0 ? 'Waiting for rows…' : 'No rows match this filter'}
          </p>
        )}
      </div>
    </div>
  );
};

// ─── Small components ──────────────────────────────────────────────

const StatPill: React.FC<{
  icon: React.ElementType;
  label: string;
  value: number;
  tone: 'green' | 'gray' | 'amber' | 'red';
  onClick?: () => void;
  active?: boolean;
}> = ({ icon: Icon, label, value, tone, onClick, active }) => {
  const toneClasses = {
    green: 'text-green-700 bg-green-50 border-green-200',
    gray: 'text-secondary-700 bg-secondary-50 border-secondary-200',
    amber: 'text-amber-700 bg-amber-50 border-amber-200',
    red: 'text-red-700 bg-red-50 border-red-200',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs ${toneClasses} ${active ? 'ring-2 ring-primary-500/30' : ''} hover:brightness-95 transition`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium">{value}</span>
      <span className="text-[11px] opacity-80">{label}</span>
    </button>
  );
};

const JobStatusChip: React.FC<{ job: LookupJob }> = ({ job }) => {
  const map: Record<LookupJob['status'], { label: string; cls: string }> = {
    pending: { label: 'Pending', cls: 'bg-secondary-100 text-secondary-600' },
    running: { label: 'Running', cls: 'bg-primary-100 text-primary-700' },
    paused: { label: 'Paused', cls: 'bg-amber-100 text-amber-700' },
    completed: { label: 'Completed', cls: 'bg-green-100 text-green-700' },
    failed: { label: 'Failed', cls: 'bg-red-100 text-red-700' },
  };
  const m = map[job.status];
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.cls}`}>{m.label}</span>;
};

const RowStatusChip: React.FC<{ status: RowStatus }> = ({ status }) => {
  const map: Record<RowStatus, { label: string; cls: string }> = {
    pending: { label: 'Pending', cls: 'bg-secondary-100 text-secondary-500' },
    processing: { label: 'Processing', cls: 'bg-primary-100 text-primary-700' },
    matched: { label: 'Matched', cls: 'bg-green-100 text-green-700' },
    'no-match': { label: 'No match', cls: 'bg-secondary-100 text-secondary-600' },
    'skipped-multi': { label: 'Multi-match — skipped', cls: 'bg-amber-100 text-amber-700' },
    'no-email': { label: 'No email', cls: 'bg-secondary-100 text-secondary-600' },
    error: { label: 'Error', cls: 'bg-red-100 text-red-700' },
  };
  const m = map[status];
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${m.cls}`}>{m.label}</span>;
};
