import { useEffect, useState, DependencyList } from 'react';

/**
 * Resolve a PDF source URL and hand back a same-origin blob URL suitable for
 * `<iframe src>`. Chrome refuses to render cross-origin PDFs inline even with
 * `Content-Disposition: inline`, and GCS sometimes returns
 * `application/octet-stream`, so we always force `application/pdf` when
 * wrapping the bytes.
 *
 * `resolve` returns the upstream URL (signed GCS URL, callable response, etc.)
 * or `null` to clear the preview. `deps` tracks when to re-run it.
 */
export function usePdfPreview(
  resolve: () => Promise<string | null>,
  deps: DependencyList,
): { url: string | null; loading: boolean; error: string | null } {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setUrl(null);
    setError(null);
    setLoading(true);
    (async () => {
      try {
        const source = await resolve();
        if (cancelled) return;
        if (!source) {
          setLoading(false);
          return;
        }
        const r = await fetch(source);
        if (!r.ok) throw new Error(`PDF fetch ${r.status}`);
        const buf = await r.arrayBuffer();
        if (cancelled) return;
        const blob = new Blob([buf], { type: 'application/pdf' });
        created = URL.createObjectURL(blob);
        setUrl(created);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load PDF');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { url, loading, error };
}
