import React, { useState } from 'react';
import { Search, AlertCircle, UserRound } from 'lucide-react';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { AdminGuard } from '../components/ui/AdminGuard';
import { sidecar, type DrChronoPatient } from '../lib/sidecar';
import { integrationCall } from '../lib/integration-call';
import { useSimulationMode } from '../hooks/useSimulationMode';

type Mode = 'name' | 'id';

export const AdminDrChronoPage: React.FC = () => {
  const { enabled: simulated } = useSimulationMode();
  const [mode, setMode] = useState<Mode>('name');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [patientId, setPatientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DrChronoPatient[] | null>(null);
  const [source, setSource] = useState<'real' | 'simulated' | null>(null);

  const canSearchName = firstName.trim().length > 0 || lastName.trim().length > 0;
  const canSearchId = patientId.trim().length > 0;
  const canSearch = mode === 'name' ? canSearchName : canSearchId;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSearch || loading) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setSource(null);
    try {
      if (simulated) {
        if (mode === 'name') {
          const res = await integrationCall<{ results: DrChronoPatient[] }>({
            integration: 'drchrono',
            operation: 'list_patients',
            simulated: true,
            params: {
              first_name: firstName.trim() || undefined,
              last_name: lastName.trim() || undefined,
            },
          });
          setResults(res.data.results);
        } else {
          const res = await integrationCall<DrChronoPatient>({
            integration: 'drchrono',
            operation: 'get_patient',
            simulated: true,
            params: { id: patientId.trim() },
          });
          setResults([res.data]);
        }
        setSource('simulated');
      } else if (mode === 'name') {
        const list = await sidecar.drchronoSearchPatients({
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
        });
        setResults(list);
        setSource('real');
      } else {
        const patient = await sidecar.drchronoGetPatient(patientId.trim());
        setResults([patient]);
        setSource('real');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminGuard>
      <div className="space-y-6">
        <PageHeader
          backTo="/admin"
          icon={Search}
          title="Dr Chrono"
          subtitle="Look up a patient in DrChrono by name or patient ID."
        />

        <Card className="p-4 sm:p-6">
          <div className="flex gap-1 mb-4">
            <button
              type="button"
              onClick={() => setMode('name')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${
                mode === 'name'
                  ? 'border-primary-600 text-primary-700 bg-primary-50'
                  : 'border-transparent bg-secondary-100 text-secondary-700 hover:bg-secondary-200'
              }`}
            >
              By name
            </button>
            <button
              type="button"
              onClick={() => setMode('id')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${
                mode === 'id'
                  ? 'border-primary-600 text-primary-700 bg-primary-50'
                  : 'border-transparent bg-secondary-100 text-secondary-700 hover:bg-secondary-200'
              }`}
            >
              By patient ID
            </button>
          </div>

          <form onSubmit={handleSearch} className="flex flex-wrap gap-2 items-end">
            {mode === 'name' ? (
              <>
                <LabeledInput
                  label="First name"
                  value={firstName}
                  onChange={setFirstName}
                  placeholder="John"
                />
                <LabeledInput
                  label="Last name"
                  value={lastName}
                  onChange={setLastName}
                  placeholder="Smith"
                />
              </>
            ) : (
              <LabeledInput
                label="Patient ID"
                value={patientId}
                onChange={setPatientId}
                placeholder="123456"
                inputMode="numeric"
              />
            )}
            <button
              type="submit"
              disabled={!canSearch || loading}
              className="flex items-center gap-2 px-4 py-2 border border-primary-600 text-primary-700 bg-primary-50 hover:bg-primary-100 text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Search className="h-4 w-4" />
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>
        </Card>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        )}

        {!loading && results && results.length === 0 && (
          <Card className="p-8 text-center text-sm text-secondary-500">
            No matches in DrChrono.
          </Card>
        )}

        {!loading && results && results.length > 0 && (
          <Card>
            {source === 'simulated' && (
              <div className="px-4 py-2 text-xs font-medium text-amber-800 bg-amber-50 border-b border-amber-200">
                Simulated results — not from DrChrono
              </div>
            )}
            <div className="divide-y divide-secondary-200">
              {results.map((p) => (
                <PatientRow key={p.id} patient={p} />
              ))}
            </div>
          </Card>
        )}
      </div>
    </AdminGuard>
  );
};

const LabeledInput: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: 'numeric' | 'text';
}> = ({ label, value, onChange, placeholder, inputMode }) => (
  <label className="flex flex-col gap-1">
    <span className="text-xs font-medium text-secondary-600">{label}</span>
    <input
      type="text"
      inputMode={inputMode}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="border border-secondary-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
    />
  </label>
);

const PatientRow: React.FC<{ patient: DrChronoPatient }> = ({ patient }) => {
  const phone = patient.cell_phone || patient.home_phone || patient.office_phone || '';
  const name = `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || '(no name)';
  return (
    <div className="flex items-start gap-3 p-4">
      <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
        <UserRound className="h-5 w-5 text-primary-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold text-secondary-900">{name}</span>
          <span className="text-xs text-secondary-500">#{patient.id}</span>
          {patient.is_active === false && (
            <span className="text-xs text-red-600">inactive</span>
          )}
        </div>
        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 text-sm text-secondary-700">
          {patient.email && <span className="truncate">{patient.email}</span>}
          {phone && <span>{phone}</span>}
          {patient.date_of_birth && <span>DOB: {patient.date_of_birth}</span>}
          {patient.gender && <span>Gender: {patient.gender}</span>}
        </div>
      </div>
    </div>
  );
};
