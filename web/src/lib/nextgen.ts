/**
 * Thin client for the NextGen Healthcare integration.
 */

import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { db, functions } from './firebase';

export interface NextGenIntegration {
  provider: string;
  enabled?: boolean;
  status?: 'active' | 'not-authorized' | string;
  clientId?: string;
  sandbox?: boolean;
  redirectUri?: string;
  scope?: string;
  tokenExpiresAt?: { seconds: number; nanoseconds: number } | null;
  connectedAt?: unknown;
  updatedAt?: unknown;
  connectedBy?: string;
}

export async function getNextGenStatus(): Promise<NextGenIntegration | null> {
  const snap = await getDoc(doc(db, 'integrations', 'nextgen'));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  return {
    provider: (d.provider as string) || 'nextgen',
    enabled: Boolean(d.enabled),
    status: d.status as NextGenIntegration['status'],
    clientId: d.clientId as string | undefined,
    sandbox: Boolean(d.sandbox),
    redirectUri: d.redirectUri as string | undefined,
    scope: d.scope as string | undefined,
    tokenExpiresAt: (d.tokenExpiresAt as NextGenIntegration['tokenExpiresAt']) ?? null,
    connectedAt: d.connectedAt,
    updatedAt: d.updatedAt,
    connectedBy: d.connectedBy as string | undefined,
  };
}

export async function saveNextGenCredentials(
  clientId: string,
  clientSecret: string,
  sandbox: boolean,
): Promise<{ ok: boolean; redirectUri: string }> {
  const fn = httpsCallable<
    { clientId: string; clientSecret: string; sandbox: boolean },
    { ok: boolean; redirectUri: string }
  >(functions, 'nextgenSaveCredentials');
  const result = await fn({ clientId, clientSecret, sandbox });
  return result.data;
}

export async function getNextGenAuthUrl(): Promise<{ url: string; redirectUri: string }> {
  const fn = httpsCallable<Record<string, never>, { url: string; redirectUri: string }>(
    functions,
    'nextgenAuthorize',
  );
  const result = await fn({});
  return result.data;
}

export async function setNextGenEnabled(enabled: boolean): Promise<void> {
  const fn = httpsCallable<{ enabled: boolean }, { ok: boolean }>(
    functions,
    'nextgenSetEnabled',
  );
  await fn({ enabled });
}

export async function disconnectNextGen(): Promise<void> {
  await deleteDoc(doc(db, 'integrations', 'nextgen'));
}
