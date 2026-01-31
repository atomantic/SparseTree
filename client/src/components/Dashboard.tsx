import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Users, GitBranch, Search, Route, Loader2, Database, FlaskConical, Eye, EyeOff, RefreshCw, Calculator, Download } from 'lucide-react';
import { CopyButton } from './ui/CopyButton';
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
    <div className="fixed inset-0 bg-app-overlay flex items-center justify-center z-50 p-4">
      <div className="bg-app-card border border-app-border rounded-lg p-4 sm:p-6 max-w-md w-full">
        <h2 className="text-lg sm:text-xl font-bold text-app-text mb-3 sm:mb-4">Remove Root?</h2>
        <p className="text-app-text-muted mb-2 text-sm sm:text-base">
          Are you sure you want to remove the root entry for:
        </p>
        <p className="text-app-text font-semibold mb-1 text-sm sm:text-base break-words">
          {database.rootName || database.rootId}
        </p>
        <p className="text-app-text-muted text-xs sm:text-sm mb-4 sm:mb-6">
          This removes the root entry only. The {database.personCount.toLocaleString()} ancestors remain in the database and can be accessed from other roots or by making this person a root again.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-end">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2.5 min-h-[40px] bg-app-border text-app-text rounded hover:opacity-80 transition-colors disabled:opacity-50 order-2 sm:order-1"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2.5 min-h-[40px] bg-red-600 text-app-text rounded hover:bg-red-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 order-1 sm:order-2"
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
  const [calculatingGenId, setCalculatingGenId] = useState<string | null>(null);
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
      toast.success(`Updated count: ${data.personCount?.toLocaleString()} parents`);
      setRefreshingId(null);
    } else if (data.status === 'error') {
      toast.error(`Failed to refresh: ${data.message || 'Unknown error'}`);
      setRefreshingId(null);
    }
  }, []);

  useSocketEvent('database:refresh', handleRefreshEvent);

  // Handle generation calculation events via socket
  const handleGenerationsEvent = useCallback((data: { dbId: string; status: string; maxGenerations?: number; data?: DatabaseInfo; message?: string }) => {
    if (data.status === 'complete' && data.data) {
      setDatabases(prev => prev.map(d => d.id === data.dbId ? data.data! : d));
      toast.success(`Calculated: ${data.maxGenerations} generations`);
      setCalculatingGenId(null);
    } else if (data.status === 'error') {
      toast.error(`Failed to calculate generations: ${data.message || 'Unknown error'}`);
      setCalculatingGenId(null);
    }
  }, []);

  useSocketEvent('database:generations', handleGenerationsEvent);

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

  const handleCalculateGenerations = async (db: DatabaseInfo) => {
    setCalculatingGenId(db.id);

    // Trigger calculation via API - socket will receive the result
    await api.calculateGenerations(db.id).catch(err => {
      toast.error(`Failed to start generation calculation: ${err.message}`);
      setCalculatingGenId(null);
    });
  };

  if (loading) {
    return <div className="text-center py-8 text-app-text-muted">Loading roots...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-app-error">Error: {error}</div>;
  }

  return (
    <div className="p-3 sm:p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 md:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-app-text">Family Tree Roots</h1>
        {sampleCount > 0 && (
          <button
            onClick={() => setShowSamples(!showSamples)}
            className="flex items-center justify-center gap-2 px-3 py-2.5 min-h-[40px] text-sm bg-app-border text-app-text-muted rounded hover:text-app-text transition-colors"
            title={showSamples ? 'Hide sample data' : 'Show sample data'}
          >
            {showSamples ? <EyeOff size={16} /> : <Eye size={16} />}
            <FlaskConical size={14} />
            <span className="whitespace-nowrap">{showSamples ? 'Hide' : 'Show'} Samples</span>
          </button>
        )}
      </div>

      {visibleDatabases.length === 0 ? (
        <div className="text-center py-8 text-app-text-muted">
          <p>No roots found.</p>
          <Link to="/indexer" className="text-app-accent hover:underline mt-2 inline-block min-h-[40px] flex items-center justify-center">
            Start indexing a family tree
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleDatabases.map(db => (
            <div
              key={db.id}
              className="bg-app-card rounded-lg border border-app-border p-3 sm:p-4 hover:border-app-accent/50 transition-colors"
            >
              {/* Sample badge */}
              {db.isSample && (
                <div className="mb-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-600/20 text-amber-600 dark:text-amber-400">
                    <FlaskConical size={10} />
                    Sample
                  </span>
                </div>
              )}

              {/* Header with photo, name and actions */}
              <div className="flex items-start gap-2 sm:gap-3 mb-2">
                {/* Photo */}
                {db.hasPhoto && (
                  <Link to={`/person/${db.id}/${db.rootId}`} className="flex-shrink-0">
                    <img
                      src={api.getPhotoUrl(db.rootId)}
                      alt={db.rootName || 'Root person'}
                      className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg object-cover border border-app-border hover:border-app-accent transition-colors"
                    />
                  </Link>
                )}
                {/* Name and actions */}
                <div className="flex-1 min-w-0 flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-base sm:text-lg text-app-text truncate">
                      {db.rootName || 'Unknown Person'}
                    </h2>
                  </div>
                  <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0 ml-1 sm:ml-2">
                    <button
                      onClick={() => handleRefresh(db)}
                      disabled={refreshingId === db.id}
                      className="p-2 sm:p-1.5 min-h-[40px] sm:min-h-0 min-w-[40px] sm:min-w-0 flex items-center justify-center text-app-text-muted hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors disabled:opacity-50"
                      title="Refresh ancestor count"
                    >
                      <RefreshCw size={16} className={refreshingId === db.id ? 'animate-spin' : ''} />
                    </button>
                    {!db.isSample && (
                      <button
                        onClick={() => setDeleteTarget(db)}
                        className="p-2 sm:p-1.5 min-h-[40px] sm:min-h-0 min-w-[40px] sm:min-w-0 flex items-center justify-center text-app-text-muted hover:text-app-error hover:bg-app-error-subtle rounded transition-colors"
                        title="Remove root"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Platform IDs */}
              <div className="mb-3 space-y-1">
                {/* SparseTree canonical ID */}
                <div className="flex items-center gap-1 sm:gap-1.5 text-xs">
                  <span className="inline-flex items-center gap-0.5 sm:gap-1 px-1 sm:px-1.5 py-0.5 rounded bg-app-accent/10 text-app-accent font-medium min-w-[60px] sm:min-w-[70px] text-[10px] sm:text-xs">
                    <Database size={10} className="flex-shrink-0" />
                    <span className="truncate">sparsetree</span>
                  </span>
                  <span className="font-mono text-app-text-muted truncate text-[10px] sm:text-xs">{db.rootId}</span>
                  <CopyButton text={db.rootId} size={10} />
                </div>
                {/* External platform IDs */}
                {db.externalIds && Object.entries(db.externalIds).map(([platform, extId]) => {
                  const colors = platformColors[platform] || { bg: 'bg-app-text-muted/20', text: 'text-app-text-muted' };
                  return (
                    <div key={platform} className="flex items-center gap-1 sm:gap-1.5 text-xs">
                      <span className={`inline-flex items-center gap-0.5 sm:gap-1 px-1 sm:px-1.5 py-0.5 rounded font-medium min-w-[60px] sm:min-w-[70px] text-[10px] sm:text-xs ${colors.bg} ${colors.text}`}>
                        <Database size={10} className="flex-shrink-0" />
                        <span className="truncate">{platform}</span>
                      </span>
                      <span className="font-mono text-app-text-muted truncate text-[10px] sm:text-xs">{extId}</span>
                      <CopyButton text={extId} size={10} />
                      {platform === 'familysearch' && (
                        <Link
                          to={`/indexer?rootId=${extId}`}
                          className="p-1 sm:p-0.5 min-h-[24px] min-w-[24px] flex items-center justify-center text-app-text-muted hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors"
                          title="Update from FamilySearch"
                        >
                          <Download size={10} />
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Stats */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-app-text-muted mb-3 sm:mb-4">
                <span className="flex items-center gap-1">
                  <Users size={14} className="flex-shrink-0" />
                  <span className="whitespace-nowrap">{db.personCount.toLocaleString()} parents</span>
                </span>
                {db.maxGenerations ? (
                  <span className="flex items-center gap-1">
                    <GitBranch size={14} className="flex-shrink-0" />
                    <span className="whitespace-nowrap">{db.maxGenerations} gen</span>
                  </span>
                ) : (
                  <button
                    onClick={() => handleCalculateGenerations(db)}
                    disabled={calculatingGenId === db.id}
                    className="flex items-center gap-1 px-2 py-1.5 min-h-[32px] text-xs bg-app-border rounded hover:bg-app-accent/20 hover:text-app-accent transition-colors disabled:opacity-50"
                    title="Calculate max generation depth"
                  >
                    {calculatingGenId === db.id ? (
                      <Loader2 size={12} className="animate-spin flex-shrink-0" />
                    ) : (
                      <Calculator size={12} className="flex-shrink-0" />
                    )}
                    <span className="whitespace-nowrap">calc gen</span>
                  </button>
                )}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 text-xs sm:text-sm">
                <Link
                  to={`/tree/${db.id}`}
                  className="flex items-center justify-center gap-1 px-3 py-2 min-h-[40px] bg-app-accent/20 text-app-accent rounded hover:bg-app-accent/30 transition-colors"
                >
                  <GitBranch size={14} className="flex-shrink-0" />
                  <span>Tree</span>
                </Link>
                <Link
                  to={`/search/${db.id}`}
                  className="flex items-center justify-center gap-1 px-3 py-2 min-h-[40px] bg-app-border text-app-text rounded hover:opacity-80 transition-colors"
                >
                  <Search size={14} className="flex-shrink-0" />
                  <span>Search</span>
                </Link>
                <Link
                  to={`/path/${db.id}`}
                  className="flex items-center justify-center gap-1 px-3 py-2 min-h-[40px] bg-app-border text-app-text rounded hover:opacity-80 transition-colors"
                >
                  <Route size={14} className="flex-shrink-0" />
                  <span>Path</span>
                </Link>
                <Link
                  to={`/person/${db.id}/${db.rootId}`}
                  className="flex items-center justify-center gap-1 px-3 py-2 min-h-[40px] bg-app-border text-app-text rounded hover:opacity-80 transition-colors"
                >
                  <Users size={14} className="flex-shrink-0" />
                  <span>Root</span>
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
