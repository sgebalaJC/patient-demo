import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../hooks/useAuth';
import { useAppSettings } from '../contexts/AppSettingsContext';
import { smsTemplateOperations, SmsTemplates } from '../lib/firestore/sms-templates';
import { appSettingsOperations } from '../lib/firestore/app-settings';
import {
  Settings,
  MessageSquare,
  Save,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
  Sliders,
  UserPlus,
} from 'lucide-react';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { PageHeader } from '../components/ui/PageHeader';

export const AdminSettingsPage: React.FC = () => {
  const { userProfile, loading: authLoading } = useAuth();
  const { settings: liveAppSettings } = useAppSettings();
  const [templates, setTemplates] = useState<SmsTemplates | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<{ reminder24h?: string; reminderMorning?: string }>({});

  // App settings local edit state — initialized from live settings
  const [appSettingsDraft, setAppSettingsDraft] = useState<{
    registrationEnabled: boolean;
    paginationSize: number;
  }>({
    registrationEnabled: liveAppSettings.registrationEnabled,
    paginationSize: liveAppSettings.paginationSize,
  });
  const [appSettingsSaving, setAppSettingsSaving] = useState(false);
  const [appSettingsSaved, setAppSettingsSaved] = useState(false);
  const [appSettingsError, setAppSettingsError] = useState<string>('');

  // Keep draft in sync if the live snapshot updates from another tab
  useEffect(() => {
    setAppSettingsDraft({
      registrationEnabled: liveAppSettings.registrationEnabled,
      paginationSize: liveAppSettings.paginationSize,
    });
  }, [liveAppSettings.registrationEnabled, liveAppSettings.paginationSize]);

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
    appSettingsDraft.paginationSize !== liveAppSettings.paginationSize;

  useEffect(() => {
    if (userProfile?.role === 'admin') loadTemplates();
  }, [userProfile]);

  const loadTemplates = async () => {
    setLoading(true);
    const res = await smsTemplateOperations.getTemplates();
    if (res.success && res.data) {
      setTemplates(res.data);
    }
    setLoading(false);
  };

  const validate = (t: SmsTemplates): boolean => {
    const errs: typeof errors = {};
    const err24 = smsTemplateOperations.validateTemplate(t.reminder24h);
    const errMorn = smsTemplateOperations.validateTemplate(t.reminderMorning);
    if (err24) errs.reminder24h = err24;
    if (errMorn) errs.reminderMorning = errMorn;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!templates || !validate(templates)) return;
    setSaving(true);
    setSaved(false);
    const res = await smsTemplateOperations.saveTemplates(templates);
    if (res.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  };

  const handleReset = () => {
    setTemplates(smsTemplateOperations.getDefaults());
    setErrors({});
  };

  const updateTemplate = (field: keyof SmsTemplates, value: string) => {
    if (!templates) return;
    const updated = { ...templates, [field]: value };
    setTemplates(updated);
    // Clear error on edit
    if (errors[field as keyof typeof errors]) {
      setErrors(e => ({ ...e, [field]: undefined }));
    }
  };

  if (authLoading || loading) return <LoadingSpinner />;
  if (userProfile?.role !== 'admin') return <AccessDenied message="Admin access required." />;

  return (
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
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={appSettingsDraft.registrationEnabled}
                onChange={(e) =>
                  setAppSettingsDraft((d) => ({ ...d, registrationEnabled: e.target.checked }))
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-secondary-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-secondary-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
            </label>
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
        </div>
      </Card>

      {/* SMS Templates */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="bg-primary-100 p-2 rounded-lg">
              <MessageSquare className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-secondary-900">SMS Reminder Templates</h2>
              <p className="text-sm text-secondary-500">
                Customize the SMS messages patients receive before appointments
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="secondary" size="sm" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
            <Button size="sm" onClick={handleSave} loading={saving}>
              {saved ? (
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
        </div>

        {/* Placeholder info */}
        <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <p className="font-medium mb-1">Available placeholders:</p>
          <ul className="space-y-1">
            <li><code className="bg-blue-100 px-1 rounded">{'{content}'}</code> — Appointment description (type, location, reason)</li>
            <li><code className="bg-blue-100 px-1 rounded">{'{time}'}</code> — Formatted appointment time (e.g., "Mar 25, 2:00 PM")</li>
          </ul>
          <p className="mt-2 text-blue-600">Both placeholders are required in each template.</p>
        </div>

        {templates && (
          <div className="space-y-6">
            {/* 24-hour reminder */}
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-1">
                24-Hour Advance Reminder
              </label>
              <p className="text-xs text-secondary-500 mb-2">
                Sent 24 hours before the appointment
              </p>
              <textarea
                value={templates.reminder24h}
                onChange={(e) => updateTemplate('reminder24h', e.target.value)}
                rows={6}
                style={{ minHeight: '160px' }}
                className={`input w-full font-mono text-sm ${errors.reminder24h ? 'border-red-300 focus:ring-red-500' : ''}`}
              />
              {errors.reminder24h && (
                <p className="mt-1 text-sm text-red-600 flex items-center">
                  <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                  {errors.reminder24h}
                </p>
              )}
            </div>

            {/* Morning reminder */}
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-1">
                Morning-Of Reminder (8 AM)
              </label>
              <p className="text-xs text-secondary-500 mb-2">
                Sent at 8:00 AM on the day of the appointment
              </p>
              <textarea
                value={templates.reminderMorning}
                onChange={(e) => updateTemplate('reminderMorning', e.target.value)}
                rows={6}
                style={{ minHeight: '160px' }}
                className={`input w-full font-mono text-sm ${errors.reminderMorning ? 'border-red-300 focus:ring-red-500' : ''}`}
              />
              {errors.reminderMorning && (
                <p className="mt-1 text-sm text-red-600 flex items-center">
                  <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                  {errors.reminderMorning}
                </p>
              )}
            </div>

            {/* Preview */}
            <div className="border-t border-secondary-200 pt-4">
              <p className="text-sm font-medium text-secondary-700 mb-3">Preview</p>
              <div className="space-y-3">
                <div className="p-3 bg-secondary-50 rounded-lg">
                  <p className="text-xs font-medium text-secondary-500 mb-1">24-Hour Reminder</p>
                  <p className="text-sm text-secondary-800 whitespace-pre-wrap">
                    {templates.reminder24h
                      .replace('{content}', 'Consultation')
                      .replace('{time}', 'Mar 25, 2:00 PM')}
                  </p>
                </div>
                <div className="p-3 bg-secondary-50 rounded-lg">
                  <p className="text-xs font-medium text-secondary-500 mb-1">Morning Reminder</p>
                  <p className="text-sm text-secondary-800 whitespace-pre-wrap">
                    {templates.reminderMorning
                      .replace('{content}', 'Consultation')
                      .replace('{time}', 'Mar 25, 2:00 PM')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
