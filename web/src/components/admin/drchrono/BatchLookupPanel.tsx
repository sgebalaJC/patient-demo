import React, { useState } from 'react';
import {
  Users,
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Mail,
  Copy,
  Trash2,
} from 'lucide-react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import {
  type DrChronoLookupQuery,
  type DrChronoLookupResult,
  type UnifiedDrChronoPatient,
} from '../../../lib/sidecar';
import { drchrono } from '../../../lib/integrations';
import { UnifiedPatientCard } from './UnifiedPatientCard';
import { parseSearchInput } from './PatientLookupPanel';
import logger from '../../../lib/logger';

interface Row {
  id: string;
  line: string;
  query: DrChronoLookupQuery | null;
  result: DrChronoLookupResult | null;
}

/** Parse a pasted textarea into rows. One line = one query. */
function parsePaste(text: string): Row[] {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map((line, i) => ({
      id: `row-${i}-${line.slice(0, 40)}`,
      line,
      query: parseSearchInput(line),
      result: null,
    }));
}

export const BatchLookupPanel: React.FC = () => {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const matched = rows.filter(r => r.result?.status === 'matched' && r.result.patient) as
    Array<Row & { result: DrChronoLookupResult & { patient: UnifiedDrChronoPatient } }>;

  async function runBatch() {
    setError(null);
    const parsed = parsePaste(text);
    if (parsed.length === 0) {
      setError('Paste one name per line.');
      return;
    }
    if (parsed.length > 100) {
      setError('Max 100 rows per batch. Split your list.');
      return;
    }
    const unrecognized = parsed.filter(p => !p.query);
    if (unrecognized.length > 0) {
      setError(
        `Couldn't parse: ${unrecognized.slice(0, 3).map(u => u.line).join('; ')}${
          unrecognized.length > 3 ? '…' : ''
        }`,
      );
      return;
    }

    setRows(parsed);
    setExpanded({});
    setRunning(true);
    try {
      const { results } = await drchrono.lookupPatientsBatch(
        parsed.map(p => ({ id: p.id, query: p.query! })),
      );
      const byId = new Map(results.map(r => [r.id, r]));
      setRows(prev =>
        prev.map(r => ({
          ...r,
          result: byId.get(r.id)?.result ?? null,
        })),
      );
    } catch (err: any) {
      logger.error('Batch lookup failed:', err);
      setError(err?.message || 'Batch lookup failed');
    } finally {
      setRunning(false);
    }
  }

  async function copyEmails() {
    const emails = matched.map(m => m.result.patient.email).filter(Boolean) as string[];
    if (emails.length === 0) return;
    await navigator.clipboard.writeText(emails.join(', '));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function clearAll() {
    setText('');
    setRows([]);
    setExpanded({});
    setError(null);
  }

  function toggle(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3">
        <label className="block text-sm font-medium text-secondary-700">
          Patient list (one per line)
        </label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={'Jane Doe\nbob@example.com\n951-555-1234\n123456\nSmith, John'}
          rows={18}
          className="input w-full font-mono text-sm resize-y min-h-[22rem]"
          disabled={running}
        />
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-secondary-500">
            Each line is parsed as a name, email, phone, or DrChrono ID.
            A single token is treated as a last name — use{' '}
            <span className="font-mono">First Last</span> or{' '}
            <span className="font-mono">Last, First</span> for full-name search.
            Server-paced to stay under DrChrono's rate limit.
          </p>
          <div className="flex items-center gap-2">
            {text && !running && (
              <Button variant="secondary" size="sm" onClick={clearAll}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
            )}
            <Button onClick={runBatch} loading={running} className="flex items-center">
              <Play className="h-4 w-4 mr-2" />
              Run batch ({parsePaste(text).length})
            </Button>
          </div>
        </div>
        {error && (
          <p className="text-xs text-red-600 inline-flex items-center gap-2">
            <XCircle className="h-3.5 w-3.5" />
            {error}
          </p>
        )}
      </Card>

      {rows.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="p-4 border-b border-secondary-200 flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm inline-flex items-center gap-4">
              <span className="font-medium text-secondary-900 inline-flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                {rows.length} row{rows.length === 1 ? '' : 's'}
              </span>
              {!running && (
                <>
                  <span className="text-xs text-green-700 inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {rows.filter(r => r.result?.status === 'matched').length} matched
                  </span>
                  <span className="text-xs text-amber-700 inline-flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {rows.filter(r => r.result?.status === 'no-match').length} no-match
                  </span>
                  <span className="text-xs text-amber-700 inline-flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {rows.filter(r => r.result?.status === 'skipped-multi').length} multi
                  </span>
                  <span className="text-xs text-red-700 inline-flex items-center gap-1">
                    <XCircle className="h-3.5 w-3.5" />
                    {rows.filter(r => r.result?.status === 'error').length} error
                  </span>
                </>
              )}
              {running && (
                <span className="text-xs text-secondary-600 inline-flex items-center gap-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Processing…
                </span>
              )}
            </div>
            {matched.some(m => m.result.patient.email) && !running && (
              <Button size="sm" onClick={copyEmails} variant="secondary">
                {copied ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Copied
                  </>
                ) : (
                  <>
                    <Mail className="h-3.5 w-3.5 mr-1" />
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    Copy matched emails
                  </>
                )}
              </Button>
            )}
          </div>

          <ul className="divide-y divide-secondary-200">
            {rows.map(row => (
              <RowItem
                key={row.id}
                row={row}
                expanded={!!expanded[row.id]}
                onToggle={() => toggle(row.id)}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};

const RowItem: React.FC<{ row: Row; expanded: boolean; onToggle: () => void }> = ({
  row,
  expanded,
  onToggle,
}) => {
  const r = row.result;
  const patient = r?.patient;
  const canExpand = Boolean(patient);
  const chip = (() => {
    if (!r) return { label: 'Pending', cls: 'bg-secondary-100 text-secondary-600' };
    if (r.status === 'matched') return { label: 'Matched', cls: 'bg-green-100 text-green-700' };
    if (r.status === 'no-match') return { label: 'No match', cls: 'bg-secondary-100 text-secondary-600' };
    if (r.status === 'skipped-multi') return { label: 'Multi-match', cls: 'bg-amber-100 text-amber-700' };
    return { label: 'Error', cls: 'bg-red-100 text-red-700' };
  })();

  return (
    <li className="bg-surface-card">
      <div
        className={`flex items-center justify-between gap-3 p-3 ${canExpand ? 'cursor-pointer hover:bg-secondary-50' : ''}`}
        onClick={() => canExpand && onToggle()}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {canExpand ? (
            expanded ? <ChevronDown className="h-4 w-4 text-secondary-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-secondary-400 shrink-0" />
          ) : (
            <div className="w-4 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm text-secondary-900 truncate font-medium">{row.line}</p>
            {patient && (
              <p className="text-xs text-secondary-500 truncate">
                {patient.firstName} {patient.lastName} · #{patient.drchronoId}
                {patient.email && <> · <span className="font-mono">{patient.email}</span></>}
              </p>
            )}
            {r?.status === 'no-match' && r.candidatesCount > 0 && (
              <p className="text-xs text-secondary-500">
                {r.candidatesCount} near candidate{r.candidatesCount === 1 ? '' : 's'}, no exact match
              </p>
            )}
            {r?.status === 'skipped-multi' && (
              <p className="text-xs text-secondary-500">
                {r.exactMatchesCount} exact matches
              </p>
            )}
            {r?.status === 'error' && r.errorMessage && (
              <p className="text-xs text-red-600 truncate" title={r.errorMessage}>{r.errorMessage}</p>
            )}
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${chip.cls}`}>
          {chip.label}
        </span>
      </div>
      {expanded && patient && (
        <div className="p-3 pt-0 bg-secondary-50/50 border-t border-secondary-100">
          <UnifiedPatientCard patient={patient} embedded />
        </div>
      )}
    </li>
  );
};
