import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { appSettingsOperations, AppSettings, APP_SETTINGS_DEFAULTS } from '../lib/firestore/app-settings';
import { setSimCollectionMode } from '../lib/firestore/base';
import { INCLUDE_SIM_MODE } from '../lib/sim-flag';

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
      // Gated by INCLUDE_SIM_MODE so installer-emitted forks (build flag off)
      // can never route real reads through sim collections if a stale
      // simulationMode flag is left on in Firestore.
      if (INCLUDE_SIM_MODE) {
        setSimCollectionMode(next.simulationMode === true);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = useMemo<AppSettingsState>(() => ({ settings, loading }), [settings, loading]);

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
};

export const useAppSettings = (): AppSettingsState => useContext(AppSettingsContext);
