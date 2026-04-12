import React, { useState, useEffect } from 'react';
import { Link2, MessageCircle, Plug, RefreshCw } from 'lucide-react';
import { sidecar } from '../../lib/sidecar';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { GoogleWorkspaceSetup } from './GoogleWorkspaceSetup';

interface ChannelInfo {
  name: string;
  enabled: boolean;
}

interface PluginInfo {
  name: string;
  enabled: boolean;
}

export const AgentIntegrations: React.FC = () => {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadConfig = async () => {
    setLoading(true);
    setError('');
    try {
      const config = await sidecar.getConfig();
      const agentConfig = config as {
        channels?: Record<string, { enabled?: boolean } & Record<string, unknown>>;
        plugins?: { entries?: Record<string, { enabled?: boolean }> };
        agents?: { defaults?: { model?: { primary?: string } } };
      };

      const channelList: ChannelInfo[] = [];
      if (agentConfig.channels) {
        for (const [name, ch] of Object.entries(agentConfig.channels)) {
          channelList.push({ name, enabled: ch.enabled !== false });
        }
      }
      setChannels(channelList);

      const pluginList: PluginInfo[] = [];
      if (agentConfig.plugins?.entries) {
        for (const [name, pl] of Object.entries(agentConfig.plugins.entries)) {
          pluginList.push({ name, enabled: pl.enabled !== false });
        }
      }
      setPlugins(pluginList);

      setModel(agentConfig.agents?.defaults?.model?.primary || 'unknown');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-secondary-900">Integrations</h2>
          <p className="text-sm text-secondary-500 mt-0.5">External services connected to the agent</p>
        </div>
        <button
          onClick={loadConfig}
          className="flex items-center gap-1.5 text-sm text-secondary-500 hover:text-primary-600 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* Google Workspace — interactive card */}
        <GoogleWorkspaceSetup onStateChange={loadConfig} />

        {/* Agent config (channels, plugins, model) */}
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="text-center py-4">
            <p className="text-red-500 text-sm mb-2">{error}</p>
            <button onClick={loadConfig} className="text-sm text-primary-600 hover:underline">
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* Model */}
            <div className="card p-4">
              <div className="flex items-center gap-3">
                <div className="bg-primary-100 p-2 rounded-lg">
                  <Plug className="h-5 w-5 text-primary-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-secondary-900">Model</h3>
                  <p className="text-xs text-secondary-500 mt-0.5">{model}</p>
                </div>
              </div>
            </div>

            {/* Channels */}
            {channels.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-secondary-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <MessageCircle className="h-4 w-4" />
                  Channels
                </h3>
                <div className="space-y-2">
                  {channels.map((ch) => (
                    <div key={ch.name} className="card p-4 flex items-center gap-3">
                      <span className={`h-2 w-2 rounded-full ${ch.enabled ? 'bg-green-500' : 'bg-secondary-300'}`} />
                      <span className="text-sm font-medium text-secondary-900 capitalize flex-1">{ch.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        ch.enabled ? 'bg-green-100 text-green-700' : 'bg-secondary-100 text-secondary-500'
                      }`}>
                        {ch.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Plugins */}
            {plugins.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-secondary-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Link2 className="h-4 w-4" />
                  Plugins
                </h3>
                <div className="space-y-2">
                  {plugins.map((pl) => (
                    <div key={pl.name} className="card p-4 flex items-center gap-3">
                      <span className={`h-2 w-2 rounded-full ${pl.enabled ? 'bg-green-500' : 'bg-secondary-300'}`} />
                      <span className="text-sm font-medium text-secondary-900 capitalize">{pl.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        pl.enabled ? 'bg-green-100 text-green-700' : 'bg-secondary-100 text-secondary-500'
                      }`}>
                        {pl.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
