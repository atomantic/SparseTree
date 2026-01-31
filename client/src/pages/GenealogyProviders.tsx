import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Database,
  RefreshCw,
  Power,
  PowerOff,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  LogIn,
  Key,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
  Monitor
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, BrowserStatus, CredentialsStatus } from '../services/api';
import type { BuiltInProvider, ProviderSessionStatus, UserProviderConfig, AutoLoginMethod } from '@fsf/shared';
import { CredentialsModal } from '../components/providers/CredentialsModal';

interface ProviderInfo {
  provider: BuiltInProvider;
  displayName: string;
  loginUrl: string;
  config: UserProviderConfig;
}

const providerColors: Record<BuiltInProvider, { bg: string; text: string; border: string }> = {
  familysearch: { bg: 'bg-app-success-subtle', text: 'text-app-success', border: 'border-app-success/30' },
  ancestry: { bg: 'bg-app-warning-subtle', text: 'text-app-warning', border: 'border-app-warning/30' },
  '23andme': { bg: 'bg-purple-600/10 dark:bg-purple-600/20', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-600/30' },
  wikitree: { bg: 'bg-app-accent-subtle', text: 'text-app-accent', border: 'border-app-accent/30' }
};

export function GenealogyProvidersPage() {
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [sessionStatus, setSessionStatus] = useState<Record<BuiltInProvider, ProviderSessionStatus>>({} as Record<BuiltInProvider, ProviderSessionStatus>);
  const [credentialsStatus, setCredentialsStatus] = useState<Record<BuiltInProvider, CredentialsStatus>>({} as Record<BuiltInProvider, CredentialsStatus>);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [checkingSession, setCheckingSession] = useState<BuiltInProvider | null>(null);
  const [openingLogin, setOpeningLogin] = useState<BuiltInProvider | null>(null);
  const [credentialsModalProvider, setCredentialsModalProvider] = useState<BuiltInProvider | null>(null);
  const [deletingCredentials, setDeletingCredentials] = useState<BuiltInProvider | null>(null);
  const [togglingAutoLogin, setTogglingAutoLogin] = useState<BuiltInProvider | null>(null);
  const [triggeringLogin, setTriggeringLogin] = useState<BuiltInProvider | null>(null);

  const loadCredentialsStatus = useCallback(async (providerList: BuiltInProvider[]) => {
    const statuses: Record<BuiltInProvider, CredentialsStatus> = {} as Record<BuiltInProvider, CredentialsStatus>;
    await Promise.all(
      providerList.map(async p => {
        const status = await api.getProviderCredentialsStatus(p).catch(() => null);
        if (status) statuses[p] = status;
      })
    );
    setCredentialsStatus(statuses);
  }, []);

  const loadStatus = useCallback(async () => {
    const [status, providerData] = await Promise.all([
      api.getBrowserStatus().catch(() => null),
      api.listProviders().catch(() => null)
    ]);

    if (status) setBrowserStatus(status);
    if (providerData) {
      setProviders(providerData.providers);
      await loadCredentialsStatus(providerData.providers.map(p => p.provider));
    }
    setLoading(false);
  }, [loadCredentialsStatus]);

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

  const handleCheckSession = async (provider: BuiltInProvider) => {
    setCheckingSession(provider);
    const status = await api.checkProviderSession(provider).catch(err => {
      toast.error(`Failed to check session: ${err.message}`);
      return null;
    });

    if (status) {
      setSessionStatus(prev => ({ ...prev, [provider]: status }));
      if (status.loggedIn) {
        toast.success(`${provider}: Logged in${status.userName ? ` as ${status.userName}` : ''}`);
      } else {
        toast(`${provider}: Not logged in`, { icon: '!' });
      }
    }
    setCheckingSession(null);
  };

  const handleOpenLogin = async (provider: BuiltInProvider) => {
    setOpeningLogin(provider);
    const result = await api.openProviderLogin(provider).catch(err => {
      toast.error(`Failed to open login: ${err.message}`);
      return null;
    });

    if (result) {
      toast.success(`Opened ${provider} login in browser`);
    }
    setOpeningLogin(null);
  };

  const handleSaveCredentials = async (provider: BuiltInProvider, credentials: { email?: string; username?: string; password: string }) => {
    const result = await api.saveProviderCredentials(provider, credentials);
    setCredentialsStatus(prev => ({ ...prev, [provider]: result }));
    setCredentialsModalProvider(null);
    toast.success('Credentials saved');
  };

  const handleDeleteCredentials = async (provider: BuiltInProvider) => {
    setDeletingCredentials(provider);
    await api.deleteProviderCredentials(provider).catch(err => {
      toast.error(`Failed to delete credentials: ${err.message}`);
      return null;
    });
    setCredentialsStatus(prev => ({
      ...prev,
      [provider]: { hasCredentials: false, autoLoginEnabled: false }
    }));
    toast.success('Credentials deleted');
    setDeletingCredentials(null);
  };

  const handleToggleAutoLogin = async (provider: BuiltInProvider, enabled: boolean, method?: AutoLoginMethod) => {
    setTogglingAutoLogin(provider);
    const result = await api.toggleAutoLogin(provider, enabled, method).catch(err => {
      toast.error(`Failed to toggle auto-login: ${err.message}`);
      return null;
    });
    if (result) {
      setCredentialsStatus(prev => ({
        ...prev,
        [provider]: { ...prev[provider], autoLoginEnabled: enabled, autoLoginMethod: method || prev[provider]?.autoLoginMethod }
      }));
      toast.success(enabled ? 'Auto-login enabled' : 'Auto-login disabled');
    }
    setTogglingAutoLogin(null);
  };

  const handleSetLoginMethod = async (provider: BuiltInProvider, method: AutoLoginMethod) => {
    setTogglingAutoLogin(provider);
    const creds = credentialsStatus[provider];
    const result = await api.toggleAutoLogin(provider, creds?.autoLoginEnabled || false, method).catch(err => {
      toast.error(`Failed to set login method: ${err.message}`);
      return null;
    });
    if (result) {
      setCredentialsStatus(prev => ({
        ...prev,
        [provider]: { ...prev[provider], autoLoginMethod: method }
      }));
      toast.success(`Login method set to ${method === 'google' ? 'Google' : 'Credentials'}`);
    }
    setTogglingAutoLogin(null);
  };

  const handleTriggerLogin = async (provider: BuiltInProvider) => {
    setTriggeringLogin(provider);
    const result = await api.triggerAutoLogin(provider).catch(err => {
      toast.error(`Login failed: ${err.message}`);
      return null;
    });
    if (result?.loggedIn) {
      toast.success('Login successful');
      await handleCheckSession(provider);
    }
    setTriggeringLogin(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 p-6">
        <Loader2 className="animate-spin text-app-text-muted" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header with Browser Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Database size={24} className="text-app-accent" />
          <div>
            <h1 className="text-2xl font-bold text-app-text">Genealogy Providers</h1>
            <p className="text-sm text-app-text-muted">Manage connections to family tree services</p>
          </div>
        </div>

        {/* Browser Status Banner */}
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
            browserStatus?.connected
              ? 'bg-app-success-subtle text-app-success'
              : 'bg-app-warning-subtle text-app-warning'
          }`}>
            <Monitor size={16} />
            <span className="text-sm font-medium">
              Browser: {browserStatus?.connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {/* Browser Actions */}
          {!browserStatus?.browserProcessRunning && (
            <button
              onClick={handleLaunch}
              disabled={launching}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-app-success-subtle text-app-success rounded-lg hover:bg-app-success/20 transition-colors disabled:opacity-50 text-sm"
            >
              {launching ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Launch
            </button>
          )}

          {browserStatus?.browserProcessRunning && !browserStatus?.connected && (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-app-accent/20 text-app-accent rounded-lg hover:bg-app-accent/30 transition-colors disabled:opacity-50 text-sm"
            >
              {connecting ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
              Connect
            </button>
          )}

          {browserStatus?.connected && (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-app-border text-app-text-secondary rounded-lg hover:bg-app-hover transition-colors disabled:opacity-50 text-sm"
            >
              {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <PowerOff size={14} />}
              Disconnect
            </button>
          )}

          <button
            onClick={loadStatus}
            className="p-2 text-app-text-muted hover:text-app-text hover:bg-app-border rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* Browser Settings Link */}
      <div className="bg-app-card border border-app-border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-app-text-muted">
            For advanced browser automation settings (CDP port, auto-connect), visit Browser Settings.
          </p>
          <Link
            to="/settings/browser"
            className="flex items-center gap-1.5 px-3 py-1.5 text-app-accent hover:bg-app-accent/10 rounded-lg transition-colors text-sm"
          >
            <ExternalLink size={14} />
            Browser Settings
          </Link>
        </div>
      </div>

      {/* Provider Cards */}
      <div className="space-y-4">
        {providers.map(({ provider, displayName, loginUrl }) => {
          const colors = providerColors[provider];
          const status = sessionStatus[provider];
          const creds = credentialsStatus[provider];
          const isCheckingThis = checkingSession === provider;
          const isOpeningLoginThis = openingLogin === provider;
          const isDeletingCreds = deletingCredentials === provider;
          const isTogglingAutoLogin = togglingAutoLogin === provider;
          const isTriggeringLogin = triggeringLogin === provider;

          return (
            <div
              key={provider}
              className={`bg-app-card rounded-lg border transition-colors ${colors.border}`}
            >
              {/* Provider Header */}
              <div className="p-5 border-b border-app-border/50">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  {/* Provider Badge + Status */}
                  <div className="flex items-center gap-4">
                    <div className={`px-4 py-2 rounded-lg ${colors.bg} ${colors.text} font-semibold text-lg`}>
                      {displayName}
                    </div>

                    {/* Session Status */}
                    <div className="flex items-center gap-2">
                      {status ? (
                        status.loggedIn ? (
                          <span className="flex items-center gap-1.5 text-app-success">
                            <CheckCircle2 size={18} />
                            <span className="text-sm font-medium">
                              Logged in{status.userName ? ` as ${status.userName}` : ''}
                            </span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-app-error">
                            <XCircle size={18} />
                            <span className="text-sm font-medium">Not logged in</span>
                          </span>
                        )
                      ) : (
                        <span className="text-sm text-app-text-muted">Session unknown</span>
                      )}
                    </div>
                  </div>

                  {/* Check Session Button */}
                  <button
                    onClick={() => handleCheckSession(provider)}
                    disabled={isCheckingThis || !browserStatus?.connected}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-app-border text-app-text-secondary rounded-lg hover:bg-app-hover transition-colors disabled:opacity-50 text-sm"
                    title="Check session status"
                  >
                    {isCheckingThis ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    Check Session
                  </button>
                </div>
              </div>

              {/* Login Options */}
              <div className="p-5 space-y-4">
                {/* Login Buttons */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => handleOpenLogin(provider)}
                    disabled={isOpeningLoginThis || !browserStatus?.connected}
                    className="flex items-center gap-2 px-4 py-2 bg-app-accent text-app-text rounded-lg hover:bg-app-accent/80 transition-colors disabled:opacity-50"
                  >
                    {isOpeningLoginThis ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <LogIn size={16} />
                    )}
                    Login
                  </button>

                  <a
                    href={loginUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-app-text-muted hover:text-app-text hover:bg-app-hover rounded-lg transition-colors text-sm"
                  >
                    <ExternalLink size={14} />
                    Open in Browser
                  </a>
                </div>

                {/* Auto-Login Section */}
                <div className="border-t border-app-border/50 pt-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-medium text-app-text flex items-center gap-2">
                          <Key size={14} />
                          Auto-Login (Optional)
                        </h4>
                        <p className="text-xs text-app-text-muted mt-0.5">
                          Configure automatic login when session expires
                        </p>
                      </div>

                      {/* Login Method Selection for FamilySearch */}
                      {provider === 'familysearch' && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-app-text-muted">Method:</span>
                          <div className="flex rounded-lg overflow-hidden border border-app-border">
                            <button
                              onClick={() => handleSetLoginMethod(provider, 'credentials')}
                              disabled={isTogglingAutoLogin}
                              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                                (!creds?.autoLoginMethod || creds.autoLoginMethod === 'credentials')
                                  ? 'bg-app-accent text-white'
                                  : 'bg-app-bg text-app-text-muted hover:bg-app-hover'
                              }`}
                            >
                              <Key size={12} />
                              Credentials
                            </button>
                            <button
                              onClick={() => handleSetLoginMethod(provider, 'google')}
                              disabled={isTogglingAutoLogin}
                              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors border-l border-app-border ${
                                creds?.autoLoginMethod === 'google'
                                  ? 'bg-app-accent text-white'
                                  : 'bg-app-bg text-app-text-muted hover:bg-app-hover'
                              }`}
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                              </svg>
                              Google
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Credentials-based Auto-Login */}
                    {(provider !== 'familysearch' || !creds?.autoLoginMethod || creds.autoLoginMethod === 'credentials') && (
                      <div className="flex items-center gap-2 flex-wrap">
                        {creds?.hasCredentials ? (
                          <>
                            <span className="text-xs text-app-success flex items-center gap-1">
                              <CheckCircle2 size={12} />
                              Credentials saved
                              {creds.email && <span className="text-app-text-muted">({creds.email})</span>}
                            </span>

                            <button
                              onClick={() => setCredentialsModalProvider(provider)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-app-border text-app-text-secondary rounded hover:bg-app-hover transition-colors text-xs"
                            >
                              Update
                            </button>

                            <button
                              onClick={() => handleDeleteCredentials(provider)}
                              disabled={isDeletingCreds}
                              className="flex items-center gap-1 px-2.5 py-1 bg-app-error-subtle text-app-error rounded hover:bg-app-error/20 transition-colors disabled:opacity-50 text-xs"
                            >
                              {isDeletingCreds ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              Delete
                            </button>

                            <button
                              onClick={() => handleToggleAutoLogin(provider, !creds.autoLoginEnabled, 'credentials')}
                              disabled={isTogglingAutoLogin}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
                                creds.autoLoginEnabled
                                  ? 'bg-app-success-subtle text-app-success hover:bg-app-success/20'
                                  : 'bg-app-border text-app-text-muted hover:bg-app-hover'
                              }`}
                            >
                              {isTogglingAutoLogin ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : creds.autoLoginEnabled ? (
                                <ToggleRight size={12} />
                              ) : (
                                <ToggleLeft size={12} />
                              )}
                              Auto-login {creds.autoLoginEnabled ? 'on' : 'off'}
                            </button>

                            <button
                              onClick={() => handleTriggerLogin(provider)}
                              disabled={isTriggeringLogin || !browserStatus?.connected}
                              className="flex items-center gap-1 px-2.5 py-1 bg-app-accent/20 text-app-accent rounded hover:bg-app-accent/30 transition-colors disabled:opacity-50 text-xs"
                            >
                              {isTriggeringLogin ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
                              Login Now
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setCredentialsModalProvider(provider)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-app-border text-app-text-secondary rounded-lg hover:bg-app-hover transition-colors text-sm"
                          >
                            <Key size={14} />
                            Add Credentials
                          </button>
                        )}
                      </div>
                    )}

                    {/* Google-based Auto-Login (FamilySearch only) */}
                    {provider === 'familysearch' && creds?.autoLoginMethod === 'google' && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-app-text-muted flex items-center gap-1">
                          <svg className="w-3 h-3" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                          </svg>
                          Login with Google selected
                        </span>

                        <button
                          onClick={() => handleToggleAutoLogin(provider, !creds.autoLoginEnabled, 'google')}
                          disabled={isTogglingAutoLogin}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
                            creds.autoLoginEnabled
                              ? 'bg-app-success-subtle text-app-success hover:bg-app-success/20'
                              : 'bg-app-border text-app-text-muted hover:bg-app-hover'
                          }`}
                        >
                          {isTogglingAutoLogin ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : creds.autoLoginEnabled ? (
                            <ToggleRight size={12} />
                          ) : (
                            <ToggleLeft size={12} />
                          )}
                          Auto-login {creds.autoLoginEnabled ? 'on' : 'off'}
                        </button>

                        <button
                          onClick={() => handleTriggerLogin(provider)}
                          disabled={isTriggeringLogin || !browserStatus?.connected}
                          className="flex items-center gap-2 px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 text-xs"
                        >
                          {isTriggeringLogin ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <svg className="w-3 h-3" viewBox="0 0 24 24">
                              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                            </svg>
                          )}
                          Login with Google Now
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* No Browser Warning */}
      {!browserStatus?.connected && (
        <div className="bg-app-warning-subtle border border-app-warning/30 rounded-lg p-4">
          <p className="text-sm text-app-warning">
            Connect to the browser to check provider login status and perform logins.
          </p>
        </div>
      )}

      {/* Credentials Modal */}
      {credentialsModalProvider && (
        <CredentialsModal
          isOpen={!!credentialsModalProvider}
          onClose={() => setCredentialsModalProvider(null)}
          onSave={(creds) => handleSaveCredentials(credentialsModalProvider, creds)}
          provider={credentialsModalProvider}
          displayName={providers.find(p => p.provider === credentialsModalProvider)?.displayName || credentialsModalProvider}
          existingCredentials={credentialsStatus[credentialsModalProvider]}
        />
      )}
    </div>
  );
}
