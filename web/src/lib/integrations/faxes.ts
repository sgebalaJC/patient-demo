/**
 * Fax integration façade. Sidecar decides sim vs real at its admin-api
 * routes. This module is a thin typed front-end.
 *
 * Live subscriptions (faxes inbox + outbound list) remain in the
 * subscribing component — Firestore onSnapshot can't be routed through
 * a callable. Components pick the collection path via `useSimulationMode()`
 * (documented limit of the middleware).
 */
import { sidecar } from '../sidecar';

export async function getOurFaxNumber(): Promise<string | null> {
  return sidecar.faxGetOurNumber();
}

export async function injectInbound(args: { from?: string; pages?: number } = {}): Promise<{ faxSid: string }> {
  return sidecar.faxInjectInbound(args);
}

export async function sendFax(args: { to: string; subject?: string; fileCount?: number }): Promise<{ faxSid: string; status: string; ok: boolean }> {
  return sidecar.faxSend(args);
}
