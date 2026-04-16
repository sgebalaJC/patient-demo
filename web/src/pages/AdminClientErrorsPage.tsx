import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import { AlertTriangle, Bug, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { AccessDenied } from '../components/ui/AccessDenied';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { FilterTabs } from '../components/ui/FilterTabs';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';

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
  const [rows, setRows] = useState<ClientErrorDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<LevelFilter>('all');

  useEffect(() => {
    if (userProfile?.role !== 'super_admin') return;

    const base = collection(db, 'client-errors');
    const q = level === 'all'
      ? query(base, orderBy('createdAt', 'desc'), limit(200))
      : query(base, where('level', '==', level), orderBy('createdAt', 'desc'), limit(200));

    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ClientErrorDoc, 'id'>) })));
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [userProfile?.role, level]);

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
    } catch {
      /* noop — reality of offline admin is fine */
    }
  };

  const stats = useMemo(() => {
    let errors = 0;
    let warns = 0;
    for (const r of rows) {
      if (r.level === 'error') errors++;
      else if (r.level === 'warn') warns++;
    }
    return { errors, warns };
  }, [rows]);

  if (userProfile && userProfile.role !== 'super_admin') {
    return <AccessDenied message="Client error logs are admin-only." />;
  }

  return (
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
          { key: 'all', label: 'All', count: rows.length },
          { key: 'error', label: 'Errors', count: stats.errors },
          { key: 'warn', label: 'Warnings', count: stats.warns },
        ]}
      />
      <p className="text-xs text-secondary-500 -mt-3">
        Live feed. Latest 200. PII is scrubbed server-side before write.
      </p>

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
        </div>
      )}
    </div>
  );
};
