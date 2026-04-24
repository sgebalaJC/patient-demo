/**
 * Thin client for the SignalWire admin integration.
 *
 * Reads the public metadata doc at `integrations/signalwire` (non-secret
 * routing fields only). The LaML auth token is stored in Secret Manager
 * by the `saveSignalwireCredentials` callable and is never returned to
 * the browser.
 */

import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { db, functions } from './firebase';

export interface SignalwireIntegration {
  provider: 'signalwire';
  status: string;
  projectId: string;
  spaceUrl: string;
  smsFrom?: string | null;
  faxNumber?: string | null;
  faxLabel?: string | null;
  faxFromEmail?: string | null;
  faxCcEmail?: string | null;
  connectedAt?: unknown;
  updatedAt?: unknown;
  connectedBy?: string;
}

export async function getSignalwireStatus(): Promise<SignalwireIntegration | null> {
  const ref = doc(db, 'integrations', 'signalwire');
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as SignalwireIntegration;
}

export interface SaveSignalwireInput {
  projectId: string;
  /** Blank = keep the existing Secret Manager value. */
  authToken: string;
  spaceUrl: string;
  smsFrom: string;
  faxNumber: string;
  faxLabel: string;
  faxFromEmail: string;
  faxCcEmail: string;
}

export async function saveSignalwireCredentials(input: SaveSignalwireInput): Promise<void> {
  const fn = httpsCallable<SaveSignalwireInput, { success: boolean }>(
    functions,
    'saveSignalwireCredentials',
  );
  await fn(input);
}

export async function disconnectSignalwire(): Promise<void> {
  const fn = httpsCallable<Record<string, never>, { success: boolean }>(
    functions,
    'disconnectSignalwire',
  );
  await fn({});
}
