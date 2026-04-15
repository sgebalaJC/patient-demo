import { useAppSettings } from '../contexts/AppSettingsContext';
import { BRANDING } from '../config/branding';

/**
 * Returns the live admin-configured support email, falling back to the
 * compile-time default in BRANDING when the admin hasn't overridden it.
 */
export function useSupportEmail(): string {
  const { settings } = useAppSettings();
  const live = (settings.supportEmail || '').trim();
  return live || BRANDING.supportEmail;
}
