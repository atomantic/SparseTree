import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { initAIToolkit } from './services/ai-toolkit.service.js';
import { databaseRoutes } from './routes/database.routes.js';
import { personRoutes } from './routes/person.routes.js';
import { searchRoutes } from './routes/search.routes.js';
import { pathRoutes } from './routes/path.routes.js';
import { indexerRoutes } from './routes/indexer.routes.js';
import { exportRoutes } from './routes/export.routes.js';
import { browserRouter } from './routes/browser.routes.js';
import { browserService } from './services/browser.service.js';
import { augmentationRouter } from './routes/augmentation.routes.js';
import { genealogyProviderRouter } from './routes/genealogy-provider.routes.js';
import { providerRouter } from './routes/provider.routes.js';
import { gedcomRouter } from './routes/gedcom.routes.js';
import { syncRouter } from './routes/sync.routes.js';
import { favoritesRouter } from './routes/favorites.routes.js';
import { ancestryTreeRouter } from './routes/ancestry-tree.routes.js';
import { aiDiscoveryRouter } from './routes/ai-discovery.routes.js';
import { testRunnerRouter } from './routes/test-runner.routes.js';
import { integrityRouter } from './routes/integrity.routes.js';
import { ancestryHintsRouter } from './routes/ancestry-hints.routes.js';
import { ancestryUpdateRouter } from './routes/ancestry-update.routes.js';
import { mapRouter } from './routes/map.routes.js';
import { auditorRouter } from './routes/auditor.routes.js';
import { runMigrations } from './db/migrations/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { requestTimeout } from './middleware/requestTimeout.js';
import { logger } from './lib/logger.js';

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:6373';
const corsOrigin = CORS_ORIGIN.includes(',')
  ? CORS_ORIGIN.split(',').map(o => {
      const trimmed = o.trim();
      new URL(trimmed); // throws on invalid origin
      return trimmed;
    })
  : CORS_ORIGIN;

const app = express();
const httpServer = createServer(app);

const PORT = parseInt(process.env.PORT || '6374', 10);

// Middleware
app.use(cors({ origin: corsOrigin }));
app.use(express.json());
app.use(requestTimeout);
app.use(requestLogger);

// Initialize AI Toolkit with routes for providers, runs, and prompts
const aiToolkit = initAIToolkit(null);
aiToolkit.mountRoutes(app);

// Routes
app.use('/api/databases', databaseRoutes);
app.use('/api/persons', personRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/path', pathRoutes);
app.use('/api/indexer', indexerRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/browser', browserRouter);
app.use('/api/augment', augmentationRouter);
app.use('/api/genealogy-providers', genealogyProviderRouter);
app.use('/api/scrape-providers', providerRouter);
app.use('/api/gedcom', gedcomRouter);
app.use('/api/sync', syncRouter);
app.use('/api/favorites', favoritesRouter);
app.use('/api/ancestry-tree', ancestryTreeRouter);
app.use('/api/ai-discovery', aiDiscoveryRouter);
app.use('/api/test-runner', testRunnerRouter);
app.use('/api/integrity', integrityRouter);
app.use('/api/ancestry-hints', ancestryHintsRouter);
app.use('/api/ancestry-update', ancestryUpdateRouter);
app.use('/api/map', mapRouter);
app.use('/api/audit', auditorRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve built client UI in production
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// From src/index.ts: up to server/, then to project root, then client/dist
const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');
// From dist/index.js (compiled): up to server/, then to project root, then client/dist
const CLIENT_DIST_ALT = path.join(__dirname, '..', '..', '..', 'client', 'dist');
const clientDist = existsSync(CLIENT_DIST) ? CLIENT_DIST : CLIENT_DIST_ALT;

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  logger.ok('server', 'Serving built UI from client/dist');
}

// Error handling
app.use(errorHandler);

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
