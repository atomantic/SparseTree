import { createServer } from 'http';
import { browserService } from './services/browser.service.js';
import { runMigrations } from './db/migrations/index.js';
import { logger } from './lib/logger.js';
import { createApp } from './app.js';
import { sqliteService } from './db/sqlite.service.js';
import { startServer } from './startup.js';

const app = createApp();
const httpServer = createServer(app);

const PORT = parseInt(process.env.PORT || '6374', 10);

const HOST = process.env.HOST || 'localhost';

const shutdown = () => {
  logger.warn('server', 'Shutting down gracefully...');
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

void startServer({
  httpServer,
  runMigrations,
  closeDatabase: sqliteService.closeDb,
  autoConnectToBrowser: () => browserService.autoConnectIfEnabled(),
  logger,
  host: HOST,
  port: PORT,
}).catch(() => {
  process.exitCode = 1;
});
