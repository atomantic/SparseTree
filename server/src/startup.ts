import type { Server } from 'http';

interface StartupLogger {
  start: (scope: string, message: string) => void;
  ok: (scope: string, message: string) => void;
  error: (scope: string, message: string) => void;
  warn: (scope: string, message: string) => void;
}

interface StartServerOptions {
  httpServer: Server;
  runMigrations: () => Promise<{ applied: string[]; skipped: string[]; unavailable?: boolean }>;
  closeDatabase: () => void | Promise<void>;
  autoConnectToBrowser: () => void;
  logger: StartupLogger;
  host: string;
  port: number;
}

/** Run database migrations before opening the HTTP listener. */
export async function startServer({
  httpServer,
  runMigrations,
  closeDatabase,
  autoConnectToBrowser,
  logger,
  host,
  port,
}: StartServerOptions): Promise<void> {
  try {
    const { applied, unavailable } = await runMigrations();
    if (unavailable) {
      logger.warn('db', 'PostgreSQL is unavailable; starting with read-only JSON fallback');
    } else if (applied.length > 0) {
      logger.ok('server', `Applied ${applied.length} migration(s): ${applied.join(', ')}`);
    } else {
      logger.ok('server', 'PostgreSQL schema is up to date');
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        httpServer.off('error', onError);
        reject(error);
      };

      httpServer.once('error', onError);
      httpServer.listen(port, host, () => {
        httpServer.off('error', onError);
        logger.start('server', `Running on http://${host}:${port}`);
        resolve();
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('server', `Startup failed before readiness: ${message}`);
    await closeDatabase();
    throw error;
  }

  autoConnectToBrowser();
}
