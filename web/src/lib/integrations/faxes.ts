/**
 * Fax integration wrapper — sim vs real routing for inbound/outbound fax.
 *
 * Real path today:
 *   - Inbound: signalwireFaxWebhook Cloud Function writes `incoming-faxes/{id}`
 *   - Outbound: sendFax callable → SignalWire, writes `outbound-faxes/{id}`
 *   - Fax number lives in `integrations/signalwire.faxNumber`
 *
 * Sim path: same shape, backed by `simulation/faxes/*` in Firestore.
 */
import { integrationCall } from '../integration-call';

type SimFlag = { simulated: boolean };

export interface InboundFaxSummary {
  id: string;
  from: string;
  to: string;
  pages: number;
  status: 'received' | 'needs-review' | 'processing' | 'completed' | 'failed';
  receivedAt: string;
  pdfUrl?: string | null;
}

export interface OutboundFaxSummary {
  id: string;
  to: string;
  from: string;
  status: 'queued' | 'sending' | 'delivered' | 'failed';
  sentAt: string | null;
  pages: number;
}

/**
 * Returns the fax number the practice sends/receives on. In sim mode a
 * reserved fake number (so nothing can accidentally dial it); otherwise
 * the configured SignalWire number from `integrations/signalwire`.
 */
export async function getOurFaxNumber(opts: SimFlag): Promise<string | null> {
  if (opts.simulated) {
    const res = await integrationCall<{ number: string }>({
      integration: 'faxes',
      operation: 'get_our_number',
      simulated: true,
    });
    return res.data.number || null;
  }
  // Real path: caller reads `integrations/signalwire.faxNumber` directly.
  // Kept here as a single import surface; returning null means "not in sim,
  // read the integration doc". Callers already do that today.
  return null;
}

export async function listInbound(opts: SimFlag): Promise<InboundFaxSummary[]> {
  if (opts.simulated) {
    const res = await integrationCall<{ results: InboundFaxSummary[] }>({
      integration: 'faxes',
      operation: 'list_inbound',
      simulated: true,
    });
    return res.data.results || [];
  }
  // Real path: AdminFaxesPage subscribes to `incoming-faxes` directly.
  // Returning [] here keeps the wrapper signature stable; callers check
  // `simulated` first and skip the wrapper in real mode.
  return [];
}

export async function listOutbound(opts: SimFlag): Promise<OutboundFaxSummary[]> {
  if (opts.simulated) {
    const res = await integrationCall<{ results: OutboundFaxSummary[] }>({
      integration: 'faxes',
      operation: 'list_outbound',
      simulated: true,
    });
    return res.data.results || [];
  }
  return [];
}

/**
 * Simulated helper: seeds a new inbound fax doc under `simulation/faxes/inbound`
 * so admins can exercise the inbound review flow without SignalWire.
 */
export async function injectInbound(
  args: { from?: string; pages?: number } = {},
  opts: SimFlag,
): Promise<{ id: string }> {
  if (!opts.simulated) {
    throw new Error('injectInbound is only available in simulation mode');
  }
  const res = await integrationCall<{ id: string }>({
    integration: 'faxes',
    operation: 'inject_inbound',
    params: args,
    simulated: true,
  });
  return res.data;
}

export interface SendFaxArgs {
  to: string;
  pdfBase64: string;
  filename?: string;
  coverNote?: string;
}

export async function sendFax(args: SendFaxArgs, opts: SimFlag): Promise<{ id: string; status: string }> {
  if (opts.simulated) {
    const res = await integrationCall<{ id: string; status: string }>({
      integration: 'faxes',
      operation: 'send_fax',
      params: args as unknown as Record<string, unknown>,
      simulated: true,
    });
    return res.data;
  }
  throw new Error('Real-path sendFax must go through the sendFax callable; wrapper is sim-only for now.');
}
