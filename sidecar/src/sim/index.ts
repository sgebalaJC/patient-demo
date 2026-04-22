/**
 * Sidecar simulation layer — mirrors the Cloud Function simulators against
 * the same `simulation/*` Firestore sandbox. Every admin-api route starts
 * with a short `isSimulationOn()` check; when true, calls route into the
 * `sim/<domain>.ts` helpers instead of the real integration.
 *
 * Single source of truth for the flag:
 *   Firestore doc `system/settings.simulationMode: boolean`
 *
 * Aurelia (the admin agent) hits these same routes, so she automatically
 * sees the sandbox when the flag is on.
 *
 * Detaching from a real customer fork:
 *   - delete this directory
 *   - remove the `if (await isSimulationOn()) return simXxx(...)` lines
 *     at the top of each admin-api case
 *   - flip `system/settings.simulationMode: false`
 */
import { getDb } from "../lib/firebase.js";

let cached: { value: boolean; expiresAt: number } | null = null;
const TTL_MS = 10_000;

/**
 * Global sim flag — cached for 10s so Aurelia's tight loops don't hammer
 * Firestore. A short TTL keeps the admin toggle snappy in dev.
 */
export async function isSimulationOn(): Promise<boolean> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const snap = await getDb().doc("system/settings").get();
    const on = snap.exists && snap.data()?.simulationMode === true;
    cached = { value: on, expiresAt: now + TTL_MS };
    return on;
  } catch {
    return false;
  }
}
