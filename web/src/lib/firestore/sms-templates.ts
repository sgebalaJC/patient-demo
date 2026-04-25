import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ApiResponse } from '../../types';
import { BRANDING } from '../../config/branding';
import logger from '../logger';
import { errorMessage } from '../errors';
import { audit } from '../audit';

export interface SmsTemplates {
  reminder24h: string;
  reminderMorning: string;
  updatedAt?: Timestamp;
}

const DEFAULTS: SmsTemplates = {
  reminder24h:
    `This is an automated reminder from ${BRANDING.smsSenderName} of your appointment on: {content}\nScheduled for tomorrow at {time}. Don't forget!`,
  reminderMorning:
    `This is an automated reminder from ${BRANDING.smsSenderName} of your appointment on: {content}\nScheduled for today at {time}. Don't forget!`,
};

const DOC_REF = doc(db, 'system', 'sms-templates');

export const smsTemplateOperations = {
  /** Get current templates (returns defaults if not yet saved) */
  async getTemplates(): Promise<ApiResponse<SmsTemplates>> {
    try {
      const snap = await getDoc(DOC_REF);
      if (snap.exists()) {
        const data = snap.data() as SmsTemplates;
        return {
          success: true,
          data: {
            reminder24h: data.reminder24h || DEFAULTS.reminder24h,
            reminderMorning: data.reminderMorning || DEFAULTS.reminderMorning,
          },
        };
      }
      return { success: true, data: { ...DEFAULTS } };
    } catch (error: unknown) {
      logger.error('Error getting SMS templates:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  /** Save templates */
  async saveTemplates(templates: SmsTemplates): Promise<ApiResponse<void>> {
    try {
      await setDoc(DOC_REF, {
        reminder24h: templates.reminder24h,
        reminderMorning: templates.reminderMorning,
        updatedAt: serverTimestamp(),
      });
      audit({ action: 'sms_templates.updated', resourceType: 'system', resourceId: 'sms-templates' });
      return { success: true };
    } catch (error: unknown) {
      logger.error('Error saving SMS templates:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  /** Validate that template contains required placeholders */
  validateTemplate(template: string): string | null {
    if (!template.includes('{content}')) {
      return 'Template must include {content} placeholder';
    }
    if (!template.includes('{time}')) {
      return 'Template must include {time} placeholder';
    }
    return null;
  },

  getDefaults(): SmsTemplates {
    return { ...DEFAULTS };
  },
};
