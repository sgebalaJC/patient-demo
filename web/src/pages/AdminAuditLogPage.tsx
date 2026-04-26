import React, { useEffect, useState } from 'react';
import { ScrollText, RefreshCw, Filter } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { PageHeader } from '../components/ui/PageHeader';
import { AdminGuard } from '../components/ui/AdminGuard';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AlertBanner } from '../components/ui/AlertBanner';
import { auditLogOps, type AuditLogEntry, type AuditLogFilter } from '../lib/firestore/audit-logs';
import type { DocumentSnapshot } from 'firebase/firestore';

const PAGE_SIZE = 50;

const AdminAuditLogPageInner: React.FC = () => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [filterDraft, setFilterDraft] = useState<AuditLogFilter>({});
  const [activeFilter, setActiveFilter] = useState<AuditLogFilter>({});

  const fetchPage = async (filter: AuditLogFilter, append: boolean) => {
    setLoading(true);
    setError('');
    const r = await auditLogOps.list(filter);
    if (!r.success || !r.data) {
      setError(r.error ?? 'Failed to load');
      setLoading(false);
      return;
    }
    setEntries((prev) => (append ? [...prev, ...r.data!.entries] : r.data!.entries));
    setCursor(r.data.cursor);
    setHasMore(r.data.entries.length >= (filter.pageSize ?? PAGE_SIZE));
    setLoading(false);
  };

  useEffect(() => {
    void fetchPage({ ...activeFilter, pageSize: PAGE_SIZE }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter]);

  const applyFilter = () => setActiveFilter({ ...filterDraft });
  const clearFilter = () => {
    setFilterDraft({});
    setActiveFilter({});
  };
  const loadMore = () =>
    cursor && fetchPage({ ...activeFilter, pageSize: PAGE_SIZE, startAfter: cursor }, true);

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/admin"
        icon={ScrollText}
        title="Audit log"
        subtitle="Every admin and user action. Super-admin only. Mirrors Cloud Logging at jsonPayload.audit=true."
        iconColor="bg-amber-100 text-amber-700"
      />

      <AlertBanner message={error || null} variant="error" />

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="h-4 w-4 text-secondary-600" />
          Filters
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input
            label="Actor UID"
            value={filterDraft.actorId ?? ''}
            onChange={(e) => setFilterDraft({ ...filterDraft, actorId: e.target.value || undefined })}
          />
          <Input
            label="Action"
            placeholder="user.updated"
            value={filterDraft.action ?? ''}
            onChange={(e) => setFilterDraft({ ...filterDraft, action: e.target.value || undefined })}
          />
          <Input
            label="Resource type"
            placeholder="appointment"
            value={filterDraft.resourceType ?? ''}
            onChange={(e) => setFilterDraft({ ...filterDraft, resourceType: e.target.value || undefined })}
          />
          <Input
            label="Resource id"
            value={filterDraft.resourceId ?? ''}
            onChange={(e) => setFilterDraft({ ...filterDraft, resourceId: e.target.value || undefined })}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={applyFilter} disabled={loading}>
            Apply
          </Button>
          <Button variant="ghost" onClick={clearFilter} disabled={loading}>
            Clear
          </Button>
          <Button variant="ghost" onClick={() => fetchPage({ ...activeFilter, pageSize: PAGE_SIZE }, false)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading && entries.length === 0 ? (
          <div className="p-8 flex justify-center">
            <LoadingSpinner />
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-secondary-500 text-sm">
            No audit entries match these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary-50 border-b border-secondary-200 text-xs uppercase tracking-wide text-secondary-600">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Actor</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Resource</th>
                  <th className="px-3 py-2 text-left">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const when = e.timestamp ? e.timestamp.toDate() : new Date(e.clientTimestamp || 0);
                  const meta = Object.keys(e.metadata).length > 0 ? JSON.stringify(e.metadata) : '';
                  return (
                    <tr key={e.id} className="border-b border-secondary-100 hover:bg-secondary-50 align-top">
                      <td className="px-3 py-2 text-xs text-secondary-700 whitespace-nowrap">
                        {when.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="text-secondary-900">{e.actorEmail ?? e.actorId}</div>
                        <div className="text-secondary-500">{e.actorRole}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <code className="bg-secondary-100 px-1 py-0.5 rounded">{e.action}</code>
                      </td>
                      <td className="px-3 py-2 text-xs text-secondary-700">
                        {e.resourceType ? (
                          <>
                            <div>{e.resourceType}</div>
                            <div className="text-secondary-500 truncate max-w-[12em]" title={e.resourceId ?? ''}>
                              {e.resourceId}
                            </div>
                          </>
                        ) : (
                          <span className="text-secondary-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-secondary-700 max-w-md">
                        {meta && <code className="text-secondary-600 break-all">{meta}</code>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
};

export const AdminAuditLogPage: React.FC = () => (
  <AdminGuard superOnly>
    <AdminAuditLogPageInner />
  </AdminGuard>
);
