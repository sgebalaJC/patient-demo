import React, { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminGuard } from '../components/ui/AdminGuard';
import { AgentChat } from '../components/agent/AgentChat';
import { AgentSkills } from '../components/agent/AgentSkills';
import { AgentChannels } from '../components/agent/AgentChannels';
import { AgentBackups } from '../components/agent/AgentBackups';
import { AgentHealth } from '../components/agent/AgentHealth';
import { DrChronoSetup } from '../components/agent/DrChronoSetup';
import { AthenaSetup } from '../components/agent/AthenaSetup';
import { ElationSetup } from '../components/agent/ElationSetup';
import { EcwSetup } from '../components/agent/EcwSetup';
import { sidecar } from '../lib/sidecar';
import { useAuth } from '../hooks/useAuth';
import { isSuperAdminEmail } from '../lib/roles';
import {
  ArrowLeft,
  MessageSquare,
  Star,
  Archive,
  Activity,
  Radio,
  Bot,
  Plug,
} from 'lucide-react';

type Tab = 'chat' | 'skills' | 'channels' | 'integrations' | 'backups' | 'health';

const ALL_NAV_ITEMS: { key: Tab; label: string; icon: React.ElementType; superAdminOnly?: boolean }[] = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'skills', label: 'Skills', icon: Star },
  { key: 'channels', label: 'Channels', icon: Radio },
  { key: 'integrations', label: 'Integrations', icon: Plug, superAdminOnly: true },
  { key: 'backups', label: 'Backups', icon: Archive, superAdminOnly: true },
  { key: 'health', label: 'Health', icon: Activity },
];

const IntegrationsPanel: React.FC = () => (
  <div className="flex-1 overflow-y-auto p-6">
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-secondary-900">EHR Integrations</h2>
        <p className="text-sm text-secondary-500 mt-1">
          Platform-level connections. Super-admin only — credentials are stored encrypted at rest and never
          exposed to practice admins.
        </p>
      </div>
      <div className="space-y-3">
        <DrChronoSetup />
        <AthenaSetup />
        <ElationSetup />
        <EcwSetup />
      </div>
    </div>
  </div>
);

export const AgentPage: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = isSuperAdminEmail(user?.email);
  const NAV_ITEMS = useMemo(
    () => ALL_NAV_ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin),
    [isSuperAdmin],
  );
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'chat';
  const [activeTab, setActiveTab] = useState<Tab>(
    NAV_ITEMS.some((n) => n.key === initialTab) ? initialTab : 'chat'
  );
  const [healthy, setHealthy] = useState<boolean | null>(null);

  // Poll status every 30s
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const status = await sidecar.getStatus();
        if (!cancelled) setHealthy(status.healthy);
      } catch {
        if (!cancelled) setHealthy(false);
      }
    };

    check();
    const interval = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const sidecarConfigured = sidecar.isConfigured;

  const renderContent = () => {
    if (!sidecarConfigured) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md">
            <Bot className="h-12 w-12 text-secondary-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-secondary-900 mb-2">Agent Not Connected</h3>
            <p className="text-secondary-600 text-sm">
              The AI Agent sidecar is not configured. Set <code className="bg-secondary-100 px-1 rounded text-xs">VITE_SIDECAR_PROXY_URL</code> in apphosting.yaml to connect.
            </p>
          </div>
        </div>
      );
    }

    if (healthy === false) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md">
            <Bot className="h-12 w-12 text-red-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-secondary-900 mb-2">Agent Offline</h3>
            <p className="text-secondary-600 text-sm mb-4">
              The AI Agent server is not responding. It may be restarting or experiencing issues.
            </p>
            <button
              onClick={() => setHealthy(null)}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    switch (activeTab) {
      case 'chat':
        return <AgentChat />;
      case 'skills':
        return <AgentSkills />;
      case 'channels':
        return <AgentChannels />;
      case 'integrations':
        return isSuperAdmin ? <IntegrationsPanel /> : <AgentChat />;
      case 'backups':
        return isSuperAdmin ? <AgentBackups /> : <AgentChat />;
      case 'health':
        return <AgentHealth />;
    }
  };

  return (
    <AdminGuard>
    <div className="flex flex-1 min-h-0 overflow-hidden bg-surface-card">
      {/* Sidebar — desktop */}
      <nav className="w-48 shrink-0 border-r border-secondary-200 bg-surface-card pt-4 hidden md:flex md:flex-col">
        {/* Back link */}
        <div className="px-4 mb-4">
          <Link
            to="/admin"
            className="flex items-center gap-2 text-secondary-600 hover:text-primary-600 transition-colors text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            <Bot className="h-4 w-4" />
            <span className="font-semibold">AI Agent</span>
          </Link>
        </div>

        {/* Nav items */}
        <div className="flex-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-primary-50 text-primary-700 font-medium border-l-2 border-primary-600'
                    : 'text-secondary-600 hover:text-secondary-900 hover:bg-secondary-50 border-l-2 border-transparent'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}

        </div>

        {/* Status indicator */}
        <div className="px-4 min-h-[60px] flex items-center">
          <div className="flex items-center gap-2 text-xs text-secondary-500">
            <span
              className={`h-2 w-2 rounded-full ${
                healthy === null
                  ? 'bg-secondary-300'
                  : healthy
                    ? 'bg-green-500'
                    : 'bg-red-500'
              }`}
            />
            {healthy === null ? 'Checking...' : healthy ? 'Online' : 'Offline'}
          </div>
        </div>
      </nav>

      {/* Mobile tabs */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-10 bg-surface-card border-t border-secondary-200 flex">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs ${
                isActive ? 'text-primary-600' : 'text-secondary-400'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-surface-card">
        {renderContent()}
      </main>
    </div>
    </AdminGuard>
  );
};
