/**
 * Thin client for the Athenahealth integration. Same shape as lib/drchrono.ts.
 */

import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { db, functions } from './firebase';

export interface AthenaIntegration {
  provider: string;
  enabled?: boolean;
  status?: 'active' | 'not-authorized' | string;
  clientId?: string;
  practiceId?: string;
  preview?: boolean;
  redirectUri?: string;
  scope?: string;
  tokenExpiresAt?: { seconds: number; nanoseconds: number } | null;
  connectedAt?: unknown;
  updatedAt?: unknown;
  connectedBy?: string;
}

export async function getAthenaStatus(): Promise<AthenaIntegration | null> {
  const snap = await getDoc(doc(db, 'integrations', 'athena'));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  return {
    provider: (d.provider as string) || 'athena',
    enabled: Boolean(d.enabled),
    status: d.status as AthenaIntegration['status'],
    clientId: d.clientId as string | undefined,
    practiceId: d.practiceId as string | undefined,
    preview: Boolean(d.preview),
    redirectUri: d.redirectUri as string | undefined,
    scope: d.scope as string | undefined,
    tokenExpiresAt: (d.tokenExpiresAt as AthenaIntegration['tokenExpiresAt']) ?? null,
    connectedAt: d.connectedAt,
    updatedAt: d.updatedAt,
    connectedBy: d.connectedBy as string | undefined,
  };
}

export async function saveAthenaCredentials(
  clientId: string,
  clientSecret: string,
  practiceId: string,
  preview: boolean,
): Promise<{ ok: boolean; redirectUri: string }> {
  const fn = httpsCallable<
    { clientId: string; clientSecret: string; practiceId: string; preview: boolean },
    { ok: boolean; redirectUri: string }
  >(functions, 'athenaSaveCredentials');
  const result = await fn({ clientId, clientSecret, practiceId, preview });
  return result.data;
}

export async function getAthenaAuthUrl(): Promise<{ url: string; redirectUri: string }> {
  const fn = httpsCallable<Record<string, never>, { url: string; redirectUri: string }>(
    functions,
    'athenaAuthorize',
  );
  const result = await fn({});
  return result.data;
}

export async function setAthenaEnabled(enabled: boolean): Promise<void> {
  const fn = httpsCallable<{ enabled: boolean }, { ok: boolean }>(
    functions,
    'athenaSetEnabled',
  );
  await fn({ enabled });
}

export async function disconnectAthena(): Promise<void> {
  await deleteDoc(doc(db, 'integrations', 'athena'));
}
