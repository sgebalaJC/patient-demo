/**
 * Thin client for the Google Workspace integration.
 * Uses httpsCallable for authorize, Firestore for status, and Firestore delete for disconnect.
 */

import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { db, functions } from './firebase';

export interface GoogleWorkspaceIntegration {
  provider: string;
  status: string;
  email: string;
  enabledServices: string[];
  grantedScopes: string[];
  connectedAt: any;
  updatedAt: any;
  connectedBy: string;
}

/** Fetch the current integration status from Firestore. */
export async function getGoogleWorkspaceStatus(): Promise<GoogleWorkspaceIntegration | null> {
  const docRef = doc(db, 'integrations', 'google-workspace');
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return snap.data() as GoogleWorkspaceIntegration;
}

/** Get the OAuth authorization URL via the Cloud Function. */
export async function getGoogleWorkspaceAuthUrl(
  services: string[],
  returnUrl?: string,
): Promise<string> {
  const fn = httpsCallable<
    { services: string; returnUrl?: string },
    { url: string }
  >(functions, 'googleWorkspaceAuthorize');

  const result = await fn({
    services: services.join(','),
    ...(returnUrl ? { returnUrl } : {}),
  });

  return result.data.url;
}

/** Disconnect Google Workspace by deleting the integration doc. */
export async function disconnectGoogleWorkspace(): Promise<void> {
  const docRef = doc(db, 'integrations', 'google-workspace');
  await deleteDoc(docRef);
}
