import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ApiResponse } from '../../types';
import logger from '../logger';
import { errorMessage } from '../errors';

/**
 * App-wide settings stored in Firestore at `system/settings`.
 *
 * Public read so unauthenticated /auth page can check `registrationEnabled`
 * before showing signup. Admin-only write enforced by Firestore rules.
 *
 * `bootstrapped` is a write-once flag set by the `bootstrapFirstAdmin` Cloud
 * Function on first install. It MUST NOT be flipped back to false manually.
 */
export interface AppSettings {
  /** Public self-registration enabled. Defaults to false on fresh installs. */
  registrationEnabled: boolean;
  /** Default page size for paginated admin lists. */
  paginationSize: number;
  /** Write-once flag — true after the first admin has been created. */
  bootstrapped: boolean;
  /**
   * When true, admin panel shows a 7-day grace banner after subscription
   * lapse then hard-blocks admin routes. Patient-facing routes are never
   * blocked. Defaults to false so practices can opt in.
   */
  practiceSubscriptionEnforced: boolean;
  /**
   * Public support email shown across the patient + admin UI. When empty,
   * falls back to BRANDING.supportEmail from config/branding.ts.
   */
  supportEmail?: string;
  /**
   * Demo-mode: when true, users may flip a per-session "Demo data" switch that
   * routes integration calls (EHR reads/writes, inbox, etc.) to the simulation
   * backend instead of real services. Off by default — customer forks keep it
   * off so the toggle never ships to end users.
   */
  simulationMode: boolean;
  updatedAt?: Timestamp;
}

export const APP_SETTINGS_DEFAULTS: AppSettings = {
  registrationEnabled: false,
  paginationSize: 25,
  bootstrapped: false,
  practiceSubscriptionEnforced: false,
  supportEmail: '',
  simulationMode: false,
};

const DOC_REF = doc(db, 'system', 'settings');

function normalize(data: Partial<AppSettings> | undefined): AppSettings {
  return {
    registrationEnabled:
      typeof data?.registrationEnabled === 'boolean'
        ? data.registrationEnabled
        : APP_SETTINGS_DEFAULTS.registrationEnabled,
    paginationSize:
      typeof data?.paginationSize === 'number' && data.paginationSize > 0
        ? data.paginationSize
        : APP_SETTINGS_DEFAULTS.paginationSize,
    bootstrapped:
      typeof data?.bootstrapped === 'boolean'
        ? data.bootstrapped
        : APP_SETTINGS_DEFAULTS.bootstrapped,
    practiceSubscriptionEnforced:
      typeof data?.practiceSubscriptionEnforced === 'boolean'
        ? data.practiceSubscriptionEnforced
        : APP_SETTINGS_DEFAULTS.practiceSubscriptionEnforced,
    supportEmail:
      typeof data?.supportEmail === 'string'
        ? data.supportEmail.trim()
        : APP_SETTINGS_DEFAULTS.supportEmail,
    simulationMode:
      typeof data?.simulationMode === 'boolean'
        ? data.simulationMode
        : APP_SETTINGS_DEFAULTS.simulationMode,
  };
}

export const appSettingsOperations = {
  /** One-shot read of current app settings (returns defaults if doc missing). */
  async getSettings(): Promise<ApiResponse<AppSettings>> {
    try {
      const snap = await getDoc(DOC_REF);
      return {
        success: true,
        data: normalize(snap.exists() ? (snap.data() as AppSettings) : undefined),
      };
    } catch (error: unknown) {
      logger.error('Error getting app settings:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  /**
   * Subscribe to live changes. Returns an unsubscribe function.
   * Falls back to defaults on missing doc / read errors so the UI never blocks.
   */
  subscribe(callback: (settings: AppSettings) => void): Unsubscribe {
    return onSnapshot(
      DOC_REF,
      (snap) => {
        callback(normalize(snap.exists() ? (snap.data() as AppSettings) : undefined));
      },
      (error) => {
        logger.error('App settings subscription error:', error);
        callback({ ...APP_SETTINGS_DEFAULTS });
      },
    );
  },

  /**
   * Save admin-editable settings. Merges into the existing doc — only fields
   * provided in `settings` are written. Never writes `bootstrapped`.
   */
  async saveSettings(
    settings: Partial<
      Pick<
        AppSettings,
        | 'registrationEnabled'
        | 'paginationSize'
        | 'practiceSubscriptionEnforced'
        | 'supportEmail'
        | 'simulationMode'
      >
    >,
  ): Promise<ApiResponse<void>> {
    try {
      const payload: Record<string, any> = {
        updatedAt: serverTimestamp(),
      };
      if (settings.registrationEnabled !== undefined) {
        payload.registrationEnabled = !!settings.registrationEnabled;
      }
      if (settings.paginationSize !== undefined) {
        payload.paginationSize = Math.max(1, Math.floor(settings.paginationSize));
      }
      if (settings.practiceSubscriptionEnforced !== undefined) {
        payload.practiceSubscriptionEnforced = !!settings.practiceSubscriptionEnforced;
      }
      if (settings.supportEmail !== undefined) {
        payload.supportEmail = String(settings.supportEmail).trim().slice(0, 254);
      }
      if (settings.simulationMode !== undefined) {
        payload.simulationMode = !!settings.simulationMode;
      }
      await setDoc(DOC_REF, payload, { merge: true });
      return { success: true };
    } catch (error: unknown) {
      logger.error('Error saving app settings:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  getDefaults(): AppSettings {
    return { ...APP_SETTINGS_DEFAULTS };
  },
};
