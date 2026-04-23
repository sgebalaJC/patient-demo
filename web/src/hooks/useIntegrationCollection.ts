import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /** Initial rows and load-more step size. Default 50. */
  pageSize?: number;
  /** Hard ceiling on total rows fetched (safety cap). Default 2000. */
  maxRows?: number;
  /** Legacy one-shot limit (no load-more). When provided, overrides pageSize
   *  and disables loadMore. Prefer `pageSize`. */
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
  /** True when the subscription is at capacity (more rows likely exist server-side). */
  hasMore: boolean;
  /** Bump the limit by `pageSize`. No-op when a fixed `limit` was supplied. */
  loadMore: () => void;
}

export function useIntegrationCollection<T>(
  opts: UseIntegrationCollectionOptions<T>,
): UseIntegrationCollectionResult<T> {
  const {
    real, sim, orderField, orderDir = 'desc',
    pageSize = 50, maxRows = 2000, limit: fixedLimit,
    onError, mapDoc, enabled = true, simOnly = false,
  } = opts;
  const { enabled: simulated } = useSimulationMode();
  // Fixed-limit mode disables the load-more ceiling; otherwise we grow from
  // pageSize in pageSize-sized steps (clamped by maxRows).
  const baseLimit = fixedLimit ?? pageSize;
  const [currentLimit, setCurrentLimit] = useState<number>(baseLimit);
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

  // Reset the paginated window when the collection path or filters change —
  // otherwise a user who loaded 150 outbound rows would still see a 150-row
  // limit after flipping to the Inbound tab.
  useEffect(() => {
    setCurrentLimit(baseLimit);
  }, [path, orderField, orderDir, baseLimit]);

  useEffect(() => {
    if (!enabled || (simOnly && !simulated)) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, path), orderBy(orderField, orderDir), fLimit(currentLimit));
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
  }, [enabled, simOnly, simulated, path, orderField, orderDir, currentLimit]);

  const loadMore = useCallback(() => {
    if (fixedLimit !== undefined) return;
    setCurrentLimit((n) => Math.min(n + pageSize, maxRows));
  }, [fixedLimit, pageSize, maxRows]);

  // Heuristic: if the snapshot is packed to the current limit AND we haven't
  // hit maxRows yet, assume more rows exist server-side. False positives
  // disappear on the next load (snap returns fewer than currentLimit).
  const hasMore = fixedLimit === undefined && rows.length >= currentLimit && currentLimit < maxRows;

  return { rows, loading, simulated, hasMore, loadMore };
}
