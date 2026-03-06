import { Response } from 'express';
import crypto from 'crypto';

interface SSEClient {
  id: string;
  response: Response;
}

export interface SseManager {
  addClient(response: Response): string;
  removeClient(id: string): void;
  broadcast(event: string, data: object): void;
  getClientCount(): number;
  hasClients(): boolean;
}

export function createSseManager(name?: string): SseManager {
  const clients: SSEClient[] = [];

  return {
    addClient(response: Response): string {
      const id = crypto.randomUUID();
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      response.write(`data: ${JSON.stringify({ type: 'connected', clientId: id })}\n\n`);
      clients.push({ id, response });
      return id;
    },

    removeClient(id: string) {
      const index = clients.findIndex(c => c.id === id);
      if (index !== -1) clients.splice(index, 1);
    },

    broadcast(event: string, data: object) {
      if (clients.length === 0) return;
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const { response } of clients) {
        response.write(message);
      }
    },

    getClientCount(): number {
      return clients.length;
    },

    hasClients(): boolean {
      return clients.length > 0;
    },
  };
}
