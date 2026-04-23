/**
 * Thin client for the Google Workspace integration.
 *
 * All writes flow through Cloud Functions (Admin SDK). Reads come from the
 * public doc at `integrations/google-workspace` — non-secret metadata
 * only; credentials live in Secret Manager (SA key) or the private
 * subcollection (OAuth refresh token cipher).
 */

import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { db, functions } from './firebase';

export type GoogleAuthMode = 'service-account' | 'oauth';

export interface GoogleWorkspaceIntegration {
  provider: 'google-workspace';
  status: string;
  authMode: GoogleAuthMode;
  calendarId: string;
  enabledServices: string[];
  grantedScopes: string[];
  // oauth:
  email?: string;
  // service-account:
  saClientEmail?: string;
  subject?: string;
  connectedAt: any;
  updatedAt: any;
  connectedBy: string;
}

export async function getGoogleWorkspaceStatus(): Promise<GoogleWorkspaceIntegration | null> {
  const docRef = doc(db, 'integrations', 'google-workspace');
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return snap.data() as GoogleWorkspaceIntegration;
}

/** OAuth mode (B): returns Google consent URL. */
export async function getGoogleWorkspaceAuthUrl(
  services: string[],
  calendarId: string,
  returnUrl?: string,
): Promise<string> {
  const fn = httpsCallable<
    { services: string; calendarId: string; returnUrl?: string },
    { url: string }
  >(functions, 'googleWorkspaceAuthorize');

  const result = await fn({
    services: services.join(','),
    calendarId,
    ...(returnUrl ? { returnUrl } : {}),
  });

  return result.data.url;
}

/** Service-account mode (A): admin uploads JSON key + names the subject. */
export async function saveGoogleWorkspaceServiceAccount(input: {
  saKeyJson: string;
  subject: string;
  calendarId: string;
  services: string[];
}): Promise<{ success: boolean; email: string; services: string[] }> {
  const fn = httpsCallable<typeof input, { success: boolean; email: string; services: string[] }>(
    functions,
    'saveGoogleWorkspaceServiceAccount',
  );
  const result = await fn(input);
  return result.data;
}

/** Disconnect — deletes the doc + (for SA mode) the Secret Manager key. */
export async function disconnectGoogleWorkspace(): Promise<void> {
  const fn = httpsCallable<Record<string, never>, { success: boolean }>(
    functions,
    'disconnectGoogleWorkspace',
  );
  await fn({});
}
