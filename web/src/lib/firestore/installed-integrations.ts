import { doc, getDoc, onSnapshot, Timestamp, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase';
import type { ApiResponse } from '../../types';
import { errorMessage } from '../errors';
import logger from '../logger';

/**
 * Per-integration deployment record. Written by:
 *  - `enableIntegration` callable on submit (status='deploying')
 *  - inline Cloud Build step on terminal status (status='deployed'|'failed')
 *
 * Read by:
 *  - admin UI (per-integration deploy control) to surface live status +
 *    bundle version it was deployed from
 *  - maintainer's future cross-fork update tool to know which forks have
 *    integration X installed and need a redeploy
 *
 * Doc id = integration group id (`ehr-drchrono`, `signalwire`, etc).
 */
export interface InstalledIntegration {
  integrationId: string;
  status: 'deploying' | 'deployed' | 'failed' | 'pending';
  deployedFunctions: string[];
  deployedAt: Timestamp | null;
  /** Bundle version deployed from (e.g. `2026-04-26T22-30-00Z-4f5208e`). */
  deployedFromBundle?: string;
  lastBuildId?: string;
  lastBuildStartedAt?: Timestamp | null;
  lastBuildFinishedAt?: Timestamp | null;
  lastBuildStatus?: string;
}

const collectionPath = 'installed-integrations';

function normalize(integrationId: string, data: Record<string, unknown> | undefined): InstalledIntegration {
  return {
    integrationId,
    status: ((data?.status as InstalledIntegration['status']) ?? 'pending'),
    deployedFunctions: (data?.deployedFunctions as string[]) ?? [],
    deployedAt: data?.deployedAt instanceof Timestamp ? (data.deployedAt as Timestamp) : null,
    deployedFromBundle: typeof data?.deployedFromBundle === 'string' ? (data.deployedFromBundle as string) : undefined,
    lastBuildId: typeof data?.lastBuildId === 'string' ? (data.lastBuildId as string) : undefined,
    lastBuildStartedAt: data?.lastBuildStartedAt instanceof Timestamp ? (data.lastBuildStartedAt as Timestamp) : null,
    lastBuildFinishedAt: data?.lastBuildFinishedAt instanceof Timestamp ? (data.lastBuildFinishedAt as Timestamp) : null,
    lastBuildStatus: typeof data?.lastBuildStatus === 'string' ? (data.lastBuildStatus as string) : undefined,
  };
}

export const installedIntegrationsOps = {
  async get(integrationId: string): Promise<ApiResponse<InstalledIntegration | null>> {
    try {
      const ref = doc(db, collectionPath, integrationId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { success: true, data: null };
      return { success: true, data: normalize(integrationId, snap.data() as Record<string, unknown>) };
    } catch (error: unknown) {
      logger.error('Error reading installed-integrations:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  /** Live subscription so the admin UI updates as the Cloud Build progresses. */
  subscribe(integrationId: string, callback: (state: InstalledIntegration | null) => void): Unsubscribe {
    const ref = doc(db, collectionPath, integrationId);
    return onSnapshot(
      ref,
      (snap) => callback(snap.exists() ? normalize(integrationId, snap.data() as Record<string, unknown>) : null),
      (err) => {
        logger.error('installed-integrations subscription error:', err);
        callback(null);
      },
    );
  },
};
