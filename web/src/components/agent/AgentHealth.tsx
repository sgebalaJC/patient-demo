import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Server, Cpu, HardDrive, Clock, Wifi, WifiOff } from 'lucide-react';
import { sidecar } from '../../lib/sidecar';

interface Stats {
  memoryTotalMb: number;
  memoryUsedMb: number;
  uptimeSeconds: number;
  diskTotalGb: number;
  diskUsedGb: number;
  gatewayHealthy: boolean;
  version: string;
}

interface Status {
  processStatus: string;
  healthy: boolean;
  version: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="w-full bg-secondary-200 rounded-full h-2">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export const AgentHealth: React.FC = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, st] = await Promise.all([sidecar.getStatus(), sidecar.getStats()]);
      setStatus(s);
      setStats(st);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const memPct = stats ? (stats.memoryUsedMb / stats.memoryTotalMb) * 100 : 0;
  const diskPct = stats ? (stats.diskUsedGb / stats.diskTotalGb) * 100 : 0;

  return (
    <div className="p-6 space-y-6 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-secondary-900">Health Status</h2>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-secondary-500 hover:text-secondary-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Service Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Gateway */}
        <div className="bg-surface-card border border-secondary-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-secondary-500" />
              <span className="text-sm font-medium text-secondary-900">Gateway</span>
            </div>
            {status ? (
              <span className={`flex items-center gap-1.5 text-xs font-medium ${
                status.healthy ? 'text-green-600' : 'text-red-600'
              }`}>
                {status.healthy ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {status.healthy ? 'Online' : 'Offline'}
              </span>
            ) : (
              <span className="text-xs text-secondary-400">—</span>
            )}
          </div>
          {status && (
            <div className="text-xs text-secondary-500 space-y-1">
              <div>Process: {status.processStatus}</div>
              <div>Version: {status.version}</div>
            </div>
          )}
        </div>

        {/* Sidecar */}
        <div className="bg-surface-card border border-secondary-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-secondary-500" />
              <span className="text-sm font-medium text-secondary-900">Sidecar</span>
            </div>
            {stats ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                <Wifi className="h-3 w-3" />
                Online
              </span>
            ) : error ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-red-600">
                <WifiOff className="h-3 w-3" />
                Offline
              </span>
            ) : (
              <span className="text-xs text-secondary-400">—</span>
            )}
          </div>
          {stats && (
            <div className="text-xs text-secondary-500">
              Version: {stats.version}
            </div>
          )}
        </div>
      </div>

      {/* Resource Usage */}
      {stats && (
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-secondary-500 uppercase tracking-wide">Resources</h3>

          {/* Uptime */}
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-secondary-400" />
            <div>
              <div className="text-sm font-medium text-secondary-900">Uptime</div>
              <div className="text-xs text-secondary-500">{formatUptime(stats.uptimeSeconds)}</div>
            </div>
          </div>

          {/* Memory */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-secondary-400" />
                <span className="text-sm font-medium text-secondary-900">Memory</span>
              </div>
              <span className="text-xs text-secondary-500">
                {stats.memoryUsedMb.toFixed(0)} / {stats.memoryTotalMb.toFixed(0)} MB ({memPct.toFixed(0)}%)
              </span>
            </div>
            <ProgressBar
              value={stats.memoryUsedMb}
              max={stats.memoryTotalMb}
              color={memPct > 90 ? 'bg-red-500' : memPct > 70 ? 'bg-amber-500' : 'bg-green-500'}
            />
          </div>

          {/* Disk */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-secondary-400" />
                <span className="text-sm font-medium text-secondary-900">Disk</span>
              </div>
              <span className="text-xs text-secondary-500">
                {stats.diskUsedGb.toFixed(1)} / {stats.diskTotalGb.toFixed(1)} GB ({diskPct.toFixed(0)}%)
              </span>
            </div>
            <ProgressBar
              value={stats.diskUsedGb}
              max={stats.diskTotalGb}
              color={diskPct > 90 ? 'bg-red-500' : diskPct > 70 ? 'bg-amber-500' : 'bg-green-500'}
            />
          </div>
        </div>
      )}
    </div>
  );
};
