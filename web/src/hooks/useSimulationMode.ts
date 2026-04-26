import { useAppSettings } from '../contexts/AppSettingsContext';
import { INCLUDE_SIM_MODE } from '../lib/sim-flag';

/**
 * Simulation mode is a single global switch (`system/settings.simulationMode`).
 * When on, every UI read routes to the `simulation/*` sandbox and the sidecar
 * + Cloud Functions mirror writes there too. There is no per-session override.
 *
 * INCLUDE_SIM_MODE is the build-time flag — installer-emitted forks ship with
 * it false, so this hook hard-returns `false` and Vite tree-shakes every
 * `if (enabled) { ... }` branch in the bundle.
 */
export function useSimulationMode() {
  const { settings } = useAppSettings();
  if (!INCLUDE_SIM_MODE) return { enabled: false };
  const enabled = !!settings.simulationMode;
  return { enabled };
}
