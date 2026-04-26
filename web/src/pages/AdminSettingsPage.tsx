import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Toggle } from '../components/ui/Toggle';
import { useAuth } from '../hooks/useAuth';
import { isSuperAdminEmail } from '../lib/roles';
import { useAppSettings } from '../contexts/AppSettingsContext';
import { SmsTemplateEditor } from '../components/admin/settings/SmsTemplateEditor';
import { appSettingsOperations } from '../lib/firestore/app-settings';
import {
  Settings,
  Save,
  CheckCircle,
  Sliders,
  UserPlus,
  Mail,
} from 'lucide-react';
import { BRANDING } from '../config/branding';
import { INCLUDE_SIM_MODE } from '../lib/sim-flag';
import { AdminGuard } from '../components/ui/AdminGuard';
import { PageHeader } from '../components/ui/PageHeader';

// Sim-mode card lives in a separate chunk that we only ever request at
// build-time when INCLUDE_SIM_MODE is true. With Vite's `define` literal,
// the `false` branch evaluates at compile time and Rollup strips both the
// `import('.../SimSeedCard')` call and (transitively) the SimSeedCard module
// itself, including the 'seedSimulationData' callable name and the sim-only
// lucide icons. Keep this guard literal-comparable — never wrap it in a
// helper that returns the boolean dynamically.
const SimSeedCard = INCLUDE_SIM_MODE
  ? lazy(() => import('../components/admin/settings/SimSeedCard'))
  : null;

export const AdminSettingsPage: React.FC = () => {
  const { user } = useAuth();
  const { settings: liveAppSettings } = useAppSettings();
  const isSuperAdmin = isSuperAdminEmail(user?.email);
  // App settings local edit state — initialized from live settings
  const [appSettingsDraft, setAppSettingsDraft] = useState<{
    registrationEnabled: boolean;
    paginationSize: number;
    supportEmail: string;
    simulationMode: boolean;
  }>({
    registrationEnabled: liveAppSettings.registrationEnabled,
    paginationSize: liveAppSettings.paginationSize,
    supportEmail: liveAppSettings.supportEmail || '',
    simulationMode: liveAppSettings.simulationMode,
  });
  const [appSettingsSaving, setAppSettingsSaving] = useState(false);
  const [appSettingsSaved, setAppSettingsSaved] = useState(false);
  const [appSettingsError, setAppSettingsError] = useState<string>('');

  // Keep draft in sync if the live snapshot updates from another tab
  useEffect(() => {
    setAppSettingsDraft({
      registrationEnabled: liveAppSettings.registrationEnabled,
      paginationSize: liveAppSettings.paginationSize,
      supportEmail: liveAppSettings.supportEmail || '',
      simulationMode: liveAppSettings.simulationMode,
    });
  }, [
    liveAppSettings.registrationEnabled,
    liveAppSettings.paginationSize,
    liveAppSettings.supportEmail,
    liveAppSettings.simulationMode,
  ]);

  const handleSaveAppSettings = async () => {
    setAppSettingsSaving(true);
    setAppSettingsError('');
    setAppSettingsSaved(false);
    const res = await appSettingsOperations.saveSettings(appSettingsDraft);
    if (res.success) {
      setAppSettingsSaved(true);
      setTimeout(() => setAppSettingsSaved(false), 3000);
    } else {
      setAppSettingsError(res.error || 'Failed to save settings');
    }
    setAppSettingsSaving(false);
  };

  const appSettingsDirty =
    appSettingsDraft.registrationEnabled !== liveAppSettings.registrationEnabled ||
    appSettingsDraft.paginationSize !== liveAppSettings.paginationSize ||
    appSettingsDraft.supportEmail !== (liveAppSettings.supportEmail || '') ||
    appSettingsDraft.simulationMode !== liveAppSettings.simulationMode;

  // SMS templates editor lives in <SmsTemplateEditor /> — owns its own state.


  return (
    <AdminGuard>
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        icon={Settings}
        iconColor="bg-secondary-100 text-secondary-600"
        title="Settings"
        subtitle="Configure system settings"
      />

      {/* App Settings */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="bg-primary-100 p-2 rounded-lg">
              <Sliders className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-secondary-900">App Settings</h2>
              <p className="text-sm text-secondary-500">
                Global configuration knobs for the patient platform
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleSaveAppSettings}
            loading={appSettingsSaving}
            disabled={!appSettingsDirty}
          >
            {appSettingsSaved ? (
              <>
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Saved
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5 mr-1" />
                Save
              </>
            )}
          </Button>
        </div>

        {appSettingsError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {appSettingsError}
          </div>
        )}

        <div className="space-y-6">
          {/* Registration toggle */}
          <div className="flex items-start justify-between space-x-4 p-4 border border-secondary-200 rounded-lg">
            <div className="flex items-start space-x-3 flex-1">
              <div className="bg-secondary-100 p-2 rounded-lg mt-0.5">
                <UserPlus className="h-4 w-4 text-secondary-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-secondary-900">Public registration</p>
                <p className="text-xs text-secondary-500 mt-0.5">
                  When off, patients cannot self-register. New users must be invited from
                  the User Management page. Phone OTP signups are also blocked.
                </p>
              </div>
            </div>
            <Toggle
              checked={appSettingsDraft.registrationEnabled}
              onChange={(v) => setAppSettingsDraft((d) => ({ ...d, registrationEnabled: v }))}
              ariaLabel="Public registration"
            />
          </div>

          {/* Pagination size */}
          <div className="p-4 border border-secondary-200 rounded-lg">
            <label className="block">
              <p className="text-sm font-medium text-secondary-900">Default page size</p>
              <p className="text-xs text-secondary-500 mt-0.5 mb-2">
                How many items to show per page in admin lists (users, refills, appointments).
                Range: 5–200.
              </p>
              <Input
                type="number"
                min={5}
                max={200}
                value={appSettingsDraft.paginationSize}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!isNaN(n)) {
                    setAppSettingsDraft((d) => ({
                      ...d,
                      paginationSize: Math.max(5, Math.min(200, n)),
                    }));
                  }
                }}
                className="w-32"
              />
            </label>
          </div>

          {/* Support email */}
          <div className="p-4 border border-secondary-200 rounded-lg">
            <div className="flex items-start space-x-3">
              <div className="bg-secondary-100 p-2 rounded-lg mt-0.5">
                <Mail className="h-4 w-4 text-secondary-600" />
              </div>
              <label className="block flex-1 min-w-0">
                <p className="text-sm font-medium text-secondary-900">Support email</p>
                <p className="text-xs text-secondary-500 mt-0.5 mb-2">
                  The address shown across the patient and admin UI for support
                  inquiries (Billing fallback, Contact page, legal pages). Leave
                  empty to use the build-time default
                  (<code className="bg-secondary-100 px-1 rounded">{BRANDING.supportEmail}</code>).
                </p>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder={BRANDING.supportEmail}
                  value={appSettingsDraft.supportEmail}
                  onChange={(e) =>
                    setAppSettingsDraft((d) => ({ ...d, supportEmail: e.target.value }))
                  }
                  className="w-full max-w-md"
                />
              </label>
            </div>
          </div>

          {/* Simulation mode (super-admin only, AND only when this fork bundles sim) */}
          {INCLUDE_SIM_MODE && SimSeedCard && isSuperAdmin && (
            <Suspense fallback={null}>
              <SimSeedCard
                simulationMode={appSettingsDraft.simulationMode}
                onSimulationModeChange={(v) =>
                  setAppSettingsDraft((d) => ({ ...d, simulationMode: v }))
                }
              />
            </Suspense>
          )}
        </div>
      </Card>

      <SmsTemplateEditor />
    </div>
    </AdminGuard>
  );
};
