import { useAppSettings } from '../contexts/AppSettingsContext';
import { isSimMode } from '../lib/sim-mode';

/**
 * React-reactive view of the sim-mode singleton.
 *
 * The actual flag lives in `lib/sim-mode.ts` — that module is the single
 * source of truth for every read path (collections.*, simPath(), etc.).
 * This hook subscribes to AppSettings so React re-renders when the Firestore
 * `system/settings.simulationMode` flag flips, then returns the current
 * singleton value (which has the build-time INCLUDE_SIM_MODE gate folded in).
 */
export function useSimulationMode() {
  // Subscribe so React re-renders on flag changes; the value itself is read
  // from the singleton to keep one canonical answer for everyone.
  useAppSettings();
  return { enabled: isSimMode() };
}
