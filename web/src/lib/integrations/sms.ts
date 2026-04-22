/**
 * SMS integration façade. Sidecar decides sim vs real at /admin-api/messaging/*.
 * Subscriptions to the outbound/inbound history remain in the subscribing
 * component (Firestore onSnapshot can't route through a callable).
 */
import { sidecar } from '../sidecar';

export async function sendSMS(args: { to: string; body: string; kind?: string }) {
  return sidecar.smsSend(args);
}

export async function injectInbound(args: { from?: string; body?: string } = {}) {
  return sidecar.smsInjectInbound(args);
}
