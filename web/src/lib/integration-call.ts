/**
 * Typed client for the `integrationCall` Cloud Function — the single entry
 * point for all external integrations (DrChrono, Workspace, etc.). Routes to
 * either the real backend or the simulation layer based on the per-session
 * flag the caller passes in.
 *
 * The session flag lives in sessionStorage and is read through
 * `useSimulationMode()`. This client takes an explicit `simulated` param so
 * non-React callers (services, background jobs) can control it too.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface IntegrationCallRequest<P = Record<string, unknown>> {
  integration: 'drchrono' | 'workspace' | 'messages';
  operation: string;
  params?: P;
  simulated?: boolean;
}

export interface IntegrationCallResponse<T = unknown> {
  data: T;
  source: 'real' | 'simulated';
}

const callable = httpsCallable(functions, 'integrationCall');

export async function integrationCall<T = unknown, P = Record<string, unknown>>(
  req: IntegrationCallRequest<P>,
): Promise<IntegrationCallResponse<T>> {
  const res = await callable(req);
  return res.data as IntegrationCallResponse<T>;
}
