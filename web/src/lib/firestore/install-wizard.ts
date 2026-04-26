import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { ApiResponse } from '../../types';
import type { InstallWizardState } from '../../types/install-wizard';
import logger from '../logger';
import { errorMessage } from '../errors';
import { audit } from '../audit';

const DOC_REF = doc(db, 'system', 'installWizard');

interface PersistedWizard extends InstallWizardState {
  updatedAt?: Timestamp;
}

export const installWizardOps = {
  async get(): Promise<ApiResponse<InstallWizardState>> {
    try {
      const snap = await getDoc(DOC_REF);
      const data = snap.exists() ? (snap.data() as PersistedWizard) : {};
      const { updatedAt: _u, ...rest } = data;
      return { success: true, data: rest };
    } catch (error: unknown) {
      logger.error('Error reading install wizard state:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  /**
   * Merge-write the next chunk. Pass only the keys you intend to save;
   * undefined keys won't overwrite previously-saved values.
   */
  async save(patch: Partial<InstallWizardState>): Promise<ApiResponse<void>> {
    try {
      await setDoc(
        DOC_REF,
        { ...patch, updatedAt: serverTimestamp() },
        { merge: true },
      );
      audit({
        action: 'install-wizard.saved',
        resourceType: 'system',
        resourceId: 'installWizard',
        metadata: { sections: Object.keys(patch) },
      });
      return { success: true };
    } catch (error: unknown) {
      logger.error('Error saving install wizard state:', error);
      return { success: false, error: errorMessage(error) };
    }
  },
};

/**
 * Live branding overrides at `system/branding`. Currently only written by
 * the install wizard's "Apply colors live" button and read back by the
 * wizard itself; ThemeSelector and BrandLogo render from build-time
 * branding (BRANDING export). The Firestore doc exists as the seam for
 * a future runtime-override path. Rule: super-admin write, admin read.
 */
const BRANDING_REF = doc(db, 'system', 'branding');

export interface LiveBranding {
  colors?: { primary: string; secondary: string; accent: string };
  logos?: { full: string; icon: string };
}

export const liveBrandingOps = {
  async get(): Promise<ApiResponse<LiveBranding>> {
    try {
      const snap = await getDoc(BRANDING_REF);
      return { success: true, data: snap.exists() ? (snap.data() as LiveBranding) : {} };
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) };
    }
  },
  async save(patch: LiveBranding): Promise<ApiResponse<void>> {
    try {
      await setDoc(BRANDING_REF, { ...patch, updatedAt: serverTimestamp() }, { merge: true });
      audit({
        action: 'branding.updated',
        resourceType: 'system',
        resourceId: 'branding',
        metadata: { sections: Object.keys(patch) },
      });
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) };
    }
  },
};
