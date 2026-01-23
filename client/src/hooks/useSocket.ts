/**
 * React hook for Socket.IO events
 */

import { useEffect, useCallback, useRef } from 'react';
import { socketService } from '../services/socket';

/**
 * Hook to connect to socket and manage lifecycle
 */
export function useSocketConnection() {
  useEffect(() => {
    socketService.connect();

    return () => {
      // Don't disconnect on unmount - keep connection alive
      // socketService.disconnect();
    };
  }, []);

  return {
    isConnected: socketService.isConnected(),
    socket: socketService.getSocket()
  };
}

/**
 * Hook to listen to a specific socket event
 */
export function useSocketEvent<T = unknown>(
  event: string,
  callback: (data: T) => void,
  deps: React.DependencyList = []
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const handler = (data: unknown) => {
      callbackRef.current(data as T);
    };

    socketService.on(event, handler);

    return () => {
      socketService.off(event, handler);
    };
  }, [event, ...deps]);
}

/**
 * Hook to subscribe to database events
 */
export function useDatabaseEvents(
  dbId: string | undefined,
  handlers: {
    onRefreshStart?: () => void;
    onRefreshProgress?: (data: { progress: number }) => void;
    onRefreshComplete?: (data: { personCount: number }) => void;
    onRefreshError?: (data: { message: string }) => void;
  }
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!dbId) return;

    socketService.subscribeToDatabase(dbId);

    const onEvent = (data: unknown) => {
      const eventData = data as { dbId: string; status: string; progress?: number; personCount?: number; message?: string };
      switch (eventData.status) {
        case 'started':
          handlersRef.current.onRefreshStart?.();
          break;
        case 'progress':
          handlersRef.current.onRefreshProgress?.({ progress: eventData.progress ?? 0 });
          break;
        case 'complete':
          handlersRef.current.onRefreshComplete?.({ personCount: eventData.personCount ?? 0 });
          break;
        case 'error':
          handlersRef.current.onRefreshError?.({ message: eventData.message ?? 'Unknown error' });
          break;
      }
    };

    socketService.on('database:refresh', onEvent);

    return () => {
      socketService.unsubscribeFromDatabase(dbId);
      socketService.off('database:refresh', onEvent);
    };
  }, [dbId]);
}

/**
 * Hook to subscribe to browser status events
 */
export function useBrowserEvents(
  handlers: {
    onStatusChange?: (data: { connected: boolean; pageCount?: number }) => void;
  }
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    socketService.subscribeToBrowser();

    const onStatus = (data: unknown) => {
      handlersRef.current.onStatusChange?.(data as { connected: boolean; pageCount?: number });
    };

    socketService.on('browser:status', onStatus);

    return () => {
      socketService.off('browser:status', onStatus);
    };
  }, []);
}

/**
 * Hook to subscribe to indexer events
 */
export function useIndexerEvents(
  handlers: {
    onProgress?: (data: { phase: string; fetched?: number; total?: number }) => void;
    onComplete?: (data: { dbId: string }) => void;
    onError?: (data: { message: string }) => void;
  }
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    socketService.subscribeToIndexer();

    const onProgress = (data: unknown) => {
      const { phase } = data as { phase: string };
      if (phase === 'complete') {
        handlersRef.current.onComplete?.(data as { dbId: string });
      } else if (phase === 'error') {
        handlersRef.current.onError?.(data as { message: string });
      } else {
        handlersRef.current.onProgress?.(data as { phase: string; fetched?: number; total?: number });
      }
    };

    socketService.on('indexer:progress', onProgress);

    return () => {
      socketService.off('indexer:progress', onProgress);
    };
  }, []);
}

/**
 * Hook to emit socket events
 */
export function useSocketEmit() {
  const emit = useCallback((event: string, data?: unknown) => {
    socketService.emit(event, data);
  }, []);

  return { emit };
}
