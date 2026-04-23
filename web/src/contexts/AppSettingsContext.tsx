import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { appSettingsOperations, AppSettings, APP_SETTINGS_DEFAULTS } from '../lib/firestore/app-settings';
import { setSimCollectionMode } from '../lib/firestore/base';

interface AppSettingsState {
  settings: AppSettings;
  /** True until the first read (snapshot or fallback) has resolved. */
  loading: boolean;
}

const AppSettingsContext = createContext<AppSettingsState>({
  settings: { ...APP_SETTINGS_DEFAULTS },
  loading: true,
});

interface AppSettingsProviderProps {
  children: ReactNode;
}

/**
 * Provides realtime app settings to the entire tree. Must wrap any component
 * that reads `useAppSettings()`. Subscription is opened once at mount.
 *
 * Reads are public (Firestore rules allow unauthenticated read of `system/settings`)
 * so this works on the /auth page before sign-in.
 */
export const AppSettingsProvider: React.FC<AppSettingsProviderProps> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>({ ...APP_SETTINGS_DEFAULTS });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = appSettingsOperations.subscribe((next) => {
      setSettings(next);
      // Keep the sim flag that drives `collections.*` aligned with the live
      // settings doc. Patient-facing Firestore ops use `collections.users`
      // etc. directly; without this, they'd always hit real paths even when
      // sim mode is on, so impersonated sim patients saw empty dashboards.
      setSimCollectionMode(next.simulationMode === true);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AppSettingsContext.Provider value={{ settings, loading }}>
      {children}
    </AppSettingsContext.Provider>
  );
};

export const useAppSettings = (): AppSettingsState => useContext(AppSettingsContext);
