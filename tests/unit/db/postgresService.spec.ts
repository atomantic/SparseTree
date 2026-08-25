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

  it('initializes one time per service and retries after a failed initialization', async () => {
    const { client, pool } = createPoolMock();
    client.query
      .mockResolvedValueOnce(queryResult())
      .mockRejectedValueOnce(new Error('schema unavailable'))
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult());
    const service = createPostgresService({ pool, schemaSql: 'CREATE TABLE example (id TEXT)' });

    await expect(service.initDb()).rejects.toThrow('schema unavailable');
    await expect(service.initDb()).resolves.toBeUndefined();
    await expect(service.initDb()).resolves.toBeUndefined();

    expect(client.query.mock.calls).toEqual([
      ['BEGIN'],
      ['CREATE TABLE example (id TEXT)', []],
      ['ROLLBACK'],
      ['BEGIN'],
      ['CREATE TABLE example (id TEXT)', []],
      ['COMMIT'],
    ]);
  });

  it('closes the pool and clears configured state', async () => {
    const { pool } = createPoolMock();
    const service = createPostgresService({ pool });

    await service.closeDb();

    expect(pool.end).toHaveBeenCalledOnce();
    expect(service.isConfigured()).toBe(false);
  });
});
