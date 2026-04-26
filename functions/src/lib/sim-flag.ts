/**
 * Build-time flag deciding whether the simulation layer is reachable at all.
 *
 * Default: false. Real practice forks omit the env var → recordSimSms /
 * recordSimEmail and the per-call `isSimulationOn()` checks short-circuit
 * to the real path before any Firestore read.
 *
 * Set on a per-fork basis through `firebase functions:config:set` or via
 * Cloud Functions runtime env (e.g. `--update-env-vars=INCLUDE_SIM_MODE=true`
 * on the demo project only).
 */
export const INCLUDE_SIM_MODE = process.env.INCLUDE_SIM_MODE === "true";
