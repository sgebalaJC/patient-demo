/**
 * Build-time flag deciding whether the simulation layer is reachable at all.
 *
 * Resolved by Vite's `define` at build time (see web/vite.config.ts) so
 * `if (!INCLUDE_SIM_MODE) ...` branches get tree-shaken in production
 * bundles. A runtime fallback to `import.meta.env.VITE_INCLUDE_SIM_MODE`
 * keeps the dev server honest when `define` isn't applied.
 *
 * Default: false. Real practice forks ship zero sim UI. The demo fork sets
 * `INCLUDE_SIM_MODE=true` (read from process.env at vite build) → useSimulationMode
 * still respects the live Firestore toggle.
 */

declare const __INCLUDE_SIM_MODE__: boolean | undefined;

const fromDefine = typeof __INCLUDE_SIM_MODE__ !== "undefined" ? __INCLUDE_SIM_MODE__ : undefined;
const fromEnv = (import.meta as { env?: { VITE_INCLUDE_SIM_MODE?: string } }).env?.VITE_INCLUDE_SIM_MODE === "true";

export const INCLUDE_SIM_MODE: boolean = fromDefine ?? fromEnv;
