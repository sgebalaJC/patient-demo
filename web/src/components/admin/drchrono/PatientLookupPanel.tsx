import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Loader2, AlertTriangle, XCircle, ExternalLink, Users } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { type DrChronoLookupQuery, type DrChronoLookupResult } from '../../../lib/sidecar';
import { drchrono } from '../../../lib/integrations';
import { UnifiedPatientCard } from './UnifiedPatientCard';
import { getPhoneDigits } from '../../../lib/phone';
import logger from '../../../lib/logger';

/**
 * Parse a free-text search input into a DrChronoLookupQuery.
 * Detection rules:
 *   - '#' prefix + digits                  → drchronoId (explicit)
 *   - contains '@'                         → email
 *   - digits (with or without format chars) → phone
 *   - comma-separated name                 → "Last, First"
 *   - whitespace-separated                 → "First Last"
 *
 * `#` is the unambiguous ID marker — bare digits go to phone search so
 * an unformatted phone still works. The UI populates `#<id>` for you
 * when you click the DrChrono button on a patient card.
 */
export function parseSearchInput(raw: string): DrChronoLookupQuery | null {
  const v = raw.trim();
  if (!v) return null;

  if (/^#\d+$/.test(v)) return { drchronoId: v.slice(1) };

  if (v.includes('@')) return { email: v };

  const digits = getPhoneDigits(v);
  const isPhoneLike = digits.length >= 7 && /^[\d\s\-()+]+$/.test(v);
  if (isPhoneLike) return { phone: digits };

  if (v.includes(',')) {
    const [last, first] = v.split(',').map(s => s.trim());
    if (last && first) return { firstName: first, lastName: last };
  }

  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    return { firstName, lastName };
  }
  if (parts.length === 1) {
    // Single token — treat as last name. DrChrono's /patients/?last_name= is
    // the more selective filter, so this misses fewer matches than trying
    // first_name alone. User can disambiguate with "First Last" if needed.
    return { lastName: parts[0] };
  }
  return null;
}

function describeQuery(q: DrChronoLookupQuery): string {
  if (q.drchronoId) return `DrChrono #${q.drchronoId}`;
  if (q.email) return q.email;
  if (q.phone) return q.phone;
  if (q.firstName || q.lastName) return `${q.firstName || ''} ${q.lastName || ''}`.trim();
  return '';
}

export const PatientLookupPanel: React.FC = () => {
  const [params] = useSearchParams();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState<DrChronoLookupQuery | null>(null);
  const [result, setResult] = useState<DrChronoLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  // Auto-run on initial load when URL carries patient params (from User Management button).
  // Depend on the actual values, not the params object — `useSearchParams`
  // returns a fresh URLSearchParams every render, so depending on the object
  // would re-fire the effect on every render and re-run the lookup.
  const urlDrchronoId = params.get('drchronoId') || '';
  const urlFirstName = params.get('firstName') || '';
  const urlLastName = params.get('lastName') || '';
  useEffect(() => {
    if (!urlDrchronoId && !urlFirstName && !urlLastName) return;

    const q: DrChronoLookupQuery = {};
    if (urlDrchronoId) q.drchronoId = urlDrchronoId;
    if (urlFirstName) q.firstName = urlFirstName;
    if (urlLastName) q.lastName = urlLastName;

    setInput(urlDrchronoId ? `#${urlDrchronoId}` : `${urlFirstName} ${urlLastName}`.trim());
    void runLookup(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlDrchronoId, urlFirstName, urlLastName]);

  async function runLookup(q: DrChronoLookupQuery) {
    setQuery(q);
    setResult(null);
    setError(null);
    setLoading(true);
    try {
      const r = await drchrono.lookupPatient(q);
      if (cancelledRef.current) return;
      setResult(r);
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      logger.error('Patient lookup failed:', err);
      setError(err?.message || 'Lookup failed');
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = parseSearchInput(input);
    if (!q) {
      setError('Enter a name, email, phone number, or DrChrono ID');
      return;
    }
    void runLookup(q);
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm font-medium text-secondary-700">
            Patient search
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
              <Input
                type="text"
                autoFocus
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Name, email, phone, or DrChrono ID"
                className="pl-10"
              />
            </div>
            <Button type="submit" loading={loading} className="flex items-center">
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
          <p className="text-xs text-secondary-500">
            Examples: <span className="font-mono">#1001</span> (DrChrono ID — prefix with{' '}
            <span className="font-mono">#</span>),{' '}
            <span className="font-mono">grace.chen1@example.com</span>,{' '}
            <span className="font-mono">+15551000005</span>,{' '}
            <span className="font-mono">Patel, Hiro</span>. A single token is
            treated as a last name — use <span className="font-mono">First Last</span> or{' '}
            <span className="font-mono">Last, First</span> for full-name search.
          </p>
        </form>
      </Card>

      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700 inline-flex items-center gap-2">
            <XCircle className="h-4 w-4" />
            {error}
          </p>
        </Card>
      )}

      {loading && (
        <Card className="p-6">
          <p className="text-sm text-secondary-600 inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Querying DrChrono{query ? ` for ${describeQuery(query)}` : ''}…
          </p>
        </Card>
      )}

      {!loading && result?.status === 'matched' && result.patient && (
        <UnifiedPatientCard patient={result.patient} autoLoadExtras />
      )}

      {!loading && result?.status === 'no-match' && (
        <Card className="p-5 border-amber-200 bg-amber-50">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm text-amber-800 inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              No matching patient in DrChrono
              {result.candidatesCount > 0 && ` (${result.candidatesCount} near candidates).`}
            </p>
            {query && (query.firstName || query.lastName) && (
              <a
                href={`https://app.drchrono.com/patients/?search_query=${encodeURIComponent(
                  [query.firstName, query.lastName].filter(Boolean).join(' '),
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary-700 hover:text-primary-800 inline-flex items-center gap-1"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Search manually in DrChrono
              </a>
            )}
          </div>
        </Card>
      )}

      {!loading && result?.status === 'skipped-multi' && (
        <div className="space-y-3">
          <Card className="p-4 border-amber-200 bg-amber-50">
            <p className="text-sm text-amber-800 inline-flex items-center gap-2">
              <Users className="h-4 w-4" />
              {result.exactMatchesCount} exact matches — pick one to view details.
            </p>
          </Card>
          {(result.candidates || []).map(c => (
            <UnifiedPatientCard key={c.drchronoId} patient={c} />
          ))}
        </div>
      )}

      {!loading && result?.status === 'error' && (
        <Card className="p-5 border-red-200 bg-red-50">
          <p className="text-sm text-red-700 inline-flex items-center gap-2">
            <XCircle className="h-4 w-4" />
            {result.errorMessage || 'DrChrono returned an error'}
          </p>
        </Card>
      )}
    </div>
  );
};
