/**
 * Thin client for the Tebra (Kareo) integration.
 */

import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { db, functions } from './firebase';

export interface TebraIntegration {
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
}

export async function getTebraStatus(): Promise<TebraIntegration | null> {
  const snap = await getDoc(doc(db, 'integrations', 'tebra'));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  return {
    provider: (d.provider as string) || 'tebra',
    enabled: Boolean(d.enabled),
    status: d.status as TebraIntegration['status'],
    clientId: d.clientId as string | undefined,
    redirectUri: d.redirectUri as string | undefined,
    scope: d.scope as string | undefined,
    tokenExpiresAt: (d.tokenExpiresAt as TebraIntegration['tokenExpiresAt']) ?? null,
    connectedAt: d.connectedAt,
    updatedAt: d.updatedAt,
    connectedBy: d.connectedBy as string | undefined,
  };
}

export async function saveTebraCredentials(
  clientId: string,
  clientSecret: string,
): Promise<{ ok: boolean; redirectUri: string }> {
  const fn = httpsCallable<
    { clientId: string; clientSecret: string },
    { ok: boolean; redirectUri: string }
  >(functions, 'tebraSaveCredentials');
  const result = await fn({ clientId, clientSecret });
  return result.data;
}

export async function getTebraAuthUrl(): Promise<{ url: string; redirectUri: string }> {
  const fn = httpsCallable<Record<string, never>, { url: string; redirectUri: string }>(
    functions,
    'tebraAuthorize',
  );
  const result = await fn({});
  return result.data;
}

export async function setTebraEnabled(enabled: boolean): Promise<void> {
  const fn = httpsCallable<{ enabled: boolean }, { ok: boolean }>(
    functions,
    'tebraSetEnabled',
  );
  await fn({ enabled });
}

export async function disconnectTebra(): Promise<void> {
  await deleteDoc(doc(db, 'integrations', 'tebra'));
}
