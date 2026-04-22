/**
 * DrChrono integration wrapper — routes through the sim simulator when
 * simulation mode is on, otherwise calls the sidecar directly.
 */
import { sidecar, type DrChronoLookupQuery, type DrChronoLookupResult, type DrChronoPatient, type DrChronoPatientDetails } from '../sidecar';
import { integrationCall } from '../integration-call';

type SimFlag = { simulated: boolean };

export async function lookupPatient(
  query: DrChronoLookupQuery,
  opts: SimFlag,
): Promise<DrChronoLookupResult> {
  if (opts.simulated) {
    const res = await integrationCall<DrChronoLookupResult>({
      integration: 'drchrono',
      operation: 'patient_lookup',
      params: query as unknown as Record<string, unknown>,
      simulated: true,
    });
    return res.data;
  }
  return sidecar.lookupDrChronoPatient(query);
}

export async function lookupPatientsBatch(
  items: { id: string; query: DrChronoLookupQuery }[],
  opts: SimFlag,
): Promise<{ results: { id: string; query: DrChronoLookupQuery; result: DrChronoLookupResult }[] }> {
  if (opts.simulated) {
    const results = await Promise.all(
      items.map(async ({ id, query }) => ({
        id,
        query,
        result: await lookupPatient(query, opts),
      })),
    );
    return { results };
  }
  return sidecar.lookupDrChronoPatientsBatch(items);
}

export async function searchPatients(
  args: { firstName?: string; lastName?: string; pageSize?: number },
  opts: SimFlag,
): Promise<DrChronoPatient[]> {
  if (opts.simulated) {
    const res = await integrationCall<{ results: DrChronoPatient[] }>({
      integration: 'drchrono',
      operation: 'list_patients',
      params: {
        first_name: args.firstName,
        last_name: args.lastName,
        page_size: args.pageSize,
      },
      simulated: true,
    });
    return res.data.results || [];
  }
  return sidecar.drchronoSearchPatients(args);
}

export async function getPatient(
  id: string | number,
  opts: SimFlag,
): Promise<DrChronoPatient> {
  if (opts.simulated) {
    const res = await integrationCall<DrChronoPatient>({
      integration: 'drchrono',
      operation: 'get_patient',
      params: { id },
      simulated: true,
    });
    return res.data;
  }
  return sidecar.drchronoGetPatient(id);
}

export async function getPatientDetails(
  drchronoId: number,
  opts: SimFlag,
): Promise<DrChronoPatientDetails> {
  if (opts.simulated) {
    const res = await integrationCall<DrChronoPatientDetails>({
      integration: 'drchrono',
      operation: 'patient_details',
      params: { drchronoId },
      simulated: true,
    });
    return res.data;
  }
  return sidecar.getDrChronoPatientDetails(drchronoId);
}
