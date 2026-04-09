import { Response } from 'express';
import type { BrowserStatus } from '../services/browser.service';
import { createSseManager } from './createSseManager.js';

const base = createSseManager('browser');
let lastStatus: BrowserStatus | null = null;

export const browserSseManager = {
  addClient(response: Response): string {
    const id = base.addClient(response);

    // Send current status immediately if available
    if (lastStatus) {
      const message = `event: status\ndata: ${JSON.stringify({ data: lastStatus })}\n\n`;
      response.write(message);
    }

    return id;
  },

  removeClient: base.removeClient,

  broadcast(event: string, data: object) {
    base.broadcast(event, { data });
  },

  broadcastStatus(status: BrowserStatus) {
    lastStatus = status;
    this.broadcast('status', status);
  },

  getClientCount: base.getClientCount,
  hasClients: base.hasClients,
};
