import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  RefreshCw,
  Loader2,
  Play,
  Square,
  AlertCircle,
  CheckCircle2,
  Info,
  User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import type { DatabaseInfo, AncestryUpdateProgress } from '@fsf/shared';

interface LogEntry {
  timestamp: string;
  level: string;
  emoji: string;
  message: string;
}

type GenerationDepth = 1 | 2 | 3 | 4 | 'full';

const GENERATION_OPTIONS: { value: GenerationDepth; label: string }[] = [
  { value: 1, label: '1 (Root only)' },
  { value: 2, label: '2 (+ Parents)' },
  { value: 3, label: '3 (+ Grandparents)' },
  { value: 4, label: '4 (+ Great-grandparents)' },
  { value: 'full', label: 'Full Tree' },
];

export function AncestryUpdatePage() {
  const { dbId } = useParams<{ dbId: string }>();
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [rootPersonId, setRootPersonId] = useState('');
  const [rootPersonName, setRootPersonName] = useState('');
  const [hasAncestryLink, setHasAncestryLink] = useState<boolean | null>(null);
  const [maxGenerations, setMaxGenerations] = useState<GenerationDepth>(4);
  const [isTestMode, setIsTestMode] = useState(false);
  const [validating, setValidating] = useState(false);

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<AncestryUpdateProgress | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Load database info and check existing operation status
  useEffect(() => {
    if (!dbId) return;

    setLoading(true);

    Promise.all([
      api.getDatabase(dbId),
      api.getAncestryUpdateStatus(),
    ])
      .then(([db, status]) => {
        setDatabase(db);
        // Default to root person
        if (db.rootId) {
          setRootPersonId(db.rootId);
          validateRootPerson(db.rootId);
        }
        // Check if operation is already running
        if (status.running && status.dbId === dbId) {
          setIsRunning(true);
          if (status.progress) {
            setProgress(status.progress);
          }
        }
      })
      .catch(err => toast.error(`Failed to load database: ${err.message}`))
      .finally(() => setLoading(false));
  }, [dbId]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logEntries]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const validateRootPerson = useCallback((personId: string) => {
    if (!dbId || !personId) {
      setRootPersonName('');
      setHasAncestryLink(null);
      return;
    }

    setValidating(true);
    api.validateAncestryUpdateRoot(dbId, personId)
      .then(result => {
        setRootPersonName(result.personName);
        setHasAncestryLink(result.hasAncestryLink);
      })
      .catch(() => {
        setRootPersonName('');
        setHasAncestryLink(null);
      })
      .finally(() => setValidating(false));
  }, [dbId]);

  const handleRootPersonChange = (value: string) => {
    setRootPersonId(value);
    setRootPersonName('');
    setHasAncestryLink(null);
  };

  const handleValidateClick = () => {
    validateRootPerson(rootPersonId);
  };

  const startUpdate = () => {
    if (!dbId || !rootPersonId) return;

    // Close any existing connection
    eventSourceRef.current?.close();

    setIsRunning(true);
    setProgress(null);
    setLogEntries([]);

    // Build SSE URL
    const params = new URLSearchParams({
      rootPersonId,
      maxGenerations: String(maxGenerations),
    });
    if (isTestMode) {
      params.set('testMode', 'true');
    }

    const eventSource = new EventSource(`/api/ancestry-update/${dbId}/events?${params}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data: AncestryUpdateProgress = JSON.parse(event.data);
      setProgress(data);

      // Add log entry if present
      if (data.logEntry) {
        setLogEntries(prev => [...prev, data.logEntry!]);
      }

      if (data.type === 'completed' || data.type === 'error' || data.type === 'cancelled') {
        setIsRunning(false);
        eventSource.close();
        eventSourceRef.current = null;

        if (data.type === 'completed') {
          toast.success(`Update complete: ${data.stats.hintsProcessed} hints processed`);
        } else if (data.type === 'cancelled') {
          toast('Update cancelled');
        } else {
          toast.error(data.message || 'Update failed');
        }
      }
    };

    eventSource.onerror = () => {
      setIsRunning(false);
      eventSource.close();
      eventSourceRef.current = null;
      toast.error('Lost connection to update stream');
    };
  };

  const cancelUpdate = () => {
    if (!dbId) return;
    api.cancelAncestryUpdate(dbId)
      .then(() => toast('Cancellation requested...'))
      .catch(err => toast.error(`Failed to cancel: ${err.message}`));
  };

  // Calculate progress percentage
  const progressPercent = progress && progress.queueSize > 0
    ? Math.round((progress.processedCount / progress.queueSize) * 100)
    : 0;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="animate-spin text-app-text-muted" size={32} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <RefreshCw className="text-app-accent" size={24} />
          <h1 className="text-2xl font-bold text-app-text">Ancestry Update</h1>
        </div>
        {database?.rootName && (
          <span className="text-app-text-muted">{database.rootName}</span>
        )}
      </div>

      {/* Configuration Card */}
      <div className="bg-app-card rounded-lg border border-app-border p-6 mb-6">
        <h2 className="text-lg font-semibold text-app-text mb-4">Configuration</h2>

        {/* Root Person Selection */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-app-text-muted mb-2">
            Root Person
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Person ID (e.g., GW21-BZR or canonical ULID)"
              value={rootPersonId}
              onChange={e => handleRootPersonChange(e.target.value)}
              disabled={isRunning}
              className="flex-1 px-3 py-2 bg-app-bg border border-app-border rounded-md text-app-text placeholder:text-app-text-muted focus:outline-none focus:ring-2 focus:ring-app-accent"
            />
            <button
              onClick={handleValidateClick}
              disabled={isRunning || !rootPersonId || validating}
              className="px-4 py-2 bg-app-hover text-app-text rounded-md hover:bg-app-border disabled:opacity-50 flex items-center gap-2"
            >
              {validating ? <Loader2 size={16} className="animate-spin" /> : <User size={16} />}
              Validate
            </button>
          </div>
          {rootPersonName && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <CheckCircle2 size={16} className="text-green-500" />
              <span className="text-app-text">{rootPersonName}</span>
              {hasAncestryLink !== null && (
                <span className={hasAncestryLink ? 'text-green-500' : 'text-yellow-500'}>
                  {hasAncestryLink ? '(has Ancestry link)' : '(no Ancestry link)'}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Generation Depth */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-app-text-muted mb-2">
            Generation Depth
          </label>
          <div className="flex flex-wrap gap-2">
            {GENERATION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setMaxGenerations(opt.value)}
                disabled={isRunning}
                className={`px-4 py-2 rounded-md border transition-colors ${
                  maxGenerations === opt.value
                    ? 'bg-app-accent text-white border-app-accent'
                    : 'bg-app-bg text-app-text border-app-border hover:bg-app-hover'
                } disabled:opacity-50`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Test Mode */}
        <div className="mb-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isTestMode}
              onChange={e => setIsTestMode(e.target.checked)}
              disabled={isRunning}
              className="w-4 h-4 text-app-accent bg-app-bg border-app-border rounded focus:ring-app-accent"
            />
            <span className="text-sm text-app-text">Test Mode (dry run - don't process hints)</span>
          </label>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={startUpdate}
            disabled={isRunning || !rootPersonId || !rootPersonName}
            className="px-6 py-2 bg-app-accent text-white rounded-md hover:bg-app-accent-hover disabled:opacity-50 flex items-center gap-2"
          >
            <Play size={18} />
            Start Update
          </button>
          <button
            onClick={cancelUpdate}
            disabled={!isRunning}
            className="px-6 py-2 bg-app-error text-white rounded-md hover:bg-app-error/80 disabled:opacity-50 flex items-center gap-2"
          >
            <Square size={18} />
            Cancel
          </button>
        </div>
      </div>

      {/* Progress Card */}
      {(isRunning || progress) && (
        <div className="bg-app-card rounded-lg border border-app-border p-6 mb-6">
          <h2 className="text-lg font-semibold text-app-text mb-4">Progress</h2>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-app-bg rounded-lg p-3">
              <div className="text-2xl font-bold text-app-text">
                {progress?.processedCount ?? 0}/{progress?.queueSize ?? 0}
              </div>
              <div className="text-sm text-app-text-muted">Persons</div>
            </div>
            <div className="bg-app-bg rounded-lg p-3">
              <div className="text-2xl font-bold text-app-text">
                {progress?.currentGeneration ?? 0}/{progress?.maxGenerations ?? '-'}
              </div>
              <div className="text-sm text-app-text-muted">Generation</div>
            </div>
            <div className="bg-app-bg rounded-lg p-3">
              <div className="text-2xl font-bold text-green-500">
                {progress?.stats.hintsProcessed ?? 0}
              </div>
              <div className="text-sm text-app-text-muted">Hints Processed</div>
            </div>
            <div className="bg-app-bg rounded-lg p-3">
              <div className="text-2xl font-bold text-yellow-500">
                {progress?.stats.skipped ?? 0}
              </div>
              <div className="text-sm text-app-text-muted">Skipped</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="flex justify-between text-sm text-app-text-muted mb-1">
              <span>
                {progress?.currentPerson?.personName
                  ? `Processing: ${progress.currentPerson.personName}`
                  : progress?.message ?? 'Waiting...'}
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="w-full bg-app-bg rounded-full h-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  progress?.type === 'error' ? 'bg-app-error' :
                  progress?.type === 'completed' ? 'bg-green-500' :
                  'bg-app-accent'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Current Step */}
          {progress?.currentStep && (
            <div className="flex items-center gap-2 text-sm text-app-text-muted">
              <Info size={14} />
              <span>
                {progress.currentStep === 'ensureRecord' && 'Checking Ancestry link...'}
                {progress.currentStep === 'processHints' && 'Processing free hints...'}
                {progress.currentStep === 'downloadData' && 'Checking cached data...'}
                {progress.currentStep === 'queueParents' && 'Queueing parents...'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Execution Log */}
      {logEntries.length > 0 && (
        <div className="bg-app-card rounded-lg border border-app-border p-6">
          <h2 className="text-lg font-semibold text-app-text mb-4">Execution Log</h2>
          <div
            ref={logContainerRef}
            className="bg-app-bg rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm"
          >
            {logEntries.map((entry, idx) => (
              <div key={idx} className="flex gap-2 py-1">
                <span className="text-app-text-muted whitespace-nowrap">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span>{entry.emoji}</span>
                <span className={
                  entry.level === 'error' ? 'text-app-error' :
                  entry.level === 'warn' ? 'text-yellow-500' :
                  entry.level === 'success' ? 'text-green-500' :
                  'text-app-text'
                }>
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="mt-6 bg-app-bg rounded-lg border border-app-border p-4">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-app-accent flex-shrink-0 mt-0.5" />
          <div className="text-sm text-app-text-muted">
            <p className="mb-2">
              This tool automates Ancestry.com synchronization across your direct-ancestor sparse tree:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Processes free hints for each ancestor with an Ancestry link</li>
              <li>Traverses ancestors generation-by-generation using BFS</li>
              <li>Reports cached provider data status</li>
              <li>Skips persons without Ancestry links (future: create new records)</li>
            </ul>
            <p className="mt-3">
              <strong>Tip:</strong> Use Test Mode to see what would happen without actually processing hints.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
