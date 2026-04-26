import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  getDocs,
  limit as fLimit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type OrderByDirection,
  type QueryDocumentSnapshot,
  type WhereFilterOp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSimulationMode } from './useSimulationMode';
import { INCLUDE_SIM_MODE } from '../lib/sim-flag';

export type WhereClause = [field: string, op: WhereFilterOp, value: unknown];

/**
 * Cursor-based paginated Firestore read.
 *
 * Unlike the legacy fetch-1000-and-slice pattern, this hook fetches exactly
 * one page at a time using Firestore's `startAfter` cursor. No upper bound
 * on total rows — navigate as deep as the collection goes.
 *
 * Tradeoff: no live subscription. New rows don't appear until you hit
 * `refresh()` (rendered as a button on the caller's side). That's the right
 * tradeoff for long history lists — subscriptions on 1000 rows are expensive,
 * and operators tolerate a manual refresh for "show me the latest".
 *
 * When simulation mode is on, reads from the `sim` path instead of `real`.
 *
 * Usage:
 *   const p = usePagedCollection({
 *     real: 'sms-outbound',
 *     sim: 'simulation/sms/outbound',
 *     orderField: 'sentAt',
 *     pageSize: 25,
 *     mapDoc: (d) => ({ sid: d.id, ...(d.data() as Omit<Sms, 'sid'>) }),
 *   });
 *   p.rows, p.page, p.hasNext, p.next(), p.prev(), p.refresh()
 */
export interface UsePagedCollectionOptions<T> {
  real: string;
  sim?: string;
  orderField: string;
  orderDir?: OrderByDirection;
  pageSize?: number;
  enabled?: boolean;
  /** When true, only fetches in sim mode — real mode yields empty rows. */
  simOnly?: boolean;
  /**
   * Server-side `where` predicates applied before `orderBy`. Each combination
   * of field + orderBy needs a composite index in `firestore.indexes.json`.
   * When this array changes identity, the paginator resets to page 1 and
   * discards cached cursors (they only make sense for the prior query shape).
   */
  whereClauses?: WhereClause[];
  mapDoc: (doc: QueryDocumentSnapshot<DocumentData>) => T;
  onError?: (err: unknown) => void;
}

export interface UsePagedCollectionResult<T> {
  rows: T[];
  /** 1-indexed. */
  page: number;
  pageSize: number;
  hasNext: boolean;
  hasPrev: boolean;
  loading: boolean;
  /** True when the current rows come from the sandbox. */
  simulated: boolean;
  next: () => void;
  prev: () => void;
  /** Reset to page 1 and re-fetch. Use for "Refresh" button + after mutating writes. */
  refresh: () => void;
}

export function usePagedCollection<T>(
  opts: UsePagedCollectionOptions<T>,
): UsePagedCollectionResult<T> {
  const {
    real, sim, orderField, orderDir = 'desc',
    pageSize = 25, enabled = true, simOnly = false,
    whereClauses, mapDoc, onError,
  } = opts;
  const { enabled: simulated } = useSimulationMode();

  const path = useMemo(() => {
    // Build-time tree-shake: when INCLUDE_SIM_MODE is false, Vite drops the
    // entire branch — sim path strings and `simulation/native/${real}`
    // template never ship in the bundle.
    if (INCLUDE_SIM_MODE && simulated) {
      return sim || `simulation/native/${real}`;
    }
    return real;
  }, [simulated, real, sim]);

  // Serialize whereClauses so the fetch effect re-runs when they change.
  // Callers typically derive `whereClauses` inline; a stringified key avoids
  // requiring them to memo the array identity.
  const whereKey = useMemo(
    () => JSON.stringify(whereClauses ?? []),
    [whereClauses],
  );

  // cursors[i] is the startAfter doc for page (i+2). cursors[0] is always
  // the last doc of page 1 — used to enter page 2. Built as the user advances
  // so prev() works without re-querying.
  const cursorsRef = useRef<QueryDocumentSnapshot<DocumentData>[]>([]);
  const [page, setPage] = useState<number>(1);
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [hasNext, setHasNext] = useState<boolean>(false);
  const mapDocRef = useRef(mapDoc);
  const onErrorRef = useRef(onError);
  const whereRef = useRef<WhereClause[] | undefined>(whereClauses);
  mapDocRef.current = mapDoc;
  onErrorRef.current = onError;
  whereRef.current = whereClauses;

  const fetchPage = useCallback(async (targetPage: number) => {
    if (!enabled || (simOnly && !simulated)) {
      setRows([]);
      setHasNext(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const cursor = targetPage === 1 ? undefined : cursorsRef.current[targetPage - 2];
      const coll = collection(db, path);
      const constraints = [
        ...(whereRef.current ?? []).map(([f, op, v]) => where(f, op, v)),
        orderBy(orderField, orderDir),
        ...(cursor ? [startAfter(cursor)] : []),
        fLimit(pageSize + 1),
      ];
      const q = query(coll, ...constraints);
      const snap = await getDocs(q);
      const docs = snap.docs;
      const more = docs.length > pageSize;
      const pageDocs = more ? docs.slice(0, pageSize) : docs;

      if (pageDocs.length > 0) {
        cursorsRef.current[targetPage - 1] = pageDocs[pageDocs.length - 1];
      }
      setRows(pageDocs.map((d) => mapDocRef.current(d)));
      setHasNext(more);
      setPage(targetPage);
    } catch (err) {
      if (onErrorRef.current) onErrorRef.current(err);
      else console.error(`[usePagedCollection] ${path} failed`, err);
      setRows([]);
      setHasNext(false);
    } finally {
      setLoading(false);
    }
    // whereKey is the stable identity for whereClauses — fetchPage reads the
    // current value off whereRef, so we depend on the key (not the array) to
    // avoid forcing callers to memo their where arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, simOnly, simulated, path, orderField, orderDir, pageSize, whereKey]);

  // Reset cursors + reload when the effective path / order / pageSize / filters
  // change. Cached cursors are only valid for the prior query shape.
  useEffect(() => {
    cursorsRef.current = [];
    void fetchPage(1);
  }, [fetchPage]);

  const next = useCallback(() => {
    if (hasNext && !loading) void fetchPage(page + 1);
  }, [hasNext, loading, page, fetchPage]);

  const prev = useCallback(() => {
    if (page > 1 && !loading) void fetchPage(page - 1);
  }, [page, loading, fetchPage]);

  const refresh = useCallback(() => {
    cursorsRef.current = [];
    void fetchPage(1);
  }, [fetchPage]);

  return {
    rows, page, pageSize, hasNext, hasPrev: page > 1, loading, simulated,
    next, prev, refresh,
  };
}
