/**
 * Build-time flag deciding whether the simulation layer is reachable at all.
 *
 * Default: false. Real practice forks omit the env var → sim code stays
 * unreachable. The demo fork sets `INCLUDE_SIM_MODE=true` in
 * `/root/sidecar.env` (or systemd EnvironmentFile) so the existing
 * `system/settings.simulationMode` Firestore toggle keeps working as before.
 *
 * This flag is checked once at the top of `isSimulationOn()` and the
 * single-router registration in `routes/admin-api.ts`. When false, the
 * Firestore lookup is skipped and the sim helpers never execute.
 */
export const INCLUDE_SIM_MODE = process.env.INCLUDE_SIM_MODE === "true";
