import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Users, GitBranch, Search, Route, Loader2, Database, FlaskConical, Eye, EyeOff, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import type { DatabaseInfo } from '@fsf/shared';
import { api } from '../services/api';
import { useSocketConnection, useSocketEvent } from '../hooks/useSocket';

// Platform badge colors
const platformColors: Record<string, { bg: string; text: string }> = {
  familysearch: { bg: 'bg-app-success-subtle', text: 'text-app-success' },
  myheritage: { bg: 'bg-orange-600/10 dark:bg-orange-600/20', text: 'text-orange-600 dark:text-orange-400' },
  geni: { bg: 'bg-cyan-600/10 dark:bg-cyan-600/20', text: 'text-cyan-600 dark:text-cyan-400' },
  wikitree: { bg: 'bg-purple-600/10 dark:bg-purple-600/20', text: 'text-purple-600 dark:text-purple-400' },
  findmypast: { bg: 'bg-app-accent-subtle', text: 'text-app-accent' },
  ancestry: { bg: 'bg-emerald-600/10 dark:bg-emerald-600/20', text: 'text-emerald-600 dark:text-emerald-400' },
};

interface DeleteConfirmModalProps {
  database: DatabaseInfo | null;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}

function DeleteConfirmModal({ database, onConfirm, onCancel, isDeleting }: DeleteConfirmModalProps) {
  if (!database) return null;

  return (
    <div className="fixed inset-0 bg-app-overlay flex items-center justify-center z-50">
      <div className="bg-app-card border border-app-border rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold text-app-text mb-4">Remove Root?</h2>
        <p className="text-app-text-muted mb-2">
          Are you sure you want to remove the root entry for:
        </p>
        <p className="text-app-text font-semibold mb-1">
          {database.rootName || database.rootId}
        </p>
        <p className="text-app-text-muted text-sm mb-6">
          This removes the root entry only. The {database.personCount.toLocaleString()} ancestors remain in the database and can be accessed from other roots or by making this person a root again.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 bg-app-border text-app-text rounded hover:opacity-80 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 bg-red-600 text-app-text rounded hover:bg-red-500 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isDeleting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Removing...
              </>
            ) : (
              <>
                <Trash2 size={16} />
                Remove
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatabaseInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [showSamples, setShowSamples] = useState(() => {
    const stored = localStorage.getItem('sparsetree:showSamples');
    return stored === null ? true : stored === 'true';
  });

  // Connect to socket for real-time updates
  useSocketConnection();

  // Handle database refresh events via socket
  const handleRefreshEvent = useCallback((data: { dbId: string; status: string; personCount?: number; data?: DatabaseInfo; message?: string }) => {
    if (data.status === 'complete' && data.data) {
      setDatabases(prev => prev.map(d => d.id === data.dbId ? data.data! : d));
      toast.success(`Updated count: ${data.personCount?.toLocaleString()} people`);
      setRefreshingId(null);
    } else if (data.status === 'error') {
      toast.error(`Failed to refresh: ${data.message || 'Unknown error'}`);
      setRefreshingId(null);
    }
  }, []);

  useSocketEvent('database:refresh', handleRefreshEvent);

  useEffect(() => {
    api.listDatabases()
      .then(setDatabases)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    localStorage.setItem('sparsetree:showSamples', String(showSamples));
  }, [showSamples]);

  // Filter databases based on sample visibility
  const visibleDatabases = showSamples
    ? databases
    : databases.filter(db => !db.isSample);

  const sampleCount = databases.filter(db => db.isSample).length;

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);

    const deleted = await api.deleteDatabase(deleteTarget.id)
      .then(() => true)
      .catch(err => {
        toast.error(`Failed to delete: ${err.message}`);
        return false;
      });

    if (deleted) {
      setDatabases(prev => prev.filter(db => db.id !== deleteTarget.id));
      toast.success(`Root "${deleteTarget.rootName || deleteTarget.rootId}" removed`);
    }

    setIsDeleting(false);
    setDeleteTarget(null);
  };

  const handleRefresh = async (db: DatabaseInfo) => {
    setRefreshingId(db.id);

    // Trigger refresh via API - socket will receive the result
    await api.refreshRootCount(db.id).catch(err => {
      toast.error(`Failed to start refresh: ${err.message}`);
      setRefreshingId(null);
    });
  };

  if (loading) {
    return <div className="text-center py-8 text-app-text-muted">Loading roots...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-app-error">Error: {error}</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-app-text">Family Tree Roots</h1>
        {sampleCount > 0 && (
          <button
            onClick={() => setShowSamples(!showSamples)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-app-border text-app-text-muted rounded hover:text-app-text transition-colors"
            title={showSamples ? 'Hide sample data' : 'Show sample data'}
          >
            {showSamples ? <EyeOff size={16} /> : <Eye size={16} />}
            <FlaskConical size={14} />
            <span>{showSamples ? 'Hide' : 'Show'} Samples</span>
          </button>
        )}
      </div>

      {visibleDatabases.length === 0 ? (
        <div className="text-center py-8 text-app-text-muted">
          <p>No roots found.</p>
          <Link to="/indexer" className="text-app-accent hover:underline mt-2 inline-block">
            Start indexing a family tree
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleDatabases.map(db => (
            <div
              key={db.id}
              className="bg-app-card rounded-lg border border-app-border p-4 hover:border-app-accent/50 transition-colors"
            >
              {/* Badges row */}
              <div className="flex items-center gap-2 mb-2">
                {db.isSample && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-600/20 text-amber-600 dark:text-amber-400">
                    <FlaskConical size={10} />
                    Sample
                  </span>
                )}
                {db.sourceProvider && (
                  (() => {
                    const colors = platformColors[db.sourceProvider] || { bg: 'bg-app-text-muted/20', text: 'text-app-text-muted' };
                    return (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${colors.bg} ${colors.text}`}>
                        <Database size={10} />
                        {db.sourceProvider}
                      </span>
                    );
                  })()
                )}
              </div>

              {/* Header with name and actions */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-lg text-app-text truncate">
                    {db.rootName || 'Unknown Person'}
                  </h2>
                  <p className="text-xs text-app-text-muted font-mono">{db.rootExternalId || db.rootId}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                  <button
                    onClick={() => handleRefresh(db)}
                    disabled={refreshingId === db.id}
                    className="p-1.5 text-app-text-muted hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors disabled:opacity-50"
                    title="Refresh ancestor count"
                  >
                    <RefreshCw size={16} className={refreshingId === db.id ? 'animate-spin' : ''} />
                  </button>
                  {!db.isSample && (
                    <button
                      onClick={() => setDeleteTarget(db)}
                      className="p-1.5 text-app-text-muted hover:text-app-error hover:bg-app-error-subtle rounded transition-colors"
                      title="Remove root"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 text-sm text-app-text-muted mb-4">
                <span className="flex items-center gap-1">
                  <Users size={14} />
                  {db.personCount.toLocaleString()} people
                </span>
                {db.maxGenerations && (
                  <span className="flex items-center gap-1">
                    <GitBranch size={14} />
                    {db.maxGenerations} gen
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 text-sm">
                <Link
                  to={`/tree/${db.id}`}
                  className="flex items-center gap-1 px-3 py-1.5 bg-app-accent/20 text-app-accent rounded hover:bg-app-accent/30 transition-colors"
                >
                  <GitBranch size={14} />
                  Tree
                </Link>
                <Link
                  to={`/search/${db.id}`}
                  className="flex items-center gap-1 px-3 py-1.5 bg-app-border text-app-text rounded hover:opacity-80 transition-colors"
                >
                  <Search size={14} />
                  Search
                </Link>
                <Link
                  to={`/path/${db.id}`}
                  className="flex items-center gap-1 px-3 py-1.5 bg-app-border text-app-text rounded hover:opacity-80 transition-colors"
                >
                  <Route size={14} />
                  Path
                </Link>
                <Link
                  to={`/person/${db.id}/${db.rootId}`}
                  className="flex items-center gap-1 px-3 py-1.5 bg-app-border text-app-text rounded hover:opacity-80 transition-colors"
                >
                  <Users size={14} />
                  Root
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation modal */}
      <DeleteConfirmModal
        database={deleteTarget}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        isDeleting={isDeleting}
      />
    </div>
  );
}
