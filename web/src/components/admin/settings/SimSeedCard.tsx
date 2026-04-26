import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Database, FlaskConical, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Toggle';
import { functions } from '../../../lib/firebase';

// Sim-mode-only card. Imported via React.lazy() from AdminSettingsPage and
// only when INCLUDE_SIM_MODE is true at build time. Keeping the lucide icons,
// the seed/clear callable strings, and the seed-state machine here means a
// flag-off build never references this module: Vite drops the chunk and the
// strings 'seedSimulationData' / 'clearSimulationData' don't appear in dist.
interface Props {
  simulationMode: boolean;
  onSimulationModeChange: (next: boolean) => void;
}

const SimSeedCard: React.FC<Props> = ({ simulationMode, onSimulationModeChange }) => {
  const [seedState, setSeedState] = useState<{
    busy: 'seed' | 'clear' | null;
    message: string;
    error: string;
  }>({ busy: null, message: '', error: '' });

  const runSeed = async (kind: 'seed' | 'clear') => {
    setSeedState({ busy: kind, message: '', error: '' });
    try {
      const name = kind === 'seed' ? 'seedSimulationData' : 'clearSimulationData';
      const res = (await httpsCallable(functions, name)({})) as {
        data: { ok: boolean; seeded?: Record<string, number>; cleared?: Record<string, number> };
      };
      const counts = res.data.seeded || res.data.cleared || {};
      const summary = Object.entries(counts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      setSeedState({
        busy: null,
        message: `${kind === 'seed' ? 'Seeded' : 'Cleared'} — ${summary}`,
        error: '',
      });
    } catch (err) {
      setSeedState({
        busy: null,
        message: '',
        error: err instanceof Error ? err.message : 'Failed',
      });
    }
  };

  return (
    <div className="p-4 border border-secondary-200 rounded-lg">
      <div className="flex items-start justify-between space-x-4">
        <div className="flex items-start space-x-3 flex-1">
          <div className="bg-secondary-100 p-2 rounded-lg mt-0.5">
            <FlaskConical className="h-4 w-4 text-secondary-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-secondary-900">Simulation mode</p>
            <p className="text-xs text-secondary-500 mt-0.5">
              Global switch. When on, everyone sees seeded sandbox data and integration
              calls (DrChrono, inbox, SMS, etc.) never reach real services. Only
              super-admins can flip it. Leave off on real customer forks.
            </p>
          </div>
        </div>
        <Toggle
          checked={simulationMode}
          onChange={onSimulationModeChange}
          ariaLabel="Simulation mode"
        />
      </div>

      <div className="mt-3 pt-3 border-t border-secondary-200">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-secondary-500">
            Super-admin: seed the demo sandbox (50 patients, 50 appointments, 50
            refills, 3 inbound faxes + 2 outbound with viewable PDFs). Idempotent —
            re-running replaces content in place.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => runSeed('seed')}
              loading={seedState.busy === 'seed'}
              disabled={seedState.busy !== null}
              className="!bg-transparent !border-green-600 !text-green-700 hover:!bg-green-50"
            >
              <Database className="h-3.5 w-3.5 mr-1" />
              Seed demo data
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => runSeed('clear')}
              loading={seedState.busy === 'clear'}
              disabled={seedState.busy !== null}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
          </div>
        </div>
        {seedState.message && (
          <p className="mt-2 text-xs text-green-700">{seedState.message}</p>
        )}
        {seedState.error && (
          <p className="mt-2 text-xs text-red-700">{seedState.error}</p>
        )}
      </div>
    </div>
  );
};

export default SimSeedCard;
