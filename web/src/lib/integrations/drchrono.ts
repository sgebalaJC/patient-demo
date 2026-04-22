/**
 * DrChrono integration façade. All calls hit the sidecar — the sidecar's
 * own sim branch decides sim vs real based on `system/settings.simulationMode`.
 * This module exists for typing + one import surface; it holds no routing
 * logic of its own.
 */
import { sidecar, type DrChronoLookupQuery, type DrChronoLookupResult, type DrChronoPatient, type DrChronoPatientDetails } from '../sidecar';

export async function lookupPatient(query: DrChronoLookupQuery): Promise<DrChronoLookupResult> {
  return sidecar.lookupDrChronoPatient(query);
}

export async function lookupPatientsBatch(
  items: { id: string; query: DrChronoLookupQuery }[],
): Promise<{ results: { id: string; query: DrChronoLookupQuery; result: DrChronoLookupResult }[] }> {
  return sidecar.lookupDrChronoPatientsBatch(items);
}

export async function searchPatients(
  args: { firstName?: string; lastName?: string; pageSize?: number },
): Promise<DrChronoPatient[]> {
  return sidecar.drchronoSearchPatients(args);
}

export async function getPatient(id: string | number): Promise<DrChronoPatient> {
  return sidecar.drchronoGetPatient(id);
}

export async function getPatientDetails(drchronoId: number): Promise<DrChronoPatientDetails> {
  return sidecar.getDrChronoPatientDetails(drchronoId);
}
