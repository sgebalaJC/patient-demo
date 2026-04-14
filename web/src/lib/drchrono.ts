/**
 * Thin client for the DrChrono integration.
 * - Credentials (clientId + clientSecret) are saved via callable so they're
 *   only writable server-side (rule denies client writes to `integrations/*`).
 * - OAuth flow is kicked off by redirecting the browser to the authorize URL.
 * - Status is read directly from Firestore (admin-only rule allows it).
 */

import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { db, functions } from './firebase';

export interface DrChronoIntegration {
  provider: string;
  enabled?: boolean;
  status?: 'active' | 'not-authorized' | string;
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  tokenExpiresAt?: { seconds: number; nanoseconds: number } | null;
  connectedAt?: unknown;
  updatedAt?: unknown;
  connectedBy?: string;
  // clientSecret / accessToken / refreshToken are present on the doc but
  // intentionally not exposed in the TS type — UI should never display them.
}

export async function getDrChronoStatus(): Promise<DrChronoIntegration | null> {
  const snap = await getDoc(doc(db, 'integrations', 'drchrono'));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  // Whitelist fields returned to UI. Never surface secrets client-side.
  return {
    provider: (d.provider as string) || 'drchrono',
    enabled: Boolean(d.enabled),
    status: d.status as DrChronoIntegration['status'],
    clientId: d.clientId as string | undefined,
    redirectUri: d.redirectUri as string | undefined,
    scope: d.scope as string | undefined,
    tokenExpiresAt: (d.tokenExpiresAt as DrChronoIntegration['tokenExpiresAt']) ?? null,
    connectedAt: d.connectedAt,
    updatedAt: d.updatedAt,
    connectedBy: d.connectedBy as string | undefined,
  };
}

export async function saveDrChronoCredentials(
  clientId: string,
  clientSecret: string,
): Promise<{ ok: boolean; redirectUri: string }> {
  const fn = httpsCallable<
    { clientId: string; clientSecret: string },
    { ok: boolean; redirectUri: string }
  >(functions, 'drchronoSaveCredentials');
  const result = await fn({ clientId, clientSecret });
  return result.data;
}

export async function getDrChronoAuthUrl(): Promise<{ url: string; redirectUri: string }> {
  const fn = httpsCallable<Record<string, never>, { url: string; redirectUri: string }>(
    functions,
    'drchronoAuthorize',
  );
  const result = await fn({});
  return result.data;
}

export async function setDrChronoEnabled(enabled: boolean): Promise<void> {
  const fn = httpsCallable<{ enabled: boolean }, { ok: boolean }>(
    functions,
    'drchronoSetEnabled',
  );
  await fn({ enabled });
}

export async function disconnectDrChrono(): Promise<void> {
  await deleteDoc(doc(db, 'integrations', 'drchrono'));
}
