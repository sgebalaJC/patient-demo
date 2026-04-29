import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { appSettingsOperations, AppSettings, APP_SETTINGS_DEFAULTS } from '../lib/firestore/app-settings';
import { setSimMode } from '../lib/sim-mode';

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
      // Drive the single sim-mode singleton. setSimMode AND-folds the
      // build-time INCLUDE_SIM_MODE gate so installer-emitted forks (build
      // flag off) can never route real reads through `simulation/native/*`
      // even if a stale Firestore flag is left on.
      setSimMode(next.simulationMode);
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
