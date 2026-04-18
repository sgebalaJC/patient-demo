/**
 * Simulation layer — one callable entry point for every external integration.
 *
 * Flow:
 *   web/mobile client → integrationCall({ integration, operation, params, simulated })
 *     → if simulated flag is set AND system/settings.simulationMode is true
 *         → dispatch to simulators/<integration>.ts or generators/<integration>.ts
 *     → otherwise
 *         → forward to the real backend (sidecar for drchrono/workspace, etc.)
 *
 * Each simulator owns shape parity with the real API — the client never knows.
 *
 * Add a new integration by:
 *   1. creating `simulators/<name>.ts` exporting `{ [operation]: async (ctx, params) => T }`
 *   2. registering it in REGISTRY below
 *   3. (optional) seeding data in seed.ts
 */
import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {isSuperAdminEmail} from "../superAdmins.js";

import * as drchronoSim from "./simulators/drchrono.js";
import * as messagesGen from "./generators/messages.js";

export interface SimContext {
  uid: string;
  role: "patient" | "admin";
  db: admin.firestore.Firestore;
}

type Handler = (ctx: SimContext, params: any) => Promise<unknown>;

interface IntegrationSpec {
  /** Operations available to the simulator. Missing op → 501. */
  ops: Record<string, Handler>;
  /** Roles allowed to invoke *any* op on this integration. */
  allowedRoles: Array<"patient" | "admin">;
}

const REGISTRY: Record<string, IntegrationSpec> = {
  drchrono: {ops: drchronoSim as unknown as Record<string, Handler>, allowedRoles: ["admin"]},
  messages: {ops: messagesGen as unknown as Record<string, Handler>, allowedRoles: ["patient", "admin"]},
};

function db() {
  return admin.firestore();
}

async function resolveCaller(auth: {uid: string; token?: {email?: string}} | undefined): Promise<SimContext> {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign-in required");

  if (isSuperAdminEmail(auth.token?.email)) {
    return {uid: auth.uid, role: "admin", db: db()};
  }
  const snap = await db().collection("users").doc(auth.uid).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "User not found");
  const data = snap.data()!;
  if (data.isActive === false) throw new HttpsError("permission-denied", "Inactive account");
  const role = data.role === "admin" ? "admin" : "patient";
  return {uid: auth.uid, role, db: db()};
}

async function isSimulationAllowed(): Promise<boolean> {
  const snap = await db().doc("system/settings").get();
  return snap.exists && snap.data()?.simulationMode === true;
}

export const integrationCall = onCall({cors: true, timeoutSeconds: 60}, async (req) => {
  const {integration, operation, params, simulated} = (req.data || {}) as {
    integration?: string;
    operation?: string;
    params?: unknown;
    simulated?: boolean;
  };

  if (!integration || typeof integration !== "string") {
    throw new HttpsError("invalid-argument", "integration required");
  }
  if (!operation || typeof operation !== "string") {
    throw new HttpsError("invalid-argument", "operation required");
  }

  const spec = REGISTRY[integration];
  if (!spec) throw new HttpsError("not-found", `Unknown integration: ${integration}`);

  const ctx = await resolveCaller(req.auth);
  if (!spec.allowedRoles.includes(ctx.role)) {
    throw new HttpsError("permission-denied", `Role ${ctx.role} cannot call ${integration}`);
  }

  // Simulation path — gated by both the session flag AND the global setting.
  if (simulated) {
    if (!(await isSimulationAllowed())) {
      throw new HttpsError("failed-precondition", "Simulation mode disabled");
    }
    const op = spec.ops[operation];
    if (!op) throw new HttpsError("unimplemented", `No simulator for ${integration}.${operation}`);
    const data = await op(ctx, params ?? {});
    return {data, source: "simulated"};
  }

  // Real path — delegate to the existing sidecar/functions layer. Kept thin
  // for the skeleton; flesh out as we migrate real callers onto integrationCall.
  throw new HttpsError(
    "unimplemented",
    `Real backend dispatch for ${integration}.${operation} is not wired yet — use the existing path for now.`,
  );
});

export {seedSimulationData, clearSimulationData} from "./seed.js";
