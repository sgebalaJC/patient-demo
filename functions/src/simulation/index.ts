/**
 * Simulation layer — Firestore-backed sandbox. The UI and Aurelia both
 * hit the sidecar's `/admin-api/*` routes, which check
 * `system/settings.simulationMode` and branch into
 * `sidecar/src/sim/<domain>.ts` when on. This module only exists to
 * expose the super-admin seed/clear callables and the in-process
 * simulator helpers that Cloud Functions use to short-circuit Twilio /
 * Gmail sends in sim mode.
 *
 * See `docs/SIMULATION.md` for the full story.
 */
import * as admin from "firebase-admin";

/** Context passed to simulator ops. Retained because a few simulator
 *  modules still reference it; most ops are dead exports now but pruning
 *  them is a separate cleanup. */
export interface SimContext {
  uid: string;
  role: "patient" | "admin";
  db: admin.firestore.Firestore;
}

export {seedSimulationData, clearSimulationData} from "./seed.js";
