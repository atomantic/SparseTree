import { Response } from 'express';
import crypto from 'crypto';
import type { BrowserStatus } from '../services/browser.service';
import { emitBrowserEvent } from '../services/socket.service.js';

interface SSEClient {
  id: string;
  response: Response;
}

const clients: SSEClient[] = [];
let lastStatus: BrowserStatus | null = null;

export const browserSseManager = {
  addClient(response: Response): string {
    const id = crypto.randomUUID();
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    response.write(`data: ${JSON.stringify({ type: 'connected', clientId: id })}\n\n`);
    clients.push({ id, response });

    // Send current status immediately if available
    if (lastStatus) {
      const message = `event: status\ndata: ${JSON.stringify({ data: lastStatus })}\n\n`;
      response.write(message);
    }

    return id;
  },

  removeClient(id: string) {
    const index = clients.findIndex(c => c.id === id);
    if (index !== -1) clients.splice(index, 1);
  },

  broadcast(event: string, data: object) {
    // Emit via Socket.IO (always, even if no SSE clients)
    emitBrowserEvent(event, data);

    // Also send via SSE for backwards compatibility
    if (clients.length === 0) return;

    const message = `event: ${event}\ndata: ${JSON.stringify({ data })}\n\n`;
    clients.forEach(({ response }) => {
      response.write(message);
    });
  },

  broadcastStatus(status: BrowserStatus) {
    lastStatus = status;
    this.broadcast('status', status);
  },

  getClientCount(): number {
    return clients.length;
  },

  hasClients(): boolean {
    return clients.length > 0;
  }
};
