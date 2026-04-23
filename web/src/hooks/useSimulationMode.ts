import { useAppSettings } from '../contexts/AppSettingsContext';

/**
 * Simulation mode is a single global switch (`system/settings.simulationMode`).
 * When on, every UI read routes to the `simulation/*` sandbox and the sidecar
 * + Cloud Functions mirror writes there too. There is no per-session override.
 */
export function useSimulationMode() {
  const { settings } = useAppSettings();
  const enabled = !!settings.simulationMode;
  return { enabled };
}
