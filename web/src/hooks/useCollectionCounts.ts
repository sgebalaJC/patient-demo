import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  getCountFromServer,
  query,
  where,
  type WhereFilterOp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSimulationMode } from './useSimulationMode';

type Predicate = [field: string, op: WhereFilterOp, value: unknown];

/**
 * Runs a batch of `getCountFromServer` queries against a single collection
 * so the admin UI can show accurate totals without paging through every row.
 *
 * Only runs on mount + when `refresh()` is called — stats don't need to be
 * live (see usePagedCollection's Refresh button for the same rationale).
 *
 * Usage (AdminFaxesPage):
 *   const { counts, loading, refresh } = useCollectionCounts({
 *     real: 'inbound-faxes',
 *     sim: 'simulation/faxes/inbound',
 *     predicates: {
 *       all: [],
 *       pending: [['status', '==', 'pending']],
 *       failed: [['status', '==', 'failed']],
 *     },
 *   });
 */
export interface UseCollectionCountsOptions<K extends string> {
  real: string;
  sim?: string;
  /** Map of stat key -> predicate list. Empty list = count the whole collection. */
  predicates: Record<K, Predicate[]>;
  enabled?: boolean;
}

export interface UseCollectionCountsResult<K extends string> {
  counts: Record<K, number>;
  loading: boolean;
  refresh: () => void;
}

export function useCollectionCounts<K extends string>(
  opts: UseCollectionCountsOptions<K>,
): UseCollectionCountsResult<K> {
  const { real, sim, predicates, enabled = true } = opts;
  const { enabled: simulated } = useSimulationMode();

  const path = useMemo(() => {
    if (!simulated) return real;
    // Mirror usePagedCollection — fall back to `simulation/native/<real>`
    // (odd-segment collection path) when the caller doesn't provide `sim`.
    return sim || `simulation/native/${real}`;
  }, [simulated, real, sim]);

  const predicatesKey = useMemo(() => {
    const keys = Object.keys(predicates).sort() as K[];
    return JSON.stringify(keys.map((k) => [k, predicates[k]]));
  }, [predicates]);
  const predicatesRef = useRef(predicates);
  predicatesRef.current = predicates;

  const [counts, setCounts] = useState<Record<K, number>>(() => {
    const zeroed = {} as Record<K, number>;
    for (const k of Object.keys(predicates) as K[]) zeroed[k] = 0;
    return zeroed;
  });
  const [loading, setLoading] = useState<boolean>(enabled);

  const fetchAll = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const preds = predicatesRef.current;
      const keys = Object.keys(preds) as K[];
      const coll = collection(db, path);
      const results = await Promise.all(
        keys.map(async (k) => {
          const pred = preds[k];
          const q = pred.length === 0
            ? query(coll)
            : query(coll, ...pred.map(([f, op, v]) => where(f, op, v)));
          const snap = await getCountFromServer(q);
          return [k, snap.data().count] as const;
        }),
      );
      const next = {} as Record<K, number>;
      for (const [k, v] of results) next[k] = v;
      setCounts(next);
    } catch (err) {
      console.error(`[useCollectionCounts] ${path} failed`, err);
    } finally {
      setLoading(false);
    }
  }, [enabled, path]);

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAll, predicatesKey]);

  return { counts, loading, refresh: fetchAll };
}
