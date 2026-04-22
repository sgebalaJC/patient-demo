/**
 * Thin client for the eClinicalWorks (SMART-on-FHIR) integration.
 */

import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { db, functions } from './firebase';

export interface EcwIntegration {
  provider: string;
  enabled?: boolean;
  status?: 'active' | 'not-authorized' | string;
  clientId?: string;
  fhirBase?: string;
  authUrl?: string;
  tokenUrl?: string;
  scope?: string;
  grantedScope?: string;
  redirectUri?: string;
  tokenExpiresAt?: { seconds: number; nanoseconds: number } | null;
  connectedAt?: unknown;
  updatedAt?: unknown;
  connectedBy?: string;
}

export async function getEcwStatus(): Promise<EcwIntegration | null> {
  const snap = await getDoc(doc(db, 'integrations', 'ecw'));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  return {
    provider: (d.provider as string) || 'ecw',
    enabled: Boolean(d.enabled),
    status: d.status as EcwIntegration['status'],
    clientId: d.clientId as string | undefined,
    fhirBase: d.fhirBase as string | undefined,
    authUrl: d.authUrl as string | undefined,
    tokenUrl: d.tokenUrl as string | undefined,
    scope: d.scope as string | undefined,
    grantedScope: d.grantedScope as string | undefined,
    redirectUri: d.redirectUri as string | undefined,
    tokenExpiresAt: (d.tokenExpiresAt as EcwIntegration['tokenExpiresAt']) ?? null,
    connectedAt: d.connectedAt,
    updatedAt: d.updatedAt,
    connectedBy: d.connectedBy as string | undefined,
  };
}

export interface SaveEcwArgs {
  clientId: string;
  clientSecret: string;
  fhirBase: string;
  authUrl: string;
  tokenUrl: string;
  scope?: string;
}

export async function saveEcwCredentials(
  args: SaveEcwArgs,
): Promise<{ ok: boolean; redirectUri: string }> {
  const fn = httpsCallable<SaveEcwArgs, { ok: boolean; redirectUri: string }>(
    functions,
    'ecwSaveCredentials',
  );
  const result = await fn(args);
  return result.data;
}

export async function getEcwAuthUrl(): Promise<{ url: string; redirectUri: string }> {
  const fn = httpsCallable<Record<string, never>, { url: string; redirectUri: string }>(
    functions,
    'ecwAuthorize',
  );
  const result = await fn({});
  return result.data;
}

export async function setEcwEnabled(enabled: boolean): Promise<void> {
  const fn = httpsCallable<{ enabled: boolean }, { ok: boolean }>(functions, 'ecwSetEnabled');
  await fn({ enabled });
}

export async function disconnectEcw(): Promise<void> {
  await deleteDoc(doc(db, 'integrations', 'ecw'));
}
