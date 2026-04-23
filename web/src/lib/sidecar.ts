/**
 * HTTP client for the Sidecar API.
 * Requests go through a Cloud Function proxy (sidecarProxy) which holds
 * the API key server-side. The client only sends the Firebase auth token.
 */

import { auth } from './firebase';

const PROXY_BASE = import.meta.env.VITE_SIDECAR_PROXY_URL || '';

export interface DrChronoPatient {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  cell_phone?: string;
  home_phone?: string;
  office_phone?: string;
  date_of_birth?: string;
  gender?: string;
  is_active?: boolean;
}

// ── Unified DrChrono patient lookup types (mirror sidecar/src/lib/drchrono.ts) ──

export interface DrChronoLookupQuery {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  drchronoId?: string | number;
}

export interface UnifiedDrChronoPatient {
  drchronoId: number;
  firstName: string;
  lastName: string;
  middleName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  patientStatus: string | null;
  email: string | null;
  cellPhone: string | null;
  homePhone: string | null;
  officePhone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  insurance: {
    carrier: string | null;
    policyNumber: string | null;
    groupNumber: string | null;
    planName: string | null;
  };
}

export interface DrChronoLookupResult {
  status: 'matched' | 'no-match' | 'skipped-multi' | 'error';
  matched: boolean;
  candidatesCount: number;
  exactMatchesCount: number;
  patient: UnifiedDrChronoPatient | null;
  candidates: UnifiedDrChronoPatient[] | null;
  errorMessage: string | null;
}

export interface DrChronoPatientDetails {
  allergies: { name: string; reaction: string | null; status: string | null }[];
  problems: { name: string; status: string | null; dateDiagnosed: string | null }[];
  appointments: {
    id: number;
    date: string | null;
    reason: string | null;
    status: string | null;
    duration: number | null;
    notesLocked: boolean;
  }[];
}

class SidecarClient {
  private proxyBase: string;

  constructor(proxyBase: string) {
    this.proxyBase = proxyBase.replace(/\/$/, '');
  }

  /** Check if sidecar proxy is configured */
  get isConfigured(): boolean {
    return !!this.proxyBase;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!this.isConfigured) {
      throw new Error('Sidecar not configured. Set VITE_SIDECAR_PROXY_URL.');
    }

    // Get Firebase auth token for the proxy
    const user = auth.currentUser;
    if (!user) throw new Error('Authentication required');
    const idToken = await user.getIdToken();

    let res: Response;
    try {
      res = await fetch(`${this.proxyBase}?path=${encodeURIComponent(path)}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
          ...options.headers,
        },
        signal: AbortSignal.timeout(90_000), // 90s client-side timeout
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new Error('Request timed out. The agent may be processing a complex request.');
      }
      throw new Error('Sidecar unreachable. The agent server may be offline.');
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Sidecar returned non-JSON response (${res.status}). Server may be misconfigured.`);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error || `Request failed: ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  // ── Chat ──────────────────────────────────────

  async chat(
    messages: { role: string; content: string }[],
    attachments?: { mimeType: string; content: string; name: string }[],
    options?: { support?: boolean },
  ): Promise<{ role: string; content: string }> {
    return this.request('/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages,
        attachments,
        ...(options?.support ? { support: true } : {}),
      }),
    });
  }

  /**
   * Streaming chat — POST /chat with Accept: text/event-stream, parse the
   * `data: {chunk:...}` lines as they arrive, fire `onChunk` for each text
   * fragment, and resolve with the full assembled reply when the stream
   * terminates. The chain is browser → sidecarProxy CF → sidecar → gateway,
   * each hop forwarding SSE without buffering.
   */
  async streamChat(args: {
    messages: { role: string; content: string }[];
    attachments?: { mimeType: string; content: string; name: string }[];
    support?: boolean;
    onChunk: (text: string) => void;
    signal?: AbortSignal;
  }): Promise<string> {
    if (!this.isConfigured) {
      throw new Error('Sidecar not configured. Set VITE_SIDECAR_PROXY_URL.');
    }
    const user = auth.currentUser;
    if (!user) throw new Error('Authentication required');
    const idToken = await user.getIdToken();

    const res = await fetch(
      `${this.proxyBase}?path=${encodeURIComponent('/chat')}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          messages: args.messages,
          attachments: args.attachments,
          ...(args.support ? { support: true } : {}),
        }),
        signal: args.signal,
      },
    );

    if (!res.ok || !res.body) {
      let detail = '';
      try {
        detail = ((await res.json()) as { error?: string }).error || '';
      } catch {
        /* not JSON */
      }
      throw new Error(detail || `Chat stream failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let assembled = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload) as {
            chunk?: string;
            done?: boolean;
          };
          if (typeof evt.chunk === 'string' && evt.chunk.length > 0) {
            assembled += evt.chunk;
            args.onChunk(evt.chunk);
          }
        } catch {
          /* ignore malformed event */
        }
      }
    }
    return assembled;
  }

  // ── Status ────────────────────────────────────

  async getStatus(): Promise<{ processStatus: string; healthy: boolean; version: string }> {
    return this.request('/status');
  }

  async getStats(): Promise<{
    memoryTotalMb: number;
    memoryUsedMb: number;
    uptimeSeconds: number;
    diskTotalGb: number;
    diskUsedGb: number;
    gatewayHealthy: boolean;
    version: string;
  }> {
    return this.request('/stats');
  }

  async restart(): Promise<{ ok: boolean; healthy: boolean }> {
    return this.request('/restart', { method: 'POST' });
  }

  // ── Skills ──────────────────────────────────────

  async listSkills(): Promise<{ skills: {
    id: string;
    name: string;
    description: string;
    icon: string;
    requiresWorkspace: boolean;
    enhancedByWorkspace: boolean;
    category: string;
    installed: boolean;
  }[] }> {
    return this.request('/skills');
  }

  async installSkill(id: string): Promise<{ ok: boolean }> {
    return this.request(`/skills/${id}/install`, { method: 'POST' });
  }

  async uninstallSkill(id: string): Promise<{ ok: boolean }> {
    return this.request(`/skills/${id}/uninstall`, { method: 'POST' });
  }

  // ── Files (workspace) ─────────────────────────

  async listFiles(pattern?: string): Promise<string[]> {
    const query = pattern ? `?pattern=${encodeURIComponent(pattern)}` : '';
    const data = await this.request<{ files: string[] }>(`/files${query}`);
    return data.files;
  }

  async readFile(path: string): Promise<string> {
    const data = await this.request<{ content: string }>(`/files/${path}`);
    return data.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.request(`/files/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  async deleteFile(path: string): Promise<void> {
    await this.request(`/files/${path}`, {
      method: 'DELETE',
    });
  }

  // ── Config ────────────────────────────────────

  async getConfig(): Promise<Record<string, unknown>> {
    return this.request('/config');
  }

  /**
   * Proxied Slack auth.test — handled inside the sidecarProxy Cloud Function,
   * NOT forwarded to the sidecar (slack.com blocks browser CORS preflights
   * that carry an Authorization header, so we call it server-side instead).
   */
  async slackAuthTest(botToken: string): Promise<{
    ok: boolean;
    team?: string;
    team_id?: string;
    error?: string;
  }> {
    return this.request('/slack/auth-test', {
      method: 'POST',
      body: JSON.stringify({ botToken }),
    });
  }

  async patchConfig(patch: Record<string, unknown>): Promise<void> {
    await this.request('/config', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  // ── Backups ───────────────────────────────────

  async createBackup(): Promise<{ name: string; sizeMb: number; createdAt: string }> {
    return this.request('/backup/create', { method: 'POST' });
  }

  async listBackups(): Promise<{ backups: { name: string; sizeMb: number; createdAt: string }[] }> {
    return this.request('/backup/list');
  }

  async restoreBackup(name: string): Promise<{ ok: boolean; safetyBackup: string }> {
    return this.request('/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async deleteBackup(name: string): Promise<void> {
    await this.request(`/backup/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  // ── Cron ────────────────────────────────────

  async listCronJobs(): Promise<any[]> {
    return this.request('/cron');
  }

  async addCronJob(params: {
    name: string;
    cron?: string;
    at?: string;
    tz?: string;
    message: string;
    session?: string;
    announce?: boolean;
  }): Promise<{ ok: boolean; output: string }> {
    return this.request('/cron', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async deleteCronJob(jobId: string): Promise<{ ok: boolean }> {
    return this.request(`/cron/${jobId}`, { method: 'DELETE' });
  }

  async runCronJob(jobId: string): Promise<{ ok: boolean; output: string }> {
    return this.request(`/cron/${jobId}/run`, { method: 'POST' });
  }

  async getCronRuns(jobId: string): Promise<any[]> {
    return this.request(`/cron/${jobId}/runs`);
  }

  // ── DrChrono ──────────────────────────────────

  /** Look up DrChrono patients by name. Exact-match filter is left to the
   *  caller — the sidecar returns whatever DrChrono's `patients` endpoint
   *  gives for the search. Requires integrations/drchrono enabled+active. */
  async drchronoSearchPatients(args: {
    firstName?: string;
    lastName?: string;
    pageSize?: number;
  }): Promise<DrChronoPatient[]> {
    const qs = new URLSearchParams();
    if (args.firstName) qs.set('first_name', args.firstName);
    if (args.lastName) qs.set('last_name', args.lastName);
    qs.set('page_size', String(args.pageSize ?? 25));
    const data = await this.request<
      { results: DrChronoPatient[] } | DrChronoPatient[]
    >(`/admin-api/drchrono/patients?${qs}`);
    return Array.isArray(data) ? data : data.results || [];
  }

  /** Fetch a single DrChrono patient by their DrChrono patient ID. */
  async drchronoGetPatient(id: string | number): Promise<DrChronoPatient> {
    return this.request<DrChronoPatient>(
      `/admin-api/drchrono/patients/${encodeURIComponent(String(id))}`,
    );
  }

  /** Unified patient lookup — aggregates name/email/phone/id into a single
   *  result shape ready for the admin UI. Requires integrations/drchrono
   *  enabled and the sidecar /admin-api/drchrono/patient-lookup endpoint. */
  async lookupDrChronoPatient(query: DrChronoLookupQuery): Promise<DrChronoLookupResult> {
    const qs = new URLSearchParams();
    if (query.firstName) qs.set('firstName', query.firstName);
    if (query.lastName) qs.set('lastName', query.lastName);
    if (query.email) qs.set('email', query.email);
    if (query.phone) qs.set('phone', query.phone);
    if (query.drchronoId !== undefined && query.drchronoId !== null && query.drchronoId !== '') {
      qs.set('drchronoId', String(query.drchronoId));
    }
    return this.request(`/admin-api/drchrono/patient-lookup?${qs}`);
  }

  async getDrChronoPatientDetails(drchronoId: number): Promise<DrChronoPatientDetails> {
    const qs = new URLSearchParams({ drchronoId: String(drchronoId) });
    return this.request(`/admin-api/drchrono/patient-details?${qs}`);
  }

  async lookupDrChronoPatientsBatch(items: { id: string; query: DrChronoLookupQuery }[]): Promise<{
    results: { id: string; query: DrChronoLookupQuery; result: DrChronoLookupResult }[];
  }> {
    return this.request('/admin-api/drchrono/patient-batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  // ── Faxes (sim-backed for now; real path still on Cloud Functions) ──

  async faxGetOurNumber(): Promise<string | null> {
    const data = await this.request<{ number: string | null }>('/admin-api/faxes/our-number');
    return data.number || null;
  }

  async faxInjectInbound(args: { from?: string; pages?: number } = {}): Promise<{ faxSid: string }> {
    return this.request('/admin-api/faxes/inject-inbound', {
      method: 'POST',
      body: JSON.stringify(args),
    });
  }

  async faxSend(args: { to: string; subject?: string; fileCount?: number }): Promise<{ faxSid: string; status: string; ok: boolean }> {
    return this.request('/admin-api/faxes/send', {
      method: 'POST',
      body: JSON.stringify(args),
    });
  }

  // ── Messaging (SMS; sim-backed today) ──

  async smsSend(args: { to: string; body: string; kind?: string }): Promise<{ sid: string; status: string; ok: boolean }> {
    return this.request('/admin-api/messaging/send', {
      method: 'POST',
      body: JSON.stringify(args),
    });
  }

  async smsInjectInbound(args: { from?: string; body?: string } = {}): Promise<{ sid: string; status: string }> {
    return this.request('/admin-api/messaging/inject-inbound', {
      method: 'POST',
      body: JSON.stringify(args),
    });
  }

  // ── Health ────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      const data = await this.request<{ ok: boolean }>('/healthz');
      return data.ok;
    } catch {
      return false;
    }
  }
}

export const sidecar = new SidecarClient(PROXY_BASE);
