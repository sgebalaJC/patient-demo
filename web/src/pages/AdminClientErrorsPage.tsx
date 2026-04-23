import React, { useMemo, useState } from 'react';
import { deleteDoc, doc, Timestamp } from 'firebase/firestore';
import { AlertTriangle, Bug, ChevronDown, ChevronRight, Trash2, RefreshCw } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { AdminGuard } from '../components/ui/AdminGuard';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { FilterTabs } from '../components/ui/FilterTabs';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import { PaginationBar } from '../components/ui/PaginationBar';
import { usePagedCollection, type WhereClause } from '../hooks/usePagedCollection';
import { useCollectionCounts } from '../hooks/useCollectionCounts';

interface ClientErrorDoc {
  id: string;
  level: 'error' | 'warn';
  message: string;
  stack: string;
  route: string;
  userAgent: string;
  context: string;
  uid: string | null;
  role: string | null;
  createdAt?: Timestamp;
}

type LevelFilter = 'all' | 'error' | 'warn';

export const AdminClientErrorsPage: React.FC = () => {
  const { userProfile } = useAuth();
  const isSuperAdmin = userProfile?.role === 'super_admin';
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<LevelFilter>('all');

  const whereClauses = useMemo<WhereClause[] | undefined>(
    () => (level === 'all' ? undefined : [['level', '==', level]]),
    [level],
  );

  const paged = usePagedCollection<ClientErrorDoc>({
    enabled: isSuperAdmin,
    real: 'client-errors',
    orderField: 'createdAt',
    pageSize: 25,
    whereClauses,
    mapDoc: (d) => ({ ...(d.data() as Omit<ClientErrorDoc, 'id'>), id: d.id }),
  });
  const rows = paged.rows;
  const loading = paged.loading;

  const countsPredicates = useMemo(() => ({
    all: [] as [string, '==', string][],
    error: [['level', '==', 'error']] as [string, '==', string][],
    warn: [['level', '==', 'warn']] as [string, '==', string][],
  }), []);
  const { counts, refresh: refreshCounts } = useCollectionCounts({
    enabled: isSuperAdmin,
    real: 'client-errors',
    predicates: countsPredicates,
  });

  const refreshAll = () => { paged.refresh(); refreshCounts(); };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'client-errors', id));
      refreshAll();
    } catch {
      /* noop — reality of offline admin is fine */
    }
  };

  return (
    <AdminGuard superOnly>
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        icon={Bug}
        title="Client Errors"
        subtitle="Browser-side errors and warnings forwarded from the web app."
      />

      <FilterTabs
        activeKey={level}
        onChange={(k) => setLevel(k as LevelFilter)}
        tabs={[
          { key: 'all', label: 'All', count: counts.all },
          { key: 'error', label: 'Errors', count: counts.error },
          { key: 'warn', label: 'Warnings', count: counts.warn },
        ]}
      />
      <div className="flex items-center justify-between -mt-3">
        <p className="text-xs text-secondary-500">
          Cursor-paged. PII is scrubbed server-side before write.
        </p>
        <Button onClick={refreshAll} loading={loading} variant="secondary" size="sm">
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {loading ? (
        <LoadingState title="Loading client errors…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No client errors yet"
          description="Uncaught exceptions, unhandled promise rejections, and logger.error() calls from the web app will show up here."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const isOpen = expanded.has(row.id);
            const ts = row.createdAt?.toDate?.();
            const timeStr = ts ? ts.toLocaleString() : '—';
            return (
              <Card key={row.id}>
                <button
                  onClick={() => toggle(row.id)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-secondary-50 transition-colors"
                >
                  <div className="flex-shrink-0 pt-0.5">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-secondary-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-secondary-500" />
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        row.level === 'error'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {row.level.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-secondary-900 truncate">
                      {row.message || '(no message)'}
                    </p>
                    <p className="text-xs text-secondary-500 mt-0.5">
                      {timeStr}
                      {row.route && <> · <span className="font-mono">{row.route}</span></>}
                      {row.uid && <> · uid:{row.uid.slice(0, 8)}</>}
                      {row.role && <> · {row.role}</>}
                    </p>
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-0 border-t border-secondary-100 space-y-3 text-xs">
                    {row.stack && (
                      <div>
                        <p className="font-semibold text-secondary-700 mb-1">Stack</p>
                        <pre className="bg-secondary-50 p-3 rounded overflow-x-auto text-secondary-800 whitespace-pre-wrap break-all">
                          {row.stack}
                        </pre>
                      </div>
                    )}
                    {row.context && (
                      <div>
                        <p className="font-semibold text-secondary-700 mb-1">Context</p>
                        <pre className="bg-secondary-50 p-3 rounded overflow-x-auto text-secondary-800 whitespace-pre-wrap break-all">
                          {row.context}
                        </pre>
                      </div>
                    )}
                    {row.userAgent && (
                      <p className="text-secondary-500">
                        <span className="font-semibold text-secondary-700">User agent:</span>{' '}
                        {row.userAgent}
                      </p>
                    )}
                    <div>
                      <button
                        onClick={() => handleDelete(row.id)}
                        className="inline-flex items-center gap-1 text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
          <PaginationBar
            currentPage={paged.page}
            pageSize={paged.pageSize}
            totalItems={(paged.page - 1) * paged.pageSize + rows.length + (paged.hasNext ? 1 : 0)}
            hasMore={paged.hasNext}
            onPreviousPage={paged.prev}
            onNextPage={paged.next}
            label="errors"
          />
        </div>
      )}
    </div>
    </AdminGuard>
  );
};
