import cors from 'cors';
import express, { type Express, type Router } from 'express';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAccessBoundary, resolveAccessConfig } from './middleware/accessBoundary.js';
import { apiNotFound } from './middleware/apiNotFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { requestTimeout } from './middleware/requestTimeout.js';
import { aiDiscoveryRouter } from './routes/ai-discovery.routes.js';
import { ancestryHintsRouter } from './routes/ancestry-hints.routes.js';
import { ancestryTreeRouter } from './routes/ancestry-tree.routes.js';
import { ancestryUpdateRouter } from './routes/ancestry-update.routes.js';
import { auditorRouter } from './routes/auditor.routes.js';
import { augmentationRouter } from './routes/augmentation.routes.js';
import { browserRouter } from './routes/browser.routes.js';
import { databaseRoutes } from './routes/database.routes.js';
import { deathsRouter } from './routes/deaths.routes.js';
import { exportRoutes } from './routes/export.routes.js';
import { favoritesRouter } from './routes/favorites.routes.js';
import { gedcomRouter } from './routes/gedcom.routes.js';
import { genealogyProviderRouter } from './routes/genealogy-provider.routes.js';
import { indexerRoutes } from './routes/indexer.routes.js';
import { integrityRouter } from './routes/integrity.routes.js';
import { mapRouter } from './routes/map.routes.js';
import { pathRoutes } from './routes/path.routes.js';
import { personRoutes } from './routes/person.routes.js';
import { providerRouter } from './routes/provider.routes.js';
import { searchRoutes } from './routes/search.routes.js';
import { syncRouter } from './routes/sync.routes.js';
import { testRunnerRouter } from './routes/test-runner.routes.js';
import { initAIToolkit } from './services/ai-toolkit.service.js';
import { logger } from './lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');
const CLIENT_DIST_ALT = path.join(__dirname, '..', '..', '..', 'client', 'dist');

const findClientDist = (): string => (
  existsSync(CLIENT_DIST) ? CLIENT_DIST : CLIENT_DIST_ALT
);

export interface CreateAppOptions {
  env?: NodeJS.ProcessEnv;
  aiToolkit?: {
    mountRoutes: (app: Express) => void;
  };
  clientDist?: string;
  routers?: Partial<Record<
    'databases' | 'persons' | 'search' | 'favorites' | 'aiDiscovery',
    Router
  >>;
}

export const createApp = ({
  env = process.env,
  aiToolkit,
  clientDist = findClientDist(),
  routers = {},
}: CreateAppOptions = {}): Express => {
  const access = resolveAccessConfig(env);
  const app = express();
  app.disable('x-powered-by');

  app.use(cors({ origin: access.origins, credentials: false }));
  // Gate every toolkit/API handler before parsing bodies or initializing work.
  app.use(createAccessBoundary(access.token));
  app.use(express.json());
  app.use(requestTimeout);
  app.use(requestLogger);

  (aiToolkit ?? initAIToolkit(null)).mountRoutes(app);

  app.use('/api/databases', routers.databases ?? databaseRoutes);
  app.use('/api/persons', routers.persons ?? personRoutes);
  app.use('/api/search', routers.search ?? searchRoutes);
  app.use('/api/path', pathRoutes);
  app.use('/api/indexer', indexerRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/browser', browserRouter);
  app.use('/api/augment', augmentationRouter);
  app.use('/api/genealogy-providers', genealogyProviderRouter);
  app.use('/api/scrape-providers', providerRouter);
  app.use('/api/gedcom', gedcomRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/favorites', routers.favorites ?? favoritesRouter);
  app.use('/api/ancestry-tree', ancestryTreeRouter);
  app.use('/api/ai-discovery', routers.aiDiscovery ?? aiDiscoveryRouter);
  app.use('/api/test-runner', testRunnerRouter);
  app.use('/api/integrity', integrityRouter);
  app.use('/api/ancestry-hints', ancestryHintsRouter);
  app.use('/api/ancestry-update', ancestryUpdateRouter);
  app.use('/api/map', mapRouter);
  app.use('/api/audit', auditorRouter);
  app.use('/api/deaths', deathsRouter);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api', apiNotFound);

  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
    logger.ok('server', 'Serving built UI from client/dist');
  }

  app.use(errorHandler);

  return app;
};
