/**
 * Socket.IO client service for real-time events
 */

import { io, Socket } from 'socket.io-client';

// Server URL - in development, same host different port
const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:6374';

class SocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();
  private connected = false;

  /**
   * Connect to the socket server
   */
  connect(): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    this.socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    this.socket.on('connect', () => {
      console.log('🔌 Socket connected:', this.socket?.id);
      this.connected = true;
    });

    this.socket.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
      this.connected = false;
    });

    this.socket.on('connect_error', (error) => {
      console.warn('🔌 Socket connection error:', error.message);
    });

    return this.socket;
  }

  /**
   * Disconnect from the socket server
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && !!this.socket?.connected;
  }

  /**
   * Get the socket instance
   */
  getSocket(): Socket | null {
    return this.socket;
  }

  /**
   * Subscribe to database events for a specific database
   */
  subscribeToDatabase(dbId: string) {
    this.socket?.emit('subscribe:database', dbId);
  }

  /**
   * Unsubscribe from database events
   */
  unsubscribeFromDatabase(dbId: string) {
    this.socket?.emit('unsubscribe:database', dbId);
  }

  /**
   * Subscribe to browser events
   */
  subscribeToBrowser() {
    this.socket?.emit('subscribe:browser');
  }

  /**
   * Subscribe to indexer events
   */
  subscribeToIndexer() {
    this.socket?.emit('subscribe:indexer');
  }

  /**
   * Add event listener
   */
  on(event: string, callback: (data: unknown) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(callback);
    this.socket?.on(event, callback);
  }

  /**
   * Remove event listener
   */
  off(event: string, callback: (data: unknown) => void) {
    this.listeners.get(event)?.delete(callback);
    this.socket?.off(event, callback);
  }

  /**
   * Emit event to server
   */
  emit(event: string, data?: unknown) {
    this.socket?.emit(event, data);
  }
}

// Singleton instance
export const socketService = new SocketService();

// Type definitions for events
export interface DatabaseRefreshEvent {
  dbId: string;
  status: 'started' | 'progress' | 'complete' | 'error';
  data?: {
    personCount?: number;
    message?: string;
  };
}

export interface BrowserStatusEvent {
  connected: boolean;
  pageCount?: number;
  cdpUrl?: string;
}

export interface IndexerProgressEvent {
  phase: 'started' | 'fetching' | 'complete' | 'error';
  personId?: string;
  personName?: string;
  fetched?: number;
  total?: number;
  errors?: number;
}

export interface ProviderSessionEvent {
  provider: string;
  loggedIn: boolean;
  userName?: string;
}
