import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileNamedQuery,
  createPostgresService,
  resolveDatabaseUrl,
} from '../../../server/src/db/postgres.service.js';

const queryResult = <T extends Record<string, unknown>>(rows: T[] = []) => ({
  command: 'SELECT',
  rowCount: rows.length,
  oid: 0,
  fields: [],
  rows,
});

function createPoolMock() {
  const client = {
    query: vi.fn(async () => queryResult()),
    release: vi.fn(),
  };
  return {
    client,
    pool: {
      query: vi.fn(async () => queryResult()),
      connect: vi.fn(async () => client),
      end: vi.fn(async () => undefined),
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('PostgreSQL configuration', () => {
  it('uses only a non-empty DATABASE_URL', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: ' postgresql://localhost/sparsetree ' }))
      .toBe('postgresql://localhost/sparsetree');
    expect(resolveDatabaseUrl({ DATABASE_URL: '   ' })).toBeUndefined();
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });

  it('does not create a pool until a query needs one', async () => {
    const { pool } = createPoolMock();
    const poolFactory = vi.fn(() => pool);
    const service = createPostgresService({
      connectionString: 'postgresql://localhost/sparsetree',
      poolFactory,
    });

    expect(service.isConfigured()).toBe(true);
    expect(poolFactory).not.toHaveBeenCalled();

    await service.queryAll('SELECT 1');

    expect(poolFactory).toHaveBeenCalledWith({
      connectionString: 'postgresql://localhost/sparsetree',
      application_name: 'sparsetree',
      connectionTimeoutMillis: 2_000,
      query_timeout: 10_000,
    });
  });

  it('reports an absent or unreachable database as unavailable', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const unconfigured = createPostgresService();
    const { pool } = createPoolMock();
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    const unreachable = createPostgresService({ pool });

    await expect(unconfigured.isAvailable()).resolves.toBe(false);
    expect(() => unconfigured.getPool()).toThrow('set DATABASE_URL');
    await expect(unreachable.isAvailable()).resolves.toBe(false);
  });
});

describe('compileNamedQuery', () => {
  it('reuses positions and ignores tokens inside PostgreSQL literals and comments', () => {
    const compiled = compileNamedQuery(
      `SELECT '@literal', "@identifier", $$@dollar$$
       FROM person
       WHERE person_id = @personId OR person_id = @personId
         AND display_name = @name -- @lineComment
         /* outer @comment /* nested @comment */ still ignored */`,
      { personId: '01PERSON', name: 'Ada' }
    );

    expect(compiled.text).toContain('person_id = $1 OR person_id = $1');
    expect(compiled.text).toContain('display_name = $2');
    expect(compiled.text).toContain("'@literal'");
    expect(compiled.text).toContain('$$@dollar$$');
    expect(compiled.text).toContain('-- @lineComment');
    expect(compiled.values).toEqual(['01PERSON', 'Ada']);
  });

  it('fails before querying when a named value is missing', () => {
    expect(() => compileNamedQuery('SELECT * FROM person WHERE person_id = @personId', {}))
      .toThrow('Missing PostgreSQL query parameter: personId');
  });
});

describe('PostgreSQL query service', () => {
  it('returns rows and forwards named parameters as positional values', async () => {
    const { pool } = createPoolMock();
    pool.query.mockResolvedValueOnce(queryResult([{ person_id: '01PERSON' }]));
    const service = createPostgresService({ pool });

    await expect(service.queryOne<{ person_id: string }>(
      'SELECT person_id FROM person WHERE person_id = @personId',
      { personId: '01PERSON' }
    )).resolves.toEqual({ person_id: '01PERSON' });

    expect(pool.query).toHaveBeenCalledWith(
      'SELECT person_id FROM person WHERE person_id = $1',
      ['01PERSON']
    );
  });

  it('commits successful transactions and releases the client', async () => {
    const { client, pool } = createPoolMock();
    client.query
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult([{ person_id: '01PERSON' }]))
      .mockResolvedValueOnce(queryResult());
    const service = createPostgresService({ pool });

    const result = await service.transaction(async (tx) => tx.queryOne<{ person_id: string }>(
      'SELECT person_id FROM person WHERE person_id = @personId',
      { personId: '01PERSON' }
    ));

    expect(result).toEqual({ person_id: '01PERSON' });
    expect(client.query.mock.calls).toEqual([
      ['BEGIN'],
      ['SELECT person_id FROM person WHERE person_id = $1', ['01PERSON']],
      ['COMMIT'],
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back failed transactions and releases the client', async () => {
    const { client, pool } = createPoolMock();
    const service = createPostgresService({ pool });

    await expect(service.transaction(async () => {
      throw new Error('write failed');
    })).rejects.toThrow('write failed');

    expect(client.query.mock.calls).toEqual([['BEGIN'], ['ROLLBACK']]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('applies and records the baseline once, then retries after a failed initialization', async () => {
    const { client, pool } = createPoolMock();
    client.query.mockRejectedValueOnce(new Error('schema unavailable'));
    const service = createPostgresService({ pool, schemaSql: 'CREATE TABLE example (id TEXT)' });

    await expect(service.initDb()).rejects.toThrow('schema unavailable');
    await expect(service.initDb()).resolves.toEqual({ applied: ['postgres_schema_baseline'], skipped: [] });
    await expect(service.initDb()).resolves.toEqual({ applied: ['postgres_schema_baseline'], skipped: [] });

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe('BEGIN');
    expect(statements).toContain('CREATE TABLE example (id TEXT)');
    expect(statements.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(true);
    expect(statements.some(sql => sql.includes('INSERT INTO schema_migrations'))).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(client.query).toHaveBeenCalledTimes(8);
  });

  it('reports the baseline as pending when a database has no migration ledger', async () => {
    const { pool } = createPoolMock();
    pool.query.mockResolvedValueOnce(queryResult([{ exists: false }]));
    const service = createPostgresService({ pool, schemaSql: 'CREATE TABLE example (id TEXT)' });

    await expect(service.getSchemaMigrationStatus()).resolves.toMatchObject([
      { version: '001', name: 'postgres_schema_baseline', applied: false },
    ]);
  });

  it('applies versioned PostgreSQL migrations after the baseline and records each one', async () => {
    const { client, pool } = createPoolMock();
    const service = createPostgresService({
      pool,
      schemaSql: 'CREATE TABLE example (id TEXT)',
      migrations: [{ version: '002', name: 'add_example_index', sql: 'CREATE INDEX example_id_idx ON example (id)' }],
    });

    await expect(service.initDb()).resolves.toEqual({
      applied: ['postgres_schema_baseline', 'add_example_index'],
      skipped: [],
    });

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.indexOf('CREATE TABLE example (id TEXT)')).toBeLessThan(
      statements.indexOf('CREATE INDEX example_id_idx ON example (id)'),
    );
    expect(statements.filter(sql => sql.includes('INSERT INTO schema_migrations'))).toHaveLength(2);
  });

  it('loads numbered SQL migrations from the configured migrations directory', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sparsetree-migrations-'));
    try {
      await writeFile(path.join(directory, '003_add_second.sql'), 'SELECT 3');
      await writeFile(path.join(directory, '002_add_first.sql'), 'SELECT 2');
      const { client, pool } = createPoolMock();
      const service = createPostgresService({ pool, schemaSql: 'SELECT 1', migrationsDirectory: directory });

      await expect(service.initDb()).resolves.toEqual({
        applied: ['postgres_schema_baseline', 'add_first', 'add_second'],
        skipped: [],
      });
      const statements = client.query.mock.calls.map(([sql]) => String(sql));
      expect(statements.indexOf('SELECT 2')).toBeLessThan(statements.indexOf('SELECT 3'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('closes the pool and clears configured state', async () => {
    const { pool } = createPoolMock();
    const service = createPostgresService({ pool });

    await service.closeDb();

    expect(pool.end).toHaveBeenCalledOnce();
    expect(service.isConfigured()).toBe(false);
  });
});
