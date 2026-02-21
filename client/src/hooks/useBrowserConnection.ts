import { useState, useCallback } from 'react';
import { api, type BrowserStatus } from '../services/api';
import { useSSE } from './useSSE';

interface UseBrowserConnectionResult {
  browserStatus: BrowserStatus | null;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isLaunching: boolean;
  connect: () => Promise<BrowserStatus | null>;
  disconnect: () => Promise<void>;
  launch: () => Promise<{ success: boolean; message: string } | null>;
  refresh: () => Promise<void>;
}

export function useBrowserConnection(): UseBrowserConnectionResult {
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  const refresh = useCallback(async () => {
    const status = await api.getBrowserStatus().catch(() => null);
    if (status) setBrowserStatus(status);
  }, []);

  // SSE for real-time browser status updates
  useSSE('/api/browser/events', {
    status: (event) => {
      const { data } = JSON.parse(event.data);
      setBrowserStatus(data);
    },
  });

  const connect = useCallback(async () => {
    setIsConnecting(true);
    const result = await api.connectBrowser().catch(() => null);
    if (result) setBrowserStatus(result);
    setIsConnecting(false);
    return result;
  }, []);

  const disconnect = useCallback(async () => {
    setIsDisconnecting(true);
    await api.disconnectBrowser().catch(() => null);
    await refresh();
    setIsDisconnecting(false);
  }, [refresh]);

  const launch = useCallback(async () => {
    setIsLaunching(true);
    const result = await api.launchBrowser().catch(() => null);
    if (result) await refresh();
    setIsLaunching(false);
    return result;
  }, [refresh]);

  return {
    browserStatus,
    isConnecting,
    isDisconnecting,
    isLaunching,
    connect,
    disconnect,
    launch,
    refresh,
  };
}
