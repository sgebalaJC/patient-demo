/**
 * Integration middleware — the single seam between UI code and external
 * services. Every page/component imports from `lib/integrations/<domain>`
 * and never touches `sidecar` or `integrationCall` directly.
 *
 * Each wrapper forks on the per-session simulation flag:
 *   - sim on  → `integrationCall({ integration, operation, simulated: true })`
 *              → Cloud Function simulator → Firestore `simulation/<domain>/*`
 *   - sim off → real path (sidecar HTTP, Twilio, SignalWire, etc.)
 *
 * The fork lives inside each wrapper — callers stay blind to routing.
 *
 * Detach path for real customer forks: delete this directory, revert callers
 * to direct sidecar/service clients, remove `system/settings.simulationMode`.
 */
import { currentSimulationFlag } from '../../hooks/useSimulationMode';

/**
 * Read the current simulation flag for non-React callers. Pass the global
 * availability flag (from `settings.simulationMode`) and this returns true
 * only when both the global feature + the per-session toggle are on.
 */
export function isSimulationOn(globalAvailable: boolean): boolean {
  return currentSimulationFlag(globalAvailable);
}

export * as drchrono from './drchrono';
export * as faxes from './faxes';
export * as sms from './sms';
