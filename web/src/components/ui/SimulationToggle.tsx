import React from 'react';
import { FlaskConical } from 'lucide-react';
import { useSimulationMode } from '../../hooks/useSimulationMode';

/**
 * Per-session "Demo data" switch. Renders nothing when the admin hasn't
 * enabled simulation mode globally — production forks never see it.
 */
export const SimulationToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { enabled, available, setEnabled } = useSimulationMode();
  if (!available) return null;

  return (
    <button
      type="button"
      onClick={() => setEnabled(!enabled)}
      title={enabled ? 'Using simulated demo data' : 'Using real data'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        enabled
          ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
          : 'bg-secondary-50 border-secondary-200 text-secondary-600 hover:bg-secondary-100'
      } ${className}`}
    >
      <FlaskConical className="h-3.5 w-3.5" />
      <span>{enabled ? 'Demo data' : 'Real data'}</span>
    </button>
  );
};
