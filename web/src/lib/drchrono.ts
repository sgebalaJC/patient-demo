/**
 * DrChrono-specific UI helpers consumed outside the Integrations setup UI.
 *
 * The admin-facing OAuth flow has moved to the generic registry + setup:
 *   - web/src/lib/integrations/registry.ts   (provider def)
 *   - web/src/lib/integrations/ehr-admin.ts  (callable + Firestore client)
 *   - web/src/components/agent/EhrSetup.tsx  (UI)
 *
 * This file keeps the small chart-URL helper used by `UnifiedPatientCard`,
 * which needs the practice subdomain for deep links into the DrChrono chart.
 */

import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

export interface DrChronoIntegration {
  provider: string;
  enabled?: boolean;
  status?: 'active' | 'not-authorized' | string;
  /** Practice subdomain for chart URLs, e.g. "acme" → acme.drchrono.com/chart/<id>/summary.
   *  `app.drchrono.com` 404s on per-practice chart links, so admins set this
   *  once in the integration UI. */
  practiceSubdomain?: string;
}

/** Build a browsable chart URL for a DrChrono patient id. Falls back to
 *  app.drchrono.com — which 404s for many practices — if no subdomain is set. */
export function drchronoChartUrl(patientId: number, subdomain?: string): string {
  if (subdomain) return `https://${subdomain}.drchrono.com/chart/${patientId}/summary`;
  return `https://app.drchrono.com/patient/chart/${patientId}/`;
}

/** Lightweight status read used only by `UnifiedPatientCard` to populate the
 *  chart-URL subdomain cache. The Firestore rule allows `isSuperAdmin()` read
 *  only; non-super-admin admins get a permission denied and the card falls
 *  back to the generic app.drchrono.com URL (see UnifiedPatientCard). */
export async function getDrChronoStatus(): Promise<DrChronoIntegration | null> {
  const snap = await getDoc(doc(db, 'integrations', 'drchrono'));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  return {
    provider: (d.provider as string) || 'drchrono',
    enabled: Boolean(d.enabled),
    status: d.status as DrChronoIntegration['status'],
    practiceSubdomain: d.practiceSubdomain as string | undefined,
  };
}
