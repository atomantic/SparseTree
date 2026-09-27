import { EventEmitter } from 'events';
import type { Server } from 'http';
import { startServer } from '../../../server/src/startup.js';

function createServerStub(onListen?: () => void) {
  const server = new EventEmitter() as Server & { listen: ReturnType<typeof vi.fn> };
  server.listen = vi.fn((_port: number, _host: string, callback: () => void) => {
    onListen?.();
    callback();
    return server;
  });
  return server;
}

function createLogger() {
  return {
    start: vi.fn(),
    ok: vi.fn(),
    error: vi.fn(),
  };
}

describe('startServer', () => {
  it('waits for migrations before listening and reporting readiness', async () => {
    let resolveMigrations!: (result: { applied: string[]; skipped: string[] }) => void;
    const runMigrations = vi.fn(() => new Promise<{ applied: string[]; skipped: string[] }>((resolve) => {
      resolveMigrations = resolve;
    }));
    const events: string[] = [];
    const httpServer = createServerStub(() => events.push('listen'));
    const logger = createLogger();
    logger.start.mockImplementation(() => events.push('ready'));
    const autoConnectToBrowser = vi.fn(() => events.push('browser'));
    const startup = startServer({
      httpServer,
      runMigrations,
      closeDatabase: vi.fn(),
      autoConnectToBrowser,
      logger,
      host: 'localhost',
      port: 6374,
    });

    expect(runMigrations).toHaveBeenCalledOnce();
    expect(httpServer.listen).not.toHaveBeenCalled();
    expect(logger.start).not.toHaveBeenCalled();

    resolveMigrations({ applied: ['001_initial'], skipped: [] });
    await startup;

    expect(httpServer.listen).toHaveBeenCalledWith(6374, 'localhost', expect.any(Function));
    expect(events).toEqual(['listen', 'ready', 'browser']);
    expect(logger.ok).toHaveBeenCalledWith('server', 'Applied 1 migration(s): 001_initial');
  });

  it('closes the database and rejects startup without listening when migrations fail', async () => {
    const migrationError = new Error('migration failed');
    const httpServer = createServerStub();
    const closeDatabase = vi.fn();
    const autoConnectToBrowser = vi.fn();
    const logger = createLogger();

    await expect(startServer({
      httpServer,
      runMigrations: vi.fn().mockRejectedValue(migrationError),
      closeDatabase,
      autoConnectToBrowser,
      logger,
      host: 'localhost',
      port: 6374,
    })).rejects.toBe(migrationError);

    expect(httpServer.listen).not.toHaveBeenCalled();
    expect(autoConnectToBrowser).not.toHaveBeenCalled();
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith('server', 'Startup failed before readiness: migration failed');
  });
});
