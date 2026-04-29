/**
 * Single source of truth for simulation mode in the web client.
 *
 * Two layers gate sim:
 *   1. INCLUDE_SIM_MODE  — build-time. False in installer-emitted forks; vite
 *                          tree-shakes every sim path string out of the bundle.
 *   2. system/settings.simulationMode — Firestore runtime flag, super-admin only.
 *
 * `setSimMode` AND-folds both: if the build flag is off the singleton stays
 * false regardless of what Firestore says, so a stale `simulationMode = true`
 * left over from a prior demo deploy can never route real reads through
 * `simulation/native/*`.
 *
 * `_simMode` is a module-level cache hydrated synchronously from localStorage
 * at module init so any code reading the flag before the first
 * AppSettingsContext snapshot fires (e.g. AuthContext on cold reload after
 * impersonation) sees the correct value. Snapshots refresh both the in-memory
 * cell and the cached value.
 *
 * Every Firestore read in the web app routes through `simPath` (directly or
 * via `collections.*` in `firestore/base.ts`). Nothing else thinks about sim.
 */

import { INCLUDE_SIM_MODE } from './sim-flag';

const CACHE_KEY = 'patient-portal:sim-mode';

function readCache(): boolean {
  if (!INCLUDE_SIM_MODE) return false;
  try {
    return window.localStorage.getItem(CACHE_KEY) === 'true';
  } catch {
    return false;
  }
}

let _simMode = readCache();

export function setSimMode(on: boolean): void {
  const next = INCLUDE_SIM_MODE && on === true;
  _simMode = next;
  try {
    window.localStorage.setItem(CACHE_KEY, String(next));
  } catch {
    /* localStorage disabled — module-level cell is still authoritative for this tab */
  }
}

export function isSimMode(): boolean {
  return _simMode;
}

/**
 * Map a logical collection name to its physical Firestore path.
 * Real mode → `name`; sim mode → `simulation/native/${name}`.
 *
 * The `if (!INCLUDE_SIM_MODE) return name` short-circuit lets Vite/Rollup
 * tree-shake the sim path template out of installer-emitted bundles entirely
 * — `INCLUDE_SIM_MODE` is a literal constant from `sim-flag.ts` so the
 * second branch is statically unreachable at build time.
 */
export function simPath(name: string): string {
  if (!INCLUDE_SIM_MODE) return name;
  return _simMode ? `simulation/native/${name}` : name;
}
