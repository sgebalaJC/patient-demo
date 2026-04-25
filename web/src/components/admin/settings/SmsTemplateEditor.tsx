/**
 * SMS reminder template editor — pulled out of AdminSettingsPage to keep the
 * settings page focused on global toggles. Owns its own load/save state for
 * the `system/smsTemplates` doc; the parent only mounts it.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, MessageSquare, RotateCcw, Save } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { smsTemplateOperations, type SmsTemplates } from '../../../lib/firestore/sms-templates';

export const SmsTemplateEditor: React.FC = () => {
  const [templates, setTemplates] = useState<SmsTemplates | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<{ reminder24h?: string; reminderMorning?: string }>({});

  useEffect(() => {
    const load = async () => {
      const res = await smsTemplateOperations.getTemplates();
      if (res.success && res.data) setTemplates(res.data);
    };
    load();
  }, []);

  const validate = (t: SmsTemplates): boolean => {
    const next: typeof errors = {};
    const err24 = smsTemplateOperations.validateTemplate(t.reminder24h);
    const errMorn = smsTemplateOperations.validateTemplate(t.reminderMorning);
    if (err24) next.reminder24h = err24;
    if (errMorn) next.reminderMorning = errMorn;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!templates || !validate(templates)) return;
    setSaving(true);
    const res = await smsTemplateOperations.saveTemplates(templates);
    setSaving(false);
    if (res.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleReset = () => {
    setTemplates(smsTemplateOperations.getDefaults());
  };

  const updateTemplate = (field: keyof SmsTemplates, value: string) => {
    if (!templates) return;
    const updated = { ...templates, [field]: value };
    setTemplates(updated);
    validate(updated);
  };

  return (
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

      <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
        <p className="font-medium mb-1">Available placeholders:</p>
        <ul className="space-y-1">
          <li><code className="bg-green-100 px-1 rounded">{'{content}'}</code> — Appointment description (type, location, reason)</li>
          <li><code className="bg-green-100 px-1 rounded">{'{time}'}</code> — Formatted appointment time (e.g., "Mar 25, 2:00 PM")</li>
        </ul>
        <p className="mt-2 text-green-700">Both placeholders are required in each template.</p>
      </div>

      {templates && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-1">24-Hour Advance Reminder</label>
            <p className="text-xs text-secondary-500 mb-2">Sent 24 hours before the appointment</p>
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

          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-1">Morning-Of Reminder (8 AM)</label>
            <p className="text-xs text-secondary-500 mb-2">Sent at 8:00 AM on the day of the appointment</p>
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
  );
};
