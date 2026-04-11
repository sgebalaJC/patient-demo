/**
 * HTTP client for the Sidecar API.
 * Requests go through a Cloud Function proxy (sidecarProxy) which holds
 * the API key server-side. The client only sends the Firebase auth token.
 */

import { auth } from './firebase';

const PROXY_BASE = import.meta.env.VITE_SIDECAR_PROXY_URL || '';

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
    attachments?: { mimeType: string; content: string; name: string }[]
  ): Promise<{ role: string; content: string }> {
    return this.request('/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, attachments }),
    });
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
