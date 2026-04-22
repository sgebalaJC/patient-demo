/**
 * Generic admin-facing client for EHR OAuth integrations.
 *
 * One set of functions drives all providers. The Cloud Function name
 * prefix is derived from the provider id — `drchrono` → `drchronoSaveCredentials`,
 * etc. Whitelists non-secret fields on Firestore reads so secrets never
 * reach the browser even if the Firestore rule loosens in the future.
 */

import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';

export interface IntegrationStatus {
  provider: string;
  enabled: boolean;
  status: string;
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  tokenExpiresAt?: { seconds: number; nanoseconds: number } | null;
  connectedAt?: unknown;
  updatedAt?: unknown;
  connectedBy?: string;
  /** Extra provider-specific non-secret fields (practiceId, sandbox, preview, fhirBase, …). */
  [extra: string]: unknown;
}

const SECRET_KEYS = new Set(['clientSecret', 'accessToken', 'refreshToken']);

export async function getIntegrationStatus(
  providerId: string,
): Promise<IntegrationStatus | null> {
  const snap = await getDoc(doc(db, 'integrations', providerId));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  const out: IntegrationStatus = {
    provider: (d.provider as string) || providerId,
    enabled: Boolean(d.enabled),
    status: (d.status as string) || 'not-authorized',
  };
  // Copy all non-secret fields through.
  for (const [k, v] of Object.entries(d)) {
    if (SECRET_KEYS.has(k)) continue;
    if (k === 'provider' || k === 'enabled' || k === 'status') continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export async function saveIntegrationCredentials(
  providerId: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; redirectUri: string }> {
  const fnName = `${providerId}SaveCredentials`;
  const fn = httpsCallable<Record<string, unknown>, { ok: boolean; redirectUri: string }>(
    functions,
    fnName,
  );
  const result = await fn(payload);
  return result.data;
}

export async function getIntegrationAuthUrl(
  providerId: string,
): Promise<{ url: string; redirectUri: string }> {
  const fnName = `${providerId}Authorize`;
  const fn = httpsCallable<Record<string, never>, { url: string; redirectUri: string }>(
    functions,
    fnName,
  );
  const result = await fn({});
  return result.data;
}

export async function setIntegrationEnabled(
  providerId: string,
  enabled: boolean,
): Promise<void> {
  const fnName = `${providerId}SetEnabled`;
  const fn = httpsCallable<{ enabled: boolean }, { ok: boolean }>(functions, fnName);
  await fn({ enabled });
}

export async function disconnectIntegration(providerId: string): Promise<void> {
  await deleteDoc(doc(db, 'integrations', providerId));
}
