/**
 * React hook for Socket.IO events
 */

import { useEffect, useState, useRef } from 'react';
import { socketService } from '../services/socket';

/**
 * Hook to connect to socket and manage lifecycle
 */
export function useSocketConnection() {
  const [isConnected, setIsConnected] = useState(socketService.isConnected());

  useEffect(() => {
    socketService.connect();

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    const socket = socketService.getSocket();
    socket?.on('connect', onConnect);
    socket?.on('disconnect', onDisconnect);

    // Sync initial state after connect attempt
    setIsConnected(socketService.isConnected());

    return () => {
      socket?.off('connect', onConnect);
      socket?.off('disconnect', onDisconnect);
    };
  }, []);

  return {
    isConnected,
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

  // Serialize deps to a stable string to avoid spread in dependency array
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    const handler = (data: unknown) => {
      callbackRef.current(data as T);
    };

    socketService.on(event, handler);

    return () => {
      socketService.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, depsKey]);
}

