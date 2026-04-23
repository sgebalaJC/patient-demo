import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  query,
  orderBy,
  limit as fLimit,
  onSnapshot,
  type OrderByDirection,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSimulationMode } from './useSimulationMode';

/**
 * Subscribe to an integration-backed Firestore collection, automatically
 * swapping the path to `simulation/{simPrefix}` when sim mode is on. Encapsulates
 * the one seam the middleware can't remove — Firestore onSnapshot listeners
 * can't route through a callable, so subscribing components would otherwise
 * each duplicate the `useSimulationMode` + collection-path fork.
 *
 * Usage:
 *   const { rows, loading } = useIntegrationCollection<InboundFax>({
 *     real: 'inbound-faxes',
 *     sim: 'simulation/faxes/inbound',
 *     orderField: 'receivedAt',
 *     mapDoc: (d) => ({ faxSid: d.id, ...(d.data() as Omit<InboundFax, 'faxSid'>) }),
 *   });
 */
export interface UseIntegrationCollectionOptions<T> {
  /** Collection path used in real mode. */
  real: string;
  /** Collection path used in sim mode (defaults to `simulation/<real>` — good for most cases). */
  sim?: string;
  /** Field to order by. */
  orderField: string;
  /** Direction, default 'desc'. */
  orderDir?: OrderByDirection;
  /** Subscription cap — matches the house pattern (fetch chunk, slice
   *  client-side via usePagination + PaginationBar). Default 1000. */
  limit?: number;
  /** Called when the subscribing admin doesn't have access (e.g. rule denies). Optional. */
  onError?: (err: unknown) => void;
  /** Shape each doc snapshot into the row type — caller owns `id`/sid naming. */
  mapDoc: (doc: QueryDocumentSnapshot<DocumentData>) => T;
  /** When false, skip subscribing entirely (e.g. pre-auth). Default true. */
  enabled?: boolean;
  /** When true, only subscribe in sim mode — real mode returns empty rows.
   *  Useful for sandbox-only surfaces (e.g. SMS history where real Twilio
   *  logs aren't mirrored to Firestore). */
  simOnly?: boolean;
}

export interface UseIntegrationCollectionResult<T> {
  rows: T[];
  loading: boolean;
  /** True when the current rows come from the sandbox. */
  simulated: boolean;
}

export function useIntegrationCollection<T>(
  opts: UseIntegrationCollectionOptions<T>,
): UseIntegrationCollectionResult<T> {
  const {
    real, sim, orderField, orderDir = 'desc',
    limit = 1000, onError, mapDoc, enabled = true, simOnly = false,
  } = opts;
  const { enabled: simulated } = useSimulationMode();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const onErrorRef = useRef(onError);
  const mapDocRef = useRef(mapDoc);
  onErrorRef.current = onError;
  mapDocRef.current = mapDoc;

  const path = useMemo(() => {
    if (!simulated) return real;
    return sim || `simulation/${real}`;
  }, [simulated, real, sim]);

  useEffect(() => {
    if (!enabled || (simOnly && !simulated)) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, path), orderBy(orderField, orderDir), fLimit(limit));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => mapDocRef.current(d)));
        setLoading(false);
      },
      (err) => {
        if (onErrorRef.current) onErrorRef.current(err);
        else console.error(`[useIntegrationCollection] ${path} failed`, err);
        setLoading(false);
      },
    );
    return unsub;
  }, [enabled, simOnly, simulated, path, orderField, orderDir, limit]);

  return { rows, loading, simulated };
}
