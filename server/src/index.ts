import { createServer } from 'http';
import { browserService } from './services/browser.service.js';
import { runMigrations } from './db/migrations/index.js';
import { logger } from './lib/logger.js';
import { createApp } from './app.js';

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

httpServer.listen(PORT, HOST, () => {
  logger.start('server', `Running on http://${HOST}:${PORT}`);

  // Run pending SQLite schema migrations on startup
  runMigrations().then(({ applied }) => {
    if (applied.length > 0) {
      logger.ok('server', `Applied ${applied.length} migration(s): ${applied.join(', ')}`);
    }
  }).catch(err => {
    logger.error('server', `Migration error: ${err.message}`);
  });

  // Auto-connect to browser if enabled and browser is running
  browserService.autoConnectIfEnabled();
});
