import { useEffect, useState, useRef, useCallback } from 'react';
import {
  FileBarChart,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  TestTube2,
  Boxes,
  FileCode2,
  Play,
  Square,
} from 'lucide-react';
import { api } from '../services/api';
import { useSSE } from '../hooks/useSSE';

interface ReportStatus {
  e2e: boolean;
  featureCoverage: boolean;
  codeCoverage: boolean;
}

interface TestRun {
  id: string;
  type: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  startTime: string;
  endTime?: string;
  exitCode?: number;
}

type TestType = 'unit' | 'e2e' | 'feature-coverage' | 'code-coverage';

export function ReportsPage() {
  const [status, setStatus] = useState<ReportStatus>({
    e2e: false,
    featureCoverage: false,
    codeCoverage: false,
  });
  const [loading, setLoading] = useState(true);
  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [runningType, setRunningType] = useState<TestType | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const checkReportAvailability = useCallback(async () => {
    setLoading(true);
    const result = await api.getTestReportStatus().catch(() => null);
    if (result) {
      setStatus(result);
    }
    setLoading(false);
  }, []);

  // Fetch initial status
  useEffect(() => {
    checkReportAvailability();
    api.getTestRunnerStatus()
      .then(run => {
        if (run) {
          setTestRun(run);
          if (run.status === 'running') {
            setRunningType(run.type as TestType);
          }
        }
      })
      .catch(() => {});
  }, [checkReportAvailability]);

  // SSE for real-time test output
  useSSE('/api/test-runner/events', {
    started: (event) => {
      const { data } = JSON.parse(event.data);
      setTestRun(data);
      setRunningType(data.type);
      setOutputLines([]);
    },
    output: (event) => {
      const { data } = JSON.parse(event.data);
      setOutputLines(prev => {
        const newLines = [...prev, data.line];
        return newLines.slice(-1000); // Keep last 1000 lines
      });
    },
    completed: (event) => {
      const { data } = JSON.parse(event.data);
      setTestRun(data);
      setRunningType(null);
      // Refresh report status after completion
      checkReportAvailability();
    },
    stopped: (event) => {
      const { data } = JSON.parse(event.data);
      setTestRun(data);
      setRunningType(null);
    },
    error: (event) => {
      if (event.data) {
        const { data } = JSON.parse(event.data);
        if (data?.message) {
          setOutputLines(prev => [...prev, `Error: ${data.message}`]);
        }
      }
    },
    status: (event) => {
      const { data } = JSON.parse(event.data);
      if (data) {
        setTestRun(data);
        if (data.status === 'running') {
          setRunningType(data.type);
        }
      }
    },
  });

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputLines]);

  const handleRunTests = async (type: TestType) => {
    setOutputLines([]);
    await api.runTests(type).catch(err => {
      setOutputLines([`Error: ${err.message}`]);
    });
  };

  const handleStopTests = async () => {
    await api.stopTests().catch(() => {});
  };

  const openReport = (url: string) => {
    window.open(url, '_blank');
  };

  const isRunning = testRun?.status === 'running';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 p-6">
        <Loader2 className="animate-spin text-app-text-muted" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <FileBarChart size={24} className="text-app-accent shrink-0" />
          <h1 className="text-xl sm:text-2xl font-bold text-app-text truncate">Test & Coverage Reports</h1>
        </div>
        <button
          onClick={checkReportAvailability}
          className="p-2 text-app-text-muted hover:text-app-text hover:bg-app-border rounded transition-colors shrink-0"
          title="Refresh status"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Reports Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Code Coverage Report */}
        <ReportCard
          icon={<FileCode2 size={24} />}
          title="Code Coverage"
          description="Unit and integration test code coverage with line-by-line details"
          available={status.codeCoverage}
          url="/code-coverage/index.html"
          testType="code-coverage"
          isRunning={runningType === 'code-coverage'}
          isAnyRunning={isRunning}
          onRun={handleRunTests}
          onOpen={openReport}
        />

        {/* Feature Coverage Report */}
        <ReportCard
          icon={<Boxes size={24} />}
          title="Feature Coverage"
          description="BDD feature matrix showing tested vs untested features by priority"
          available={status.featureCoverage}
          url="/coverage-report/index.html"
          testType="feature-coverage"
          isRunning={runningType === 'feature-coverage'}
          isAnyRunning={isRunning}
          onRun={handleRunTests}
          onOpen={openReport}
        />

        {/* E2E Test Report */}
        <ReportCard
          icon={<TestTube2 size={24} />}
          title="E2E Test Report"
          description="Playwright end-to-end test results with screenshots and traces"
          available={status.e2e}
          url="/playwright-report/index.html"
          testType="e2e"
          isRunning={runningType === 'e2e'}
          isAnyRunning={isRunning}
          onRun={handleRunTests}
          onOpen={openReport}
        />
      </div>

      {/* Test Run Status */}
      {testRun && (
        <div className="bg-app-card border border-app-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${
                testRun.status === 'running' ? 'bg-app-accent animate-pulse' :
                testRun.status === 'completed' ? 'bg-app-success' :
                testRun.status === 'failed' ? 'bg-app-error' : 'bg-app-warning'
              }`} />
              <span className="text-app-text font-medium">
                {testRun.type.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())} Tests
              </span>
              <span className="text-app-text-muted text-sm capitalize">
                {testRun.status}
              </span>
              {testRun.exitCode !== undefined && testRun.exitCode !== 0 && (
                <span className="text-app-error text-sm">
                  (exit code: {testRun.exitCode})
                </span>
              )}
            </div>
            {isRunning && (
              <button
                onClick={handleStopTests}
                className="flex items-center gap-2 px-3 py-1.5 bg-app-error/20 text-app-error rounded hover:bg-app-error/30 transition-colors"
              >
                <Square size={14} />
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      {/* Output Console */}
      <div className="bg-app-card rounded-lg border border-app-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-app-text">Output</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-app-text-muted">{outputLines.length} lines</span>
            {outputLines.length > 0 && (
              <button
                onClick={() => setOutputLines([])}
                className="text-xs text-app-text-muted hover:text-app-text"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div
          ref={outputRef}
          className="bg-gray-900 rounded-md p-3 overflow-auto font-mono text-xs text-gray-300 whitespace-pre"
          style={{ height: '400px' }}
        >
          {outputLines.length === 0 ? (
            <span className="text-gray-500 italic">Output will appear here when tests run...</span>
          ) : (
            outputLines.map((line, i) => (
              <div key={i} className="hover:bg-gray-800" dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
            ))
          )}
        </div>
      </div>

      {/* Report Status Summary */}
      <div className="bg-app-card border border-app-border rounded-lg p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-app-text mb-4">Report Status</h2>
        <div className="space-y-2">
          <StatusRow label="Code Coverage" available={status.codeCoverage} path="/code-coverage/" />
          <StatusRow label="Feature Coverage" available={status.featureCoverage} path="/coverage-report/" />
          <StatusRow label="E2E Test Report" available={status.e2e} path="/playwright-report/" />
        </div>
        <p className="text-xs text-app-text-subtle mt-4">
          Reports are generated into <code className="text-app-accent">client/public/</code> and served by Vite during development.
        </p>
      </div>
    </div>
  );
}

// Simple ANSI to HTML converter for colored terminal output
function ansiToHtml(text: string): string {
  const ansiColors: Record<string, string> = {
    '30': 'color: #4d4d4d',
    '31': 'color: #ff6b6b',
    '32': 'color: #69db7c',
    '33': 'color: #ffd43b',
    '34': 'color: #74c0fc',
    '35': 'color: #da77f2',
    '36': 'color: #66d9e8',
    '37': 'color: #e9ecef',
    '90': 'color: #6c757d',
    '91': 'color: #ff8787',
    '92': 'color: #8ce99a',
    '93': 'color: #ffe066',
    '94': 'color: #91c4f2',
    '95': 'color: #e599f7',
    '96': 'color: #99e9f2',
    '97': 'color: #f8f9fa',
    '1': 'font-weight: bold',
    '0': '',
  };

  // Escape HTML
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Replace ANSI codes with spans
  html = html.replace(/\x1b\[([0-9;]+)m/g, (_, codes) => {
    const styles = codes.split(';').map((code: string) => ansiColors[code] || '').filter(Boolean);
    if (styles.length === 0 || codes === '0') {
      return '</span>';
    }
    return `<span style="${styles.join('; ')}">`;
  });

  return html;
}

interface ReportCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  available: boolean;
  url: string;
  testType: TestType;
  isRunning: boolean;
  isAnyRunning: boolean;
  onRun: (type: TestType) => void;
  onOpen: (url: string) => void;
}

function ReportCard({ icon, title, description, available, url, testType, isRunning, isAnyRunning, onRun, onOpen }: ReportCardProps) {
  return (
    <div className="bg-app-card border border-app-border rounded-lg p-4 sm:p-6 flex flex-col">
      <div className="flex items-center gap-3 mb-3">
        <div className={`${available ? 'text-app-accent' : 'text-app-text-subtle'}`}>
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-app-text">{title}</h3>
      </div>

      <p className="text-sm text-app-text-muted mb-4 flex-1">{description}</p>

      <div className="space-y-2">
        {/* Run button */}
        <button
          onClick={() => onRun(testType)}
          disabled={isAnyRunning}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
            isRunning
              ? 'bg-app-accent text-app-text'
              : isAnyRunning
                ? 'bg-app-border text-app-text-muted cursor-not-allowed'
                : 'bg-app-accent/20 text-app-accent hover:bg-app-accent/30'
          }`}
        >
          {isRunning ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play size={16} />
              Run Tests
            </>
          )}
        </button>

        {/* Open report button */}
        {available ? (
          <button
            onClick={() => onOpen(url)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-app-border text-app-text-secondary rounded-lg hover:bg-app-hover transition-colors"
          >
            <ExternalLink size={16} />
            View Report
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 text-app-text-muted text-sm py-2">
            <XCircle size={16} className="text-app-warning" />
            Report not generated yet
          </div>
        )}
      </div>
    </div>
  );
}

interface StatusRowProps {
  label: string;
  available: boolean;
  path: string;
}

function StatusRow({ label, available, path }: StatusRowProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-app-text-muted text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-app-text-subtle font-mono">{path}</span>
        {available ? (
          <CheckCircle2 size={16} className="text-app-success shrink-0" />
        ) : (
          <XCircle size={16} className="text-app-text-subtle shrink-0" />
        )}
      </div>
    </div>
  );
}
