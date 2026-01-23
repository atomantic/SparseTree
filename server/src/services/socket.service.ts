/**
 * Socket.IO service for real-time event broadcasting
 *
 * Event namespaces:
 * - database:* - Database operations (refresh, create, delete)
 * - browser:* - Browser automation status
 * - indexer:* - Indexing progress
 * - sync:* - Provider sync operations
 * - provider:* - Provider session changes
 */

import { Server, Socket } from 'socket.io';

let io: Server | null = null;

// Room subscriptions per client
const clientRooms = new Map<string, Set<string>>();

/**
 * Initialize the socket service with the Server instance
 */
export function initSocketService(ioInstance: Server) {
  io = ioInstance;

  io.on('connection', (socket: Socket) => {
    clientRooms.set(socket.id, new Set());

    // Subscribe to specific database events
    socket.on('subscribe:database', (dbId: string) => {
      const room = `db:${dbId}`;
      socket.join(room);
      clientRooms.get(socket.id)?.add(room);
    });

    // Unsubscribe from database events
    socket.on('unsubscribe:database', (dbId: string) => {
      const room = `db:${dbId}`;
      socket.leave(room);
      clientRooms.get(socket.id)?.delete(room);
    });

    // Subscribe to browser events
    socket.on('subscribe:browser', () => {
      socket.join('browser');
      clientRooms.get(socket.id)?.add('browser');
    });

    // Subscribe to indexer events
    socket.on('subscribe:indexer', () => {
      socket.join('indexer');
      clientRooms.get(socket.id)?.add('indexer');
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      clientRooms.delete(socket.id);
    });
  });
}

/**
 * Get the Socket.IO server instance
 */
export function getIO(): Server | null {
  return io;
}

/**
 * Emit event to all connected clients
 */
export function broadcast(event: string, data: unknown) {
  io?.emit(event, data);
}

/**
 * Emit event to a specific room
 */
export function emitToRoom(room: string, event: string, data: unknown) {
  io?.to(room).emit(event, data);
}

/**
 * Emit database-related event
 */
export function emitDatabaseEvent(dbId: string, event: string, data: unknown) {
  emitToRoom(`db:${dbId}`, `database:${event}`, { dbId, ...data as object });
  // Also emit to global listeners
  broadcast(`database:${event}`, { dbId, ...data as object });
}

/**
 * Emit browser status event
 */
export function emitBrowserEvent(event: string, data: unknown) {
  emitToRoom('browser', `browser:${event}`, data);
  broadcast(`browser:${event}`, data);
}

/**
 * Emit indexer progress event
 */
export function emitIndexerEvent(event: string, data: unknown) {
  emitToRoom('indexer', `indexer:${event}`, data);
  broadcast(`indexer:${event}`, data);
}

/**
 * Emit provider session event
 */
export function emitProviderEvent(provider: string, event: string, data: unknown) {
  broadcast(`provider:${event}`, { provider, ...data as object });
}

// Export as a service object for consistency
export const socketService = {
  init: initSocketService,
  getIO,
  broadcast,
  emitToRoom,
  emitDatabaseEvent,
  emitBrowserEvent,
  emitIndexerEvent,
  emitProviderEvent
};
