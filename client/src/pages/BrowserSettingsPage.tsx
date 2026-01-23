import { useEffect, useState, useCallback } from 'react';
import {
  Monitor,
  RefreshCw,
  Power,
  PowerOff,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  Globe,
  Settings,
  Terminal
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, BrowserStatus, BrowserConfig } from '../services/api';

export function BrowserSettingsPage() {
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(null);
  const [browserConfig, setBrowserConfig] = useState<BrowserConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [editingPort, setEditingPort] = useState(false);
  const [portValue, setPortValue] = useState('');

  const loadStatus = useCallback(async () => {
    const [status, config] = await Promise.all([
      api.getBrowserStatus().catch(() => null),
      api.getBrowserConfig().catch(() => null)
    ]);

    if (status) setBrowserStatus(status);
    if (config) {
      setBrowserConfig(config);
      setPortValue(String(config.cdpPort));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // SSE for real-time browser status updates
  useEffect(() => {
    const eventSource = new EventSource('/api/browser/events');

    eventSource.addEventListener('status', (event) => {
      const { data } = JSON.parse(event.data);
      setBrowserStatus(data);
    });

    return () => eventSource.close();
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    const result = await api.connectBrowser().catch(err => {
      toast.error(`Failed to connect: ${err.message}`);
      return null;
    });
    if (result) {
      toast.success('Connected to browser');
      setBrowserStatus(result);
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    await api.disconnectBrowser().catch(err => {
      toast.error(`Failed to disconnect: ${err.message}`);
    });
    toast.success('Disconnected from browser');
    await loadStatus();
    setDisconnecting(false);
  };

  const handleLaunch = async () => {
    setLaunching(true);
    const result = await api.launchBrowser().catch(err => {
      toast.error(`Failed to launch: ${err.message}`);
      return null;
    });
    if (result) {
      if (result.success) {
        toast.success(result.message);
      } else {
        toast(result.message, { icon: '!' });
      }
      await loadStatus();
    }
    setLaunching(false);
  };

  const handleUpdatePort = async () => {
    const newPort = parseInt(portValue, 10);
    if (isNaN(newPort) || newPort < 1024 || newPort > 65535) {
      toast.error('Port must be between 1024 and 65535');
      return;
    }

    const result = await api.updateBrowserConfig({ cdpPort: newPort }).catch(err => {
      toast.error(`Failed to update config: ${err.message}`);
      return null;
    });

    if (result) {
      setBrowserConfig(result);
      toast.success('CDP port updated. Restart browser to apply.');
      setEditingPort(false);
    }
  };

  const handleToggleAutoConnect = async () => {
    if (!browserConfig) return;

    const result = await api.updateBrowserConfig({ autoConnect: !browserConfig.autoConnect }).catch(err => {
      toast.error(`Failed to update config: ${err.message}`);
      return null;
    });

    if (result) {
      setBrowserConfig(result);
      toast.success(result.autoConnect ? 'Auto-connect enabled' : 'Auto-connect disabled');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-app-text-muted" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Monitor size={24} className="text-app-accent shrink-0" />
          <h1 className="text-xl sm:text-2xl font-bold text-app-text truncate">Browser Settings</h1>
        </div>
        <button
          onClick={loadStatus}
          className="p-2 text-app-text-muted hover:text-app-text hover:bg-app-border rounded transition-colors shrink-0"
          title="Refresh status"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Connection Status Card */}
      <div className="bg-app-card border border-app-border rounded-lg p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-app-text mb-4 flex items-center gap-2">
          <Terminal size={18} className="shrink-0" />
          CDP Connection
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Status Section */}
          <div className="space-y-4">
            {/* Browser Process Status */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-app-text-muted text-sm sm:text-base">Browser Process</span>
              <span className={`flex items-center gap-1.5 sm:gap-2 text-sm sm:text-base shrink-0 ${browserStatus?.browserProcessRunning ? 'text-app-success' : 'text-app-error'}`}>
                {browserStatus?.browserProcessRunning ? (
                  <>
                    <CheckCircle2 size={16} className="shrink-0" />
                    <span className="hidden xs:inline">Running</span>
                    <span className="xs:hidden">On</span>
                  </>
                ) : (
                  <>
                    <XCircle size={16} className="shrink-0" />
                    <span className="hidden xs:inline">Not Running</span>
                    <span className="xs:hidden">Off</span>
                  </>
                )}
              </span>
            </div>

            {/* Playwright Connection Status */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-app-text-muted text-sm sm:text-base">Playwright Connection</span>
              <span className={`flex items-center gap-1.5 sm:gap-2 text-sm sm:text-base shrink-0 ${browserStatus?.connected ? 'text-app-success' : 'text-app-warning'}`}>
                {browserStatus?.connected ? (
                  <>
                    <CheckCircle2 size={16} className="shrink-0" />
                    Connected
                  </>
                ) : (
                  <>
                    <XCircle size={16} className="shrink-0" />
                    Disconnected
                  </>
                )}
              </span>
            </div>

            {/* Page Count */}
            {browserStatus?.connected && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-app-text-muted text-sm sm:text-base">Open Pages</span>
                <span className="text-app-text text-sm sm:text-base">{browserStatus.pageCount}</span>
              </div>
            )}
          </div>

          {/* Actions Section */}
          <div className="space-y-3">
            {/* Launch Browser */}
            {!browserStatus?.browserProcessRunning && (
              <button
                onClick={handleLaunch}
                disabled={launching}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-app-success-subtle text-app-success rounded-lg hover:bg-app-success/20 transition-colors disabled:opacity-50"
              >
                {launching ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Play size={18} />
                )}
                Launch Browser
              </button>
            )}

            {/* Connect/Disconnect */}
            {browserStatus?.browserProcessRunning && !browserStatus?.connected && (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-app-accent/20 text-app-accent rounded-lg hover:bg-app-accent/30 transition-colors disabled:opacity-50"
              >
                {connecting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Power size={18} />
                )}
                Connect
              </button>
            )}

            {browserStatus?.connected && (
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-app-error-subtle text-app-error rounded-lg hover:bg-app-error/20 transition-colors disabled:opacity-50"
              >
                {disconnecting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <PowerOff size={18} />
                )}
                Disconnect
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CDP Configuration Card */}
      <div className="bg-app-card border border-app-border rounded-lg p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-app-text mb-4 flex items-center gap-2">
          <Settings size={18} className="shrink-0" />
          CDP Configuration
        </h2>

        <div className="space-y-4">
          {/* CDP Port */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
            <div className="min-w-0">
              <span className="text-app-text text-sm sm:text-base">CDP Port</span>
              <p className="text-xs sm:text-sm text-app-text-muted">Port for Chrome DevTools Protocol</p>
            </div>
            {editingPort ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  value={portValue}
                  onChange={(e) => setPortValue(e.target.value)}
                  className="w-20 sm:w-24 px-2 sm:px-3 py-1.5 bg-app-bg border border-app-border rounded text-app-text text-sm focus:outline-none focus:border-app-accent"
                  min="1024"
                  max="65535"
                />
                <button
                  onClick={handleUpdatePort}
                  className="px-2 sm:px-3 py-1.5 bg-app-accent/20 text-app-accent rounded text-sm hover:bg-app-accent/30"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditingPort(false);
                    setPortValue(String(browserConfig?.cdpPort || 9920));
                  }}
                  className="px-2 sm:px-3 py-1.5 bg-app-border text-app-text-muted rounded text-sm hover:bg-app-hover"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-app-text font-mono text-sm sm:text-base">{browserConfig?.cdpPort || 9920}</span>
                <button
                  onClick={() => setEditingPort(true)}
                  className="text-sm text-app-accent hover:underline"
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          {/* CDP URL (read-only) */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4">
            <div className="min-w-0 shrink-0">
              <span className="text-app-text text-sm sm:text-base">CDP URL</span>
              <p className="text-xs sm:text-sm text-app-text-muted">Full connection URL</p>
            </div>
            <span className="text-app-text font-mono text-xs sm:text-sm break-all">{browserStatus?.cdpUrl}</span>
          </div>

          {/* Auto-connect */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-app-text text-sm sm:text-base">Auto-connect</span>
              <p className="text-xs sm:text-sm text-app-text-muted">Connect when server starts</p>
            </div>
            <button
              onClick={handleToggleAutoConnect}
              className={`px-2 sm:px-3 py-1.5 rounded text-sm transition-colors shrink-0 ${
                browserConfig?.autoConnect
                  ? 'bg-app-success-subtle text-app-success hover:bg-app-success/20'
                  : 'bg-app-hover text-app-text-muted hover:bg-app-border'
              }`}
            >
              {browserConfig?.autoConnect ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        {/* Help text */}
        <div className="mt-4 p-2 sm:p-3 bg-app-bg rounded-lg overflow-x-auto">
          <p className="text-xs sm:text-sm text-app-text-muted">
            <strong>To start the browser manually:</strong>
          </p>
          <code className="block mt-2 text-xs text-app-accent font-mono whitespace-nowrap">
            CDP_PORT={browserConfig?.cdpPort || 9920} ./.browser/start.sh
          </code>
        </div>
      </div>

      {/* Open Pages Card */}
      {browserStatus?.connected && browserStatus.pages.length > 0 && (
        <div className="bg-app-card border border-app-border rounded-lg p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-app-text mb-4 flex items-center gap-2">
            <Globe size={18} className="shrink-0" />
            Open Browser Pages
          </h2>

          <div className="space-y-2">
            {browserStatus.pages.map((page, index) => (
              <div
                key={index}
                className="flex items-start gap-2 sm:gap-3 p-2 bg-app-bg rounded-lg"
              >
                <span className="text-app-text-muted text-xs sm:text-sm w-5 sm:w-6 shrink-0">{index + 1}.</span>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="text-app-text text-xs sm:text-sm truncate">{page.title || '(untitled)'}</p>
                  <p className="text-app-text-muted text-xs truncate">{page.url}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
