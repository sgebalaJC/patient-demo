/**
 * useFirestoreListener — tiny helper that wraps the common
 * loading / error / data + `onSnapshot` cleanup pattern used across admin
 * pages. Takes a subscribe function with the shape:
 *
 *   (onData, onError) => () => void  // unsubscribe
 *
 * Returns `{ data, loading, error }`. `loading` flips to false on first
 * delivery of either data or error. Pass `enabled: false` to skip the
 * subscription entirely (e.g. while waiting on role resolution).
 */

import { useEffect, useState } from 'react';

type Subscribe<T> = (
  onData: (value: T) => void,
  onError: (err: Error) => void,
) => () => void;

export interface UseFirestoreListenerOptions<T> {
  /** Toggle to pause subscription without unmounting. Defaults to true. */
  enabled?: boolean;
  /** Initial value while loading. Defaults to undefined. */
  initial?: T;
  /**
   * Reset dependencies — changing any of these tears the current listener
   * down and resubscribes. Treat exactly like `useEffect` deps.
   */
  deps?: ReadonlyArray<unknown>;
}

export function useFirestoreListener<T>(
  subscribe: Subscribe<T>,
  options: UseFirestoreListenerOptions<T> = {},
): { data: T | undefined; loading: boolean; error: Error | null } {
  const { enabled = true, initial, deps = [] } = options;
  const [data, setData] = useState<T | undefined>(initial);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const unsub = subscribe(
      (value) => {
        setData(value);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return unsub;
    // Deps are supplied by the caller — subscribe is typically rebuilt on
    // every render so we intentionally don't include it in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return { data, loading, error };
}
