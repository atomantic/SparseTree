import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  RefreshCw,
  Loader2,
  Link2,
  Unlink,
  AlertTriangle,
  Clock,
  Play,
  Square,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import type {
  IntegritySummary,
  ProviderCoverageGap,
  ParentLinkageGap,
  OrphanedEdge,
  StaleRecord,
  BuiltInProvider,
  BulkDiscoveryProgress,
  DatabaseInfo,
} from '@fsf/shared';

type TabId = 'parents' | 'coverage' | 'orphans' | 'stale';

const TABS: { id: TabId; label: string }[] = [
  { id: 'coverage', label: 'Coverage' },
  { id: 'parents', label: 'Parents' },
  { id: 'orphans', label: 'Orphans' },
  { id: 'stale', label: 'Stale' },
];

const PROVIDER_OPTIONS: { value: BuiltInProvider; label: string }[] = [
  { value: 'familysearch', label: 'FamilySearch' },
  { value: 'ancestry', label: 'Ancestry' },
  { value: 'wikitree', label: 'WikiTree' },
];

const VALID_TABS = new Set<string>(TABS.map(t => t.id));

export function IntegrityPage() {
  const { dbId, tab } = useParams<{ dbId: string; tab?: string }>();
  const navigate = useNavigate();
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [summary, setSummary] = useState<IntegritySummary | null>(null);
  const activeTab: TabId = (tab && VALID_TABS.has(tab) ? tab : 'coverage') as TabId;
  const setActiveTab = useCallback((t: TabId) => {
    navigate(`/db/${dbId}/integrity/${t}`, { replace: true });
  }, [dbId, navigate]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Parents tab state
  const [selectedProvider, setSelectedProvider] = useState<BuiltInProvider>('familysearch');
  const [parentGaps, setParentGaps] = useState<ParentLinkageGap[]>([]);
  const [parentGapsLoading, setParentGapsLoading] = useState(false);

  // Coverage tab state
  const [coverageGaps, setCoverageGaps] = useState<ProviderCoverageGap[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(false);

  // Orphans tab state
  const [orphanedEdges, setOrphanedEdges] = useState<OrphanedEdge[]>([]);
  const [orphansLoading, setOrphansLoading] = useState(false);

  // Stale tab state
  const [staleRecords, setStaleRecords] = useState<StaleRecord[]>([]);
  const [staleLoading, setStaleLoading] = useState(false);
  const [staleDays, setStaleDays] = useState(30);

  // Bulk discovery state
  const [discoveryProgress, setDiscoveryProgress] = useState<BulkDiscoveryProgress | null>(null);
  const [discoveryRunning, setDiscoveryRunning] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Load database info on mount (fast query, no integrity checks)
  useEffect(() => {
    if (!dbId) return;
    setLoading(true);
    api.getDatabase(dbId)
      .then(setDatabase)
      .catch(err => toast.error(`Failed to load database: ${err.message}`))
      .finally(() => setLoading(false));
  }, [dbId]);

  const runChecks = useCallback(() => {
    if (!dbId) return;
    setRefreshing(true);
    api.getIntegritySummary(dbId)
      .then(setSummary)
      .catch(err => toast.error(`Failed to run integrity checks: ${err.message}`))
      .finally(() => setRefreshing(false));
  }, [dbId]);

  // Load tab data when tab changes
  useEffect(() => {
    if (!dbId) return;

    if (activeTab === 'parents') {
      loadParentGaps();
    } else if (activeTab === 'coverage') {
      loadCoverageGaps();
    } else if (activeTab === 'orphans') {
      loadOrphanedEdges();
    } else if (activeTab === 'stale') {
      loadStaleRecords();
    }
  }, [activeTab, dbId, selectedProvider, staleDays]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const loadParentGaps = () => {
    if (!dbId) return;
    setParentGapsLoading(true);
    api.getParentLinkageGaps(dbId, selectedProvider)
      .then(setParentGaps)
      .catch(err => toast.error(`Failed to load parent gaps: ${err.message}`))
      .finally(() => setParentGapsLoading(false));
  };

  const loadCoverageGaps = () => {
    if (!dbId) return;
    setCoverageLoading(true);
    api.getProviderCoverageGaps(dbId)
      .then(setCoverageGaps)
      .catch(err => toast.error(`Failed to load coverage gaps: ${err.message}`))
      .finally(() => setCoverageLoading(false));
  };

  const loadOrphanedEdges = () => {
    if (!dbId) return;
    setOrphansLoading(true);
    api.getOrphanedEdges(dbId)
      .then(setOrphanedEdges)
      .catch(err => toast.error(`Failed to load orphaned edges: ${err.message}`))
      .finally(() => setOrphansLoading(false));
  };

  const loadStaleRecords = () => {
    if (!dbId) return;
    setStaleLoading(true);
    api.getStaleRecords(dbId, staleDays)
      .then(setStaleRecords)
      .catch(err => toast.error(`Failed to load stale records: ${err.message}`))
      .finally(() => setStaleLoading(false));
  };

  const startBulkDiscovery = () => {
    if (!dbId) return;

    // Close any existing connection
    eventSourceRef.current?.close();

    setDiscoveryRunning(true);
    setDiscoveryProgress(null);

    // Connect to SSE stream
    const eventSource = new EventSource(`/api/integrity/${dbId}/discover-all/events?provider=${selectedProvider}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const progress: BulkDiscoveryProgress = JSON.parse(event.data);
      setDiscoveryProgress(progress);

      if (progress.type === 'completed' || progress.type === 'error' || progress.type === 'cancelled') {
        setDiscoveryRunning(false);
        eventSource.close();
        eventSourceRef.current = null;

        if (progress.type === 'completed') {
          toast.success(`Discovery complete: ${progress.discovered} links found`);
          // Refresh data
          runChecks();
          loadParentGaps();
        } else if (progress.type === 'cancelled') {
          toast('Discovery cancelled');
        } else {
          toast.error(progress.message || 'Discovery failed');
        }
      }
    };

    eventSource.onerror = () => {
      setDiscoveryRunning(false);
      eventSource.close();
      eventSourceRef.current = null;
      toast.error('Lost connection to discovery stream');
    };
  };

  const cancelBulkDiscovery = () => {
    if (!dbId) return;
    api.cancelBulkDiscovery(dbId)
      .then(() => toast('Cancelling discovery...'))
      .catch(err => toast.error(`Failed to cancel: ${err.message}`));
  };

  if (!dbId) {
    return (
      <div className="text-center py-16">
        <p className="text-app-error">No database selected</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={32} className="animate-spin text-app-accent" />
      </div>
    );
  }

  const dbName = database?.rootName || dbId;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck size={24} className="text-app-accent" />
          <div>
            <h1 className="text-2xl font-bold text-app-text">Data Integrity</h1>
            <p className="text-sm text-app-text-muted">{dbName}</p>
          </div>
        </div>
        <button
          onClick={runChecks}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-app-card border border-app-border text-app-text hover:bg-app-hover transition-colors disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          {summary ? 'Refresh' : 'Run Checks'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Coverage Gaps"
          count={summary?.coverageGaps ?? -1}
          icon={<Link2 size={20} />}
          color="text-blue-500"
          onClick={() => setActiveTab('coverage')}
          active={activeTab === 'coverage'}
        />
        <SummaryCard
          label="Parent Linkage"
          count={summary?.parentLinkageGaps ?? -1}
          icon={<Unlink size={20} />}
          color="text-orange-500"
          onClick={() => setActiveTab('parents')}
          active={activeTab === 'parents'}
        />
        <SummaryCard
          label="Orphaned Edges"
          count={summary?.orphanedEdges ?? -1}
          icon={<AlertTriangle size={20} />}
          color="text-red-500"
          onClick={() => setActiveTab('orphans')}
          active={activeTab === 'orphans'}
        />
        <SummaryCard
          label="Stale Data"
          count={summary?.staleRecords ?? -1}
          icon={<Clock size={20} />}
          color="text-yellow-500"
          onClick={() => setActiveTab('stale')}
          active={activeTab === 'stale'}
        />
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-app-border">
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-app-accent text-app-accent'
                  : 'border-transparent text-app-text-muted hover:text-app-text hover:border-app-border'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'parents' && (
        <ParentsTab
          gaps={parentGaps}
          loading={parentGapsLoading}
          selectedProvider={selectedProvider}
          onProviderChange={setSelectedProvider}
          discoveryProgress={discoveryProgress}
          discoveryRunning={discoveryRunning}
          onStartDiscovery={startBulkDiscovery}
          onCancelDiscovery={cancelBulkDiscovery}
          dbId={dbId}
        />
      )}

      {activeTab === 'coverage' && (
        <CoverageTab gaps={coverageGaps} loading={coverageLoading} dbId={dbId} />
      )}

      {activeTab === 'orphans' && (
        <OrphansTab edges={orphanedEdges} loading={orphansLoading} />
      )}

      {activeTab === 'stale' && (
        <StaleTab
          records={staleRecords}
          loading={staleLoading}
          days={staleDays}
          onDaysChange={setStaleDays}
          dbId={dbId}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function SummaryCard({
  label,
  count,
  icon,
  color,
  onClick,
  active,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-lg border transition-colors text-left w-full ${
        active
          ? 'bg-app-accent/10 border-app-accent'
          : 'bg-app-card border-app-border hover:bg-app-hover'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={color}>{icon}</span>
        <span className={`text-2xl font-bold ${count === 0 ? 'text-green-500' : count < 0 ? 'text-app-text-muted' : 'text-app-text'}`}>
          {count < 0 ? '—' : count}
        </span>
      </div>
      <p className="text-sm text-app-text-muted">{label}</p>
    </button>
  );
}

function ParentsTab({
  gaps,
  loading,
  selectedProvider,
  onProviderChange,
  discoveryProgress,
  discoveryRunning,
  onStartDiscovery,
  onCancelDiscovery,
  dbId,
}: {
  gaps: ParentLinkageGap[];
  loading: boolean;
  selectedProvider: BuiltInProvider;
  onProviderChange: (p: BuiltInProvider) => void;
  discoveryProgress: BulkDiscoveryProgress | null;
  discoveryRunning: boolean;
  onStartDiscovery: () => void;
  onCancelDiscovery: () => void;
  dbId: string;
}) {
  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-app-text-muted">Provider:</label>
          <select
            value={selectedProvider}
            onChange={e => onProviderChange(e.target.value as BuiltInProvider)}
            className="px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-app-text text-sm"
            disabled={discoveryRunning}
          >
            {PROVIDER_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {!discoveryRunning ? (
          <button
            onClick={onStartDiscovery}
            disabled={gaps.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-app-accent text-white text-sm hover:bg-app-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={14} />
            Discover All ({gaps.length})
          </button>
        ) : (
          <button
            onClick={onCancelDiscovery}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 transition-colors"
          >
            <Square size={14} />
            Cancel
          </button>
        )}
      </div>

      {/* Discovery Progress */}
      {discoveryProgress && (discoveryRunning || discoveryProgress.type === 'completed' || discoveryProgress.type === 'cancelled') && (
        <div className="p-4 rounded-lg bg-app-card border border-app-border space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-app-text-muted">
              {discoveryProgress.currentPerson || discoveryProgress.message}
            </span>
            <span className="text-app-text font-mono">
              {discoveryProgress.current}/{discoveryProgress.total}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-app-bg rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                discoveryProgress.type === 'completed' ? 'bg-green-500' :
                discoveryProgress.type === 'cancelled' ? 'bg-yellow-500' :
                discoveryProgress.type === 'error' ? 'bg-red-500' :
                'bg-app-accent'
              }`}
              style={{
                width: discoveryProgress.total > 0
                  ? `${(discoveryProgress.current / discoveryProgress.total) * 100}%`
                  : '0%',
              }}
            />
          </div>

          {/* Stats */}
          <div className="flex gap-4 text-xs text-app-text-muted">
            <span className="text-green-500">Discovered: {discoveryProgress.discovered}</span>
            <span>Skipped: {discoveryProgress.skipped}</span>
            {discoveryProgress.errors > 0 && (
              <span className="text-red-500">Errors: {discoveryProgress.errors}</span>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <LoadingSpinner />
      ) : gaps.length === 0 ? (
        <EmptyState message={`No parent linkage gaps for ${selectedProvider}`} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-app-text-muted">
                <th className="py-2 px-3">Child</th>
                <th className="py-2 px-3">Parent</th>
                <th className="py-2 px-3">Role</th>
                <th className="py-2 px-3">Provider</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((gap, idx) => (
                <tr key={`${gap.childId}-${gap.parentId}-${idx}`} className="border-b border-app-border/50 hover:bg-app-hover">
                  <td className="py-2 px-3">
                    <a href={`/person/${dbId}/${gap.childId}`} className="text-app-accent hover:underline">
                      {gap.childName}
                    </a>
                  </td>
                  <td className="py-2 px-3">
                    <a href={`/person/${dbId}/${gap.parentId}`} className="text-app-accent hover:underline">
                      {gap.parentName}
                    </a>
                  </td>
                  <td className="py-2 px-3 capitalize text-app-text-muted">{gap.parentRole}</td>
                  <td className="py-2 px-3">
                    <ProviderBadge provider={gap.provider} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-app-text-muted mt-2">{gaps.length} gaps found</p>
        </div>
      )}
    </div>
  );
}

function CoverageTab({
  gaps,
  loading,
  dbId,
}: {
  gaps: ProviderCoverageGap[];
  loading: boolean;
  dbId: string;
}) {
  if (loading) return <LoadingSpinner />;
  if (gaps.length === 0) return <EmptyState message="All persons have complete provider coverage" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-app-border text-left text-app-text-muted">
            <th className="py-2 px-3 w-12">Gen</th>
            <th className="py-2 px-3">Person</th>
            <th className="py-2 px-3">Linked</th>
            <th className="py-2 px-3">Missing</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map(gap => (
            <tr key={gap.personId} className="border-b border-app-border/50 hover:bg-app-hover">
              <td className="py-2 px-3 text-app-text-muted font-mono text-xs">
                {gap.generation != null ? gap.generation : '—'}
              </td>
              <td className="py-2 px-3">
                <a href={`/person/${dbId}/${gap.personId}`} className="text-app-accent hover:underline">
                  {gap.displayName}
                </a>
              </td>
              <td className="py-2 px-3">
                <div className="flex gap-1 flex-wrap">
                  {gap.linkedProviders.map(p => (
                    <ProviderBadge key={p} provider={p} />
                  ))}
                </div>
              </td>
              <td className="py-2 px-3">
                <div className="flex gap-1 flex-wrap">
                  {gap.missingProviders.map(p => (
                    <ProviderBadge key={p} provider={p} muted />
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-app-text-muted mt-2">{gaps.length} persons with gaps</p>
    </div>
  );
}

function OrphansTab({
  edges,
  loading,
}: {
  edges: OrphanedEdge[];
  loading: boolean;
}) {
  if (loading) return <LoadingSpinner />;
  if (edges.length === 0) return <EmptyState message="No orphaned edges found" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-app-border text-left text-app-text-muted">
            <th className="py-2 px-3">Child ID</th>
            <th className="py-2 px-3">Parent ID</th>
            <th className="py-2 px-3">Role</th>
            <th className="py-2 px-3">Missing</th>
          </tr>
        </thead>
        <tbody>
          {edges.map(edge => (
            <tr key={edge.edgeId} className="border-b border-app-border/50 hover:bg-app-hover">
              <td className="py-2 px-3 font-mono text-xs text-app-text-muted">{edge.childId}</td>
              <td className="py-2 px-3 font-mono text-xs text-app-text-muted">{edge.parentId}</td>
              <td className="py-2 px-3 capitalize text-app-text-muted">{edge.parentRole}</td>
              <td className="py-2 px-3">
                <span className={`text-xs px-2 py-0.5 rounded ${
                  edge.missingPerson === 'both' ? 'bg-red-500/20 text-red-500' :
                  'bg-orange-500/20 text-orange-500'
                }`}>
                  {edge.missingPerson}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-app-text-muted mt-2">{edges.length} orphaned edges</p>
    </div>
  );
}

function StaleTab({
  records,
  loading,
  days,
  onDaysChange,
  dbId,
}: {
  records: StaleRecord[];
  loading: boolean;
  days: number;
  onDaysChange: (d: number) => void;
  dbId: string;
}) {
  return (
    <div className="space-y-4">
      {/* Days threshold */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-app-text-muted">Older than:</label>
        <input
          type="number"
          value={days}
          onChange={e => onDaysChange(parseInt(e.target.value) || 30)}
          min={1}
          max={365}
          className="w-20 px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-app-text text-sm"
        />
        <span className="text-sm text-app-text-muted">days</span>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : records.length === 0 ? (
        <EmptyState message={`No provider cache older than ${days} days`} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-app-text-muted">
                <th className="py-2 px-3">Person</th>
                <th className="py-2 px-3">Provider</th>
                <th className="py-2 px-3">Last Scraped</th>
                <th className="py-2 px-3">Age</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record, idx) => (
                <tr key={`${record.personId}-${record.provider}-${idx}`} className="border-b border-app-border/50 hover:bg-app-hover">
                  <td className="py-2 px-3">
                    <a href={`/person/${dbId}/${record.personId}`} className="text-app-accent hover:underline">
                      {record.displayName}
                    </a>
                  </td>
                  <td className="py-2 px-3">
                    <ProviderBadge provider={record.provider} />
                  </td>
                  <td className="py-2 px-3 text-app-text-muted">
                    {new Date(record.scrapedAt).toLocaleDateString()}
                  </td>
                  <td className="py-2 px-3">
                    <span className={`${record.ageDays > 90 ? 'text-red-500' : record.ageDays > 60 ? 'text-orange-500' : 'text-yellow-500'}`}>
                      {record.ageDays}d
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-app-text-muted mt-2">{records.length} stale records</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Shared UI components
// ============================================================================

const PROVIDER_COLORS: Record<string, string> = {
  familysearch: 'bg-green-500/20 text-green-400',
  ancestry: 'bg-emerald-500/20 text-emerald-400',
  wikitree: 'bg-blue-500/20 text-blue-400',
  '23andme': 'bg-purple-500/20 text-purple-400',
};

const PROVIDER_LABELS: Record<string, string> = {
  familysearch: 'FS',
  ancestry: 'Ancestry',
  wikitree: 'WikiTree',
  '23andme': '23andMe',
};

function ProviderBadge({ provider, muted }: { provider: string; muted?: boolean }) {
  const colors = muted
    ? 'bg-app-bg text-app-text-muted border border-app-border'
    : PROVIDER_COLORS[provider] || 'bg-gray-500/20 text-gray-400';

  return (
    <span className={`text-xs px-2 py-0.5 rounded ${colors}`}>
      {PROVIDER_LABELS[provider] || provider}
    </span>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 size={24} className="animate-spin text-app-accent" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-8">
      <ShieldCheck size={32} className="mx-auto mb-2 text-green-500" />
      <p className="text-app-text-muted">{message}</p>
    </div>
  );
}
