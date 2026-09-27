import { createServer } from 'http';
import { browserService } from './services/browser.service.js';
import { postgresService } from './db/postgres.service.js';
import { logger } from './lib/logger.js';
import { createApp } from './app.js';
import { isQueryStoreUnavailable } from './services/database.service.js';
import { startServer } from './startup.js';

const app = createApp();
const httpServer = createServer(app);

const PORT = parseInt(process.env.PORT || '6374', 10);

const HOST = process.env.HOST || 'localhost';

const shutdown = () => {
  logger.warn('server', 'Shutting down gracefully...');
  const timeout = setTimeout(() => {
    void postgresService.closeDb().finally(() => process.exit(1));
  }, 5000);
  httpServer.close(() => {
    clearTimeout(timeout);
    void postgresService.closeDb().then(() => process.exit(0), () => process.exit(1));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

void startServer({
  httpServer,
  runMigrations: async () => {
    if (!postgresService.isConfigured()) {
      return { applied: [], skipped: [], unavailable: true };
    }
    try {
      return await postgresService.initDb();
    } catch (error) {
      if (!isQueryStoreUnavailable(error)) throw error;
      return { applied: [], skipped: [], unavailable: true };
    }
  },
  closeDatabase: postgresService.closeDb,
  autoConnectToBrowser: () => browserService.autoConnectIfEnabled(),
  logger,
  host: HOST,
  port: PORT,
}).catch(() => {
  process.exitCode = 1;
});
