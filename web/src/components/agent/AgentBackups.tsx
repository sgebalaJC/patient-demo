import React, { useState, useEffect } from 'react';
import { Archive, Trash2, RotateCcw, Plus } from 'lucide-react';
import { sidecar } from '../../lib/sidecar';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { EmptyState } from '../ui/EmptyState';
import { ConfirmModal } from '../ui/ConfirmModal';

interface Backup {
  name: string;
  sizeMb: number;
  createdAt: string;
}

export const AgentBackups: React.FC = () => {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadBackups = async () => {
    try {
      const data = await sidecar.listBackups();
      setBackups(data.backups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      await sidecar.createBackup();
      await loadBackups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setActionLoading(true);
    setError('');
    try {
      await sidecar.restoreBackup(restoreTarget);
      setRestoreTarget(null);
      await loadBackups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore backup');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    setError('');
    try {
      await sidecar.deleteBackup(deleteTarget);
      setDeleteTarget(null);
      await loadBackups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete backup');
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-secondary-900">Backups</h2>
          <p className="text-sm text-secondary-500 mt-0.5">
            Back up and restore OpenClaw state, config, and memories
          </p>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50"
        >
          {creating ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {creating ? 'Creating...' : 'Create Backup'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {backups.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="No backups yet"
          description="Create your first backup to protect the agent's state, config, and memories."
        />
      ) : (
        <div className="space-y-2 max-w-2xl">
          {backups.map((backup) => (
            <div key={backup.name} className="card p-4 flex items-center gap-4">
              <div className="bg-secondary-100 p-2 rounded-lg">
                <Archive className="h-5 w-5 text-secondary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-secondary-900 truncate">{backup.name}</p>
                <p className="text-xs text-secondary-500">
                  {formatDate(backup.createdAt)} &middot; {backup.sizeMb} MB
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setRestoreTarget(backup.name)}
                  className="p-2 rounded-lg text-secondary-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                  title="Restore"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setDeleteTarget(backup.name)}
                  className="p-2 rounded-lg text-secondary-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Restore confirmation */}
      <ConfirmModal
        isOpen={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={handleRestore}
        title="Restore Backup"
        message={`This will stop the agent, restore from "${restoreTarget}", and restart. A safety backup will be created automatically before restoring. Continue?`}
        confirmLabel={actionLoading ? 'Restoring...' : 'Restore'}
        variant="warning"
      />

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Backup"
        message={`Are you sure you want to delete "${deleteTarget}"? This cannot be undone.`}
        confirmLabel={actionLoading ? 'Deleting...' : 'Delete'}
        variant="danger"
      />
    </div>
  );
};
