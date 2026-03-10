import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Scan,
  Play,
  Pause,
  Square,
  RotateCcw,
  Check,
  Loader2,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Info,
  HelpCircle,
  ChevronDown,
  Undo2,
  CheckCheck,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { AuditTreeView } from './AuditTreeView';
import type {
  AuditRun,
  AuditIssue,
  AuditChange,
  AuditProgress,
  AuditSummary,
  AuditRunConfig,
  AuditIssueType,
  AuditIssueSeverity,
  DatabaseInfo,
} from '@fsf/shared';

type TabId = 'tree' | 'issues' | 'changes' | 'runs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'tree', label: 'Tree' },
  { id: 'issues', label: 'Issues' },
  { id: 'changes', label: 'Changes' },
  { id: 'runs', label: 'Run History' },
];

const VALID_TABS = new Set<string>(TABS.map(t => t.id));

const SEVERITY_ICONS: Record<AuditIssueSeverity, typeof AlertTriangle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  hint: HelpCircle,
};

const SEVERITY_COLORS: Record<AuditIssueSeverity, string> = {
  error: 'text-red-500',
  warning: 'text-yellow-500',
  info: 'text-blue-400',
  hint: 'text-gray-400',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-yellow-500/20 text-yellow-400',
  accepted: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
  auto_applied: 'bg-blue-500/20 text-blue-400',
};

const ISSUE_TYPE_LABELS: Record<AuditIssueType, string> = {
  impossible_date: 'Impossible Date',
  parent_age_conflict: 'Parent Age Conflict',
  placeholder_name: 'Placeholder Name',
  missing_gender: 'Missing Gender',
  unlinked_provider: 'Unlinked Provider',
  date_mismatch: 'Date Mismatch',
  place_mismatch: 'Place Mismatch',
  name_mismatch: 'Name Mismatch',
  missing_parents: 'Missing Parents',
  stale_record: 'Stale Record',
  orphaned_edge: 'Orphaned Edge',
  duplicate_suspect: 'Duplicate Suspect',
};

const RUN_STATUS_COLORS: Record<string, string> = {
  queued: 'bg-gray-500/20 text-gray-400',
  running: 'bg-blue-500/20 text-blue-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-red-500/20 text-red-400',
  error: 'bg-red-500/20 text-red-400',
};

export function AuditPage() {
  const { dbId, tab } = useParams<{ dbId: string; tab?: string }>();
  const navigate = useNavigate();
  const activeTab: TabId = (tab && VALID_TABS.has(tab) ? tab : 'tree') as TabId;
  const setActiveTab = useCallback((t: TabId) => {
    navigate(`/db/${dbId}/audit/${t}`, { replace: true });
  }, [dbId, navigate]);

  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Audit run state
  const [activeRun, setActiveRun] = useState<AuditRun | null>(null);
  const [progress, setProgress] = useState<AuditProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Issues state
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issueFilter, setIssueFilter] = useState<{ type?: AuditIssueType; severity?: AuditIssueSeverity; status?: string }>({});
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());

  // Changes state
  const [changes, setChanges] = useState<AuditChange[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);

  // Runs state
  const [runs, setRuns] = useState<AuditRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<AuditSummary | null>(null);

  // Config state
  const [config, setConfig] = useState<AuditRunConfig | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [depthLimit, setDepthLimit] = useState<number | null>(null);

  // Load database info
  useEffect(() => {
    if (!dbId) return;
    setLoading(true);
    Promise.all([
      api.getDatabase(dbId),
      api.getAuditConfig(dbId),
      api.getAuditRuns(dbId),
    ])
      .then(([db, cfg, runList]) => {
        setDatabase(db);
        setConfig(cfg);
        setDepthLimit(cfg.depthLimit);
        setRuns(runList);
        // Check if there's an active run
        const active = runList.find(r => r.status === 'running' || r.status === 'paused');
        if (active) {
          setActiveRun(active);
          if (active.status === 'running') {
            setIsRunning(true);
            connectSSE();
          }
        }
      })
      .catch(err => toast.error(`Failed to load: ${err.message}`))
      .finally(() => setLoading(false));
  }, [dbId]);

  // Load tab data when tab changes
  useEffect(() => {
    if (!dbId) return;
    if (activeTab === 'issues') loadIssues();
    if (activeTab === 'changes') loadChanges();
    if (activeTab === 'runs') loadRuns();
  }, [activeTab, dbId]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const loadIssues = useCallback(() => {
    if (!dbId) return;
    setIssuesLoading(true);
    const params = new URLSearchParams();
    if (issueFilter.type) params.set('type', issueFilter.type);
    if (issueFilter.severity) params.set('severity', issueFilter.severity);
    if (issueFilter.status) params.set('status', issueFilter.status);
    api.getAuditIssues(dbId, Object.fromEntries(params))
      .then(setIssues)
      .catch(err => toast.error(`Failed to load issues: ${err.message}`))
      .finally(() => setIssuesLoading(false));
  }, [dbId, issueFilter]);

  // Reload issues when filter changes
  useEffect(() => {
    if (activeTab === 'issues') loadIssues();
  }, [issueFilter]);

  const loadChanges = useCallback(() => {
    if (!dbId) return;
    setChangesLoading(true);
    api.getAuditChanges(dbId)
      .then(setChanges)
      .catch(err => toast.error(`Failed to load changes: ${err.message}`))
      .finally(() => setChangesLoading(false));
  }, [dbId]);

  const loadRuns = useCallback(() => {
    if (!dbId) return;
    setRunsLoading(true);
    api.getAuditRuns(dbId)
      .then(setRuns)
      .catch(err => toast.error(`Failed to load runs: ${err.message}`))
      .finally(() => setRunsLoading(false));
  }, [dbId]);

  const connectSSE = useCallback(() => {
    if (!dbId) return;
    eventSourceRef.current?.close();

    const es = new EventSource(`/api/audit/${dbId}/events`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as AuditProgress;
      setProgress(data);

      if (data.type === 'completed' || data.type === 'error' || data.type === 'cancelled' || data.type === 'paused') {
        setIsRunning(false);
        es.close();
        eventSourceRef.current = null;
        loadIssues();
        loadRuns();
        if (data.type === 'completed') toast.success(`Audit complete: ${data.issuesFound} issues found`);
        if (data.type === 'error') toast.error(`Audit error: ${data.message}`);
        if (data.type === 'paused') toast('Audit paused');
      }
    };

    es.onerror = () => {
      setIsRunning(false);
      es.close();
      eventSourceRef.current = null;
    };
  }, [dbId, loadIssues, loadRuns]);

  const startAudit = useCallback(() => {
    if (!dbId) return;
    const runConfig: Partial<AuditRunConfig> = {};
    if (depthLimit !== null) runConfig.depthLimit = depthLimit;

    api.startAudit(dbId, runConfig)
      .then(() => {
        setIsRunning(true);
        setProgress(null);
        toast.success('Audit started');
        connectSSE();
      })
      .catch(err => toast.error(`Failed to start audit: ${err.message}`));
  }, [dbId, depthLimit, connectSSE]);

  const pauseAudit = useCallback(() => {
    if (!activeRun?.runId || !dbId) return;
    api.pauseAudit(dbId, activeRun.runId)
      .then(() => toast('Pause requested'))
      .catch(err => toast.error(`Failed to pause: ${err.message}`));
  }, [dbId, activeRun]);

  const resumeAudit = useCallback(() => {
    if (!activeRun?.runId || !dbId) return;
    api.resumeAudit(dbId, activeRun.runId)
      .then(() => {
        setIsRunning(true);
        toast.success('Audit resumed');
        connectSSE();
      })
      .catch(err => toast.error(`Failed to resume: ${err.message}`));
  }, [dbId, activeRun, connectSSE]);

  const cancelAudit = useCallback(() => {
    if (!activeRun?.runId || !dbId) return;
    api.cancelAudit(dbId, activeRun.runId)
      .then(() => toast('Cancel requested'))
      .catch(err => toast.error(`Failed to cancel: ${err.message}`));
  }, [dbId, activeRun]);

  const acceptIssues = useCallback((issueIds: string[]) => {
    if (!dbId) return;
    const action = issueIds.length === 1
      ? api.acceptAuditIssue(dbId, issueIds[0])
      : api.bulkAcceptAuditIssues(dbId, issueIds);
    action
      .then(() => {
        toast.success(`${issueIds.length} issue(s) accepted`);
        setSelectedIssueIds(new Set());
        loadIssues();
      })
      .catch(err => toast.error(`Failed to accept: ${err.message}`));
  }, [dbId, loadIssues]);

  const rejectIssues = useCallback((issueIds: string[]) => {
    if (!dbId) return;
    const action = issueIds.length === 1
      ? api.rejectAuditIssue(dbId, issueIds[0])
      : api.bulkRejectAuditIssues(dbId, issueIds);
    action
      .then(() => {
        toast.success(`${issueIds.length} issue(s) rejected`);
        setSelectedIssueIds(new Set());
        loadIssues();
      })
      .catch(err => toast.error(`Failed to reject: ${err.message}`));
  }, [dbId, loadIssues]);

  const undoChange = useCallback((changeId: string) => {
    if (!dbId) return;
    api.undoAuditChange(dbId, changeId)
      .then(() => {
        toast.success('Change undone');
        loadChanges();
        loadIssues();
      })
      .catch(err => toast.error(`Failed to undo: ${err.message}`));
  }, [dbId, loadChanges, loadIssues]);

  const toggleIssueSelection = (issueId: string) => {
    setSelectedIssueIds(prev => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIssueIds.size === issues.length) {
      setSelectedIssueIds(new Set());
    } else {
      setSelectedIssueIds(new Set(issues.map(i => i.issueId)));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-app-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Scan size={24} className="text-app-accent" />
          <div>
            <h1 className="text-2xl font-bold text-app-text">Tree Auditor</h1>
            {database && (
              <p className="text-sm text-app-text-muted">{database.rootName || database.id}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Config toggle */}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="px-3 py-2 rounded-lg bg-app-card border border-app-border text-app-text hover:bg-app-hover transition-colors text-sm flex items-center gap-1"
          >
            <ChevronDown size={14} className={`transition-transform ${showConfig ? 'rotate-180' : ''}`} />
            Config
          </button>

          {/* Run controls */}
          {!isRunning && activeRun?.status !== 'paused' && (
            <button
              onClick={startAudit}
              className="px-3 py-2 rounded-lg bg-app-accent text-white hover:bg-app-accent/90 transition-colors text-sm flex items-center gap-1"
            >
              <Play size={14} /> Start Audit
            </button>
          )}
          {activeRun?.status === 'paused' && (
            <>
              <button
                onClick={resumeAudit}
                className="px-3 py-2 rounded-lg bg-app-accent text-white hover:bg-app-accent/90 transition-colors text-sm flex items-center gap-1"
              >
                <Play size={14} /> Resume
              </button>
              <button
                onClick={cancelAudit}
                className="px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors text-sm flex items-center gap-1"
              >
                <Square size={14} /> Cancel
              </button>
            </>
          )}
          {isRunning && (
            <>
              <button
                onClick={pauseAudit}
                className="px-3 py-2 rounded-lg bg-yellow-600 text-white hover:bg-yellow-700 transition-colors text-sm flex items-center gap-1"
              >
                <Pause size={14} /> Pause
              </button>
              <button
                onClick={cancelAudit}
                className="px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors text-sm flex items-center gap-1"
              >
                <Square size={14} /> Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Config panel */}
      {showConfig && config && (
        <div className="bg-app-card border border-app-border rounded-lg p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-app-text-muted mb-1">Depth Limit</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={depthLimit ?? ''}
                  placeholder="Unlimited"
                  onChange={(e) => setDepthLimit(e.target.value ? parseInt(e.target.value, 10) : null)}
                  className="w-24 px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-app-text text-sm"
                />
                <span className="text-xs text-app-text-muted">generations</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-app-text-muted mb-1">Batch Size</label>
              <span className="text-sm text-app-text">{config.batchSize}</span>
            </div>
            <div>
              <label className="block text-xs text-app-text-muted mb-1">Auto Accept</label>
              <span className="text-sm text-app-text">{config.autoAccept ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {progress && (isRunning || progress.type === 'completed') && (
        <div className="bg-app-card border border-app-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-app-text">
              {isRunning && <Loader2 size={14} className="inline animate-spin mr-1" />}
              {progress.message}
            </span>
            <span className="text-app-text-muted">
              Gen {progress.generation} &middot; {progress.personsChecked} checked &middot; {progress.issuesFound} issues
            </span>
          </div>
          <div className="w-full bg-app-bg rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all bg-app-accent"
              style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%' }}
            />
          </div>
          {progress.currentPerson && (
            <p className="text-xs text-app-text-muted">Checking: {progress.currentPerson}</p>
          )}
        </div>
      )}

      {/* Summary cards */}
      {runs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label="Total Runs"
            value={runs.length}
            onClick={() => setActiveTab('runs')}
          />
          <SummaryCard
            label="Open Issues"
            value={issues.filter(i => i.status === 'open').length}
            color="text-yellow-400"
            onClick={() => { setIssueFilter({ status: 'open' }); setActiveTab('issues'); }}
          />
          <SummaryCard
            label="Accepted"
            value={issues.filter(i => i.status === 'accepted' || i.status === 'auto_applied').length}
            color="text-green-400"
            onClick={() => { setIssueFilter({ status: 'accepted' }); setActiveTab('issues'); }}
          />
          <SummaryCard
            label="Changes Applied"
            value={changes.length}
            color="text-blue-400"
            onClick={() => setActiveTab('changes')}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-app-border">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.id
                  ? 'border-app-accent text-app-accent'
                  : 'border-transparent text-app-text-muted hover:text-app-text hover:border-app-border'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'tree' && (
        <AuditTreeView
          dbId={dbId!}
          onPersonIssuesClick={(_personId) => {
            setIssueFilter({ status: 'open' });
            setActiveTab('issues');
          }}
        />
      )}
      {activeTab === 'issues' && (
        <IssuesTab
          issues={issues}
          loading={issuesLoading}
          filter={issueFilter}
          onFilterChange={setIssueFilter}
          selectedIds={selectedIssueIds}
          onToggleSelect={toggleIssueSelection}
          onToggleSelectAll={toggleSelectAll}
          onAccept={acceptIssues}
          onReject={rejectIssues}
          onRefresh={loadIssues}
          dbId={dbId!}
        />
      )}
      {activeTab === 'changes' && (
        <ChangesTab
          changes={changes}
          loading={changesLoading}
          onUndo={undoChange}
          onRefresh={loadChanges}
          dbId={dbId!}
        />
      )}
      {activeTab === 'runs' && (
        <RunsTab
          runs={runs}
          loading={runsLoading}
          expandedRunId={expandedRunId}
          runSummary={runSummary}
          onExpand={(runId) => {
            if (expandedRunId === runId) {
              setExpandedRunId(null);
              setRunSummary(null);
            } else {
              setExpandedRunId(runId);
              api.getAuditRunSummary(dbId!, runId)
                .then(setRunSummary)
                .catch(err => toast.error(`Failed to load summary: ${err.message}`));
            }
          }}
          onRefresh={loadRuns}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function SummaryCard({ label, value, color, onClick }: {
  label: string;
  value: number;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-app-card border border-app-border rounded-lg p-4 text-left hover:bg-app-hover transition-colors"
    >
      <p className="text-xs text-app-text-muted">{label}</p>
      <p className={`text-2xl font-bold ${color || 'text-app-text'}`}>{value}</p>
    </button>
  );
}

function IssuesTab({ issues, loading, filter, onFilterChange, selectedIds, onToggleSelect, onToggleSelectAll, onAccept, onReject, onRefresh, dbId }: {
  issues: AuditIssue[];
  loading: boolean;
  filter: { type?: AuditIssueType; severity?: AuditIssueSeverity; status?: string };
  onFilterChange: (f: { type?: AuditIssueType; severity?: AuditIssueSeverity; status?: string }) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onAccept: (ids: string[]) => void;
  onReject: (ids: string[]) => void;
  onRefresh: () => void;
  dbId: string;
}) {
  const openIssues = issues.filter(i => i.status === 'open');

  return (
    <div className="space-y-4">
      {/* Filters and bulk actions */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filter.type || ''}
          onChange={(e) => onFilterChange({ ...filter, type: (e.target.value || undefined) as AuditIssueType | undefined })}
          className="px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-app-text text-sm"
        >
          <option value="">All Types</option>
          {Object.entries(ISSUE_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <select
          value={filter.severity || ''}
          onChange={(e) => onFilterChange({ ...filter, severity: (e.target.value || undefined) as AuditIssueSeverity | undefined })}
          className="px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-app-text text-sm"
        >
          <option value="">All Severities</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
          <option value="hint">Hint</option>
        </select>

        <select
          value={filter.status || ''}
          onChange={(e) => onFilterChange({ ...filter, status: e.target.value || undefined })}
          className="px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-app-text text-sm"
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="auto_applied">Auto Applied</option>
        </select>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-app-card border border-app-border text-app-text hover:bg-app-hover transition-colors text-sm"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-app-text-muted">{selectedIds.size} selected</span>
            <button
              onClick={() => onAccept(Array.from(selectedIds))}
              className="px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors text-sm flex items-center gap-1"
              title="Apply fixes where available, dismiss the rest"
            >
              <CheckCheck size={14} /> Accept All
            </button>
            <button
              onClick={() => onReject(Array.from(selectedIds))}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors text-sm flex items-center gap-1"
              title="Mark selected as not real issues"
            >
              <XCircle size={14} /> Reject All
            </button>
          </div>
        )}
      </div>

      {/* Issues table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={20} className="animate-spin text-app-text-muted" />
        </div>
      ) : issues.length === 0 ? (
        <div className="text-center py-12 text-app-text-muted">
          <Scan size={32} className="mx-auto mb-3 opacity-50" />
          <p>No issues found. Run an audit to check your tree.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-app-text-muted">
                <th className="py-2 px-3 w-8">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === issues.length && issues.length > 0}
                    onChange={onToggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="py-2 px-3 w-8"></th>
                <th className="py-2 px-3">Person</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Description</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {issues.map(issue => {
                const Icon = SEVERITY_ICONS[issue.severity];
                return (
                  <tr key={issue.issueId} className="border-b border-app-border/50 hover:bg-app-hover">
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(issue.issueId)}
                        onChange={() => onToggleSelect(issue.issueId)}
                        className="rounded"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <Icon size={16} className={SEVERITY_COLORS[issue.severity]} />
                    </td>
                    <td className="py-2 px-3">
                      <a
                        href={`/person/${dbId}/${issue.personId}`}
                        className="text-app-accent hover:underline"
                      >
                        {issue.personName || issue.personId.slice(0, 8)}
                      </a>
                    </td>
                    <td className="py-2 px-3 text-app-text-muted">
                      {ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}
                    </td>
                    <td className="py-2 px-3 text-app-text max-w-md truncate" title={issue.description}>
                      {issue.description}
                      {issue.suggestedValue && (
                        <span className="text-green-400 ml-1">→ {issue.suggestedValue}</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[issue.status] || ''}`}>
                        {issue.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      {issue.status === 'open' && (
                        <div className="flex items-center gap-1 justify-end">
                          {issue.suggestedValue ? (
                            <button
                              onClick={() => onAccept([issue.issueId])}
                              className="px-2 py-1 rounded text-xs bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors flex items-center gap-1"
                              title={`Apply fix: change to "${issue.suggestedValue}"`}
                            >
                              <Check size={12} /> Apply Fix
                            </button>
                          ) : (
                            <button
                              onClick={() => onAccept([issue.issueId])}
                              className="px-2 py-1 rounded text-xs bg-app-hover text-app-text-muted hover:bg-app-border transition-colors"
                              title="Dismiss — acknowledge this issue without changes"
                            >
                              Dismiss
                            </button>
                          )}
                          <button
                            onClick={() => onReject([issue.issueId])}
                            className="px-2 py-1 rounded text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                            title="Reject — mark as not a real issue"
                          >
                            Not an issue
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-app-text-muted mt-2">
            {issues.length} issue(s) &middot; {openIssues.length} open
          </p>
        </div>
      )}
    </div>
  );
}

function ChangesTab({ changes, loading, onUndo, onRefresh, dbId }: {
  changes: AuditChange[];
  loading: boolean;
  onUndo: (id: string) => void;
  onRefresh: () => void;
  dbId: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-app-card border border-app-border text-app-text hover:bg-app-hover transition-colors text-sm"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={20} className="animate-spin text-app-text-muted" />
        </div>
      ) : changes.length === 0 ? (
        <div className="text-center py-12 text-app-text-muted">
          <RotateCcw size={32} className="mx-auto mb-3 opacity-50" />
          <p>No changes applied yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-app-text-muted">
                <th className="py-2 px-3">Person</th>
                <th className="py-2 px-3">Field</th>
                <th className="py-2 px-3">Old Value</th>
                <th className="py-2 px-3">New Value</th>
                <th className="py-2 px-3">Applied</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {changes.map(change => (
                <tr key={change.changeId} className="border-b border-app-border/50 hover:bg-app-hover">
                  <td className="py-2 px-3">
                    <a
                      href={`/person/${dbId}/${change.personId}`}
                      className="text-app-accent hover:underline"
                    >
                      {change.personId.slice(0, 8)}
                    </a>
                  </td>
                  <td className="py-2 px-3 text-app-text-muted">
                    {change.tableName}.{change.field}
                  </td>
                  <td className="py-2 px-3 text-red-400">
                    {change.oldValue ?? <span className="text-app-text-muted italic">null</span>}
                  </td>
                  <td className="py-2 px-3 text-green-400">
                    {change.newValue ?? <span className="text-app-text-muted italic">null</span>}
                  </td>
                  <td className="py-2 px-3 text-app-text-muted text-xs">
                    {new Date(change.appliedAt).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button
                      onClick={() => onUndo(change.changeId)}
                      className="p-1 rounded hover:bg-yellow-500/20 text-yellow-400 transition-colors"
                      title="Undo change"
                    >
                      <Undo2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-app-text-muted mt-2">{changes.length} change(s)</p>
        </div>
      )}
    </div>
  );
}

function RunsTab({ runs, loading, expandedRunId, runSummary, onExpand, onRefresh }: {
  runs: AuditRun[];
  loading: boolean;
  expandedRunId: string | null;
  runSummary: AuditSummary | null;
  onExpand: (runId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-app-card border border-app-border text-app-text hover:bg-app-hover transition-colors text-sm"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={20} className="animate-spin text-app-text-muted" />
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-12 text-app-text-muted">
          <Scan size={32} className="mx-auto mb-3 opacity-50" />
          <p>No audit runs yet. Start one to check your tree.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map(run => (
            <div key={run.runId} className="bg-app-card border border-app-border rounded-lg">
              <button
                onClick={() => onExpand(run.runId)}
                className="w-full p-4 text-left hover:bg-app-hover transition-colors rounded-lg flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${RUN_STATUS_COLORS[run.status] || ''}`}>
                    {run.status}
                  </span>
                  <span className="text-sm text-app-text">
                    {run.startedAt ? new Date(run.startedAt).toLocaleString() : 'Queued'}
                  </span>
                  <span className="text-xs text-app-text-muted">
                    {run.personsChecked} checked &middot; {run.issuesFound} issues &middot; {run.fixesApplied} fixes
                  </span>
                </div>
                <ChevronDown
                  size={16}
                  className={`text-app-text-muted transition-transform ${expandedRunId === run.runId ? 'rotate-180' : ''}`}
                />
              </button>

              {expandedRunId === run.runId && runSummary && (
                <div className="px-4 pb-4 border-t border-app-border/50 pt-3">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-app-text-muted mb-1">By Type</p>
                      {Object.entries(runSummary.issuesByType).map(([type, count]) => (
                        <div key={type} className="flex justify-between text-app-text">
                          <span>{ISSUE_TYPE_LABELS[type as AuditIssueType] || type}</span>
                          <span>{count}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="text-xs text-app-text-muted mb-1">By Severity</p>
                      {Object.entries(runSummary.issuesBySeverity).map(([sev, count]) => (
                        <div key={sev} className="flex justify-between text-app-text">
                          <span className="capitalize">{sev}</span>
                          <span>{count}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="text-xs text-app-text-muted mb-1">By Status</p>
                      {Object.entries(runSummary.issuesByStatus).map(([status, count]) => (
                        <div key={status} className="flex justify-between text-app-text">
                          <span className="capitalize">{status.replace('_', ' ')}</span>
                          <span>{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {run.errorMessage && (
                    <p className="mt-2 text-xs text-red-400">{run.errorMessage}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
