import { useEffect, useState, useCallback } from 'react';
import { useAppSettings } from '../contexts/AppSettingsContext';

const STORAGE_KEY = 'simulationMode';
const EVENT = 'simulationMode:changed';

function readSession(): boolean {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(STORAGE_KEY) === '1';
}

function writeSession(on: boolean) {
  if (typeof window === 'undefined') return;
  if (on) window.sessionStorage.setItem(STORAGE_KEY, '1');
  else window.sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * Per-session simulation flag. Gated behind `settings.simulationMode` — if the
 * global switch is off, this hook always reports `enabled: false` and ignores
 * any stale sessionStorage value. The UI toggle is only rendered when
 * `available` is true.
 */
export function useSimulationMode() {
  const { settings } = useAppSettings();
  const [sessionOn, setSessionOn] = useState<boolean>(readSession);

  useEffect(() => {
    const handler = () => setSessionOn(readSession());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const available = !!settings.simulationMode;
  const enabled = available && sessionOn;

  const setEnabled = useCallback((on: boolean) => writeSession(on), []);

  return { enabled, available, setEnabled };
}

export function currentSimulationFlag(globalEnabled: boolean): boolean {
  return globalEnabled && readSession();
}
