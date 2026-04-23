/**
 * In-memory cache for DrChrono patient extras (allergies/problems/appointments)
 * scoped to the current browser tab. Cleared on reload — no persistence.
 */

import type { DrChronoPatientDetails } from './sidecar';

const detailsCache = new Map<number, DrChronoPatientDetails>();

export function getCachedPatientDetails(drchronoId: number): DrChronoPatientDetails | null {
  return detailsCache.get(drchronoId) ?? null;
}

export function setCachedPatientDetails(drchronoId: number, details: DrChronoPatientDetails): void {
  detailsCache.set(drchronoId, details);
}
