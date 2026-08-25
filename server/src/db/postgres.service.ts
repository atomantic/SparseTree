import { readFile } from 'fs/promises';
import path from 'path';
import {
  Pool,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

export const POSTGRES_SCHEMA_PATH = path.join(import.meta.dirname, 'postgres-schema.sql');

export type QueryParams = Record<string, unknown> | readonly unknown[];

interface QueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

interface PoolClientLike extends QueryExecutor {
  release(): void;
}

interface PoolLike extends QueryExecutor {
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
}

interface PostgresServiceOptions {
  connectionString?: string;
  pool?: PoolLike;
  poolFactory?: (config: PoolConfig) => PoolLike;
  schemaPath?: string;
  schemaSql?: string;
}

export interface CompiledQuery {
  text: string;
  values: unknown[];
}

type SqlState = 'code' | 'single-quote' | 'double-quote' | 'line-comment' | 'block-comment' | 'dollar-quote';

/**
 * Resolve the staged PostgreSQL backend configuration without inventing a
 * local/default credential. An empty value means PostgreSQL is not configured.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.DATABASE_URL?.trim();
  return value || undefined;
}

/**
 * Convert the named @parameter convention used by the current query layer into
 * pg's positional parameters. Tokens inside strings/comments are left intact.
 */
export function compileNamedQuery(sql: string, params: Record<string, unknown>): CompiledQuery {
  const positions = new Map<string, number>();
  const values: unknown[] = [];
  let text = '';
  let state: SqlState = 'code';
  let blockCommentDepth = 0;
  let dollarQuoteDelimiter = '';

  for (let index = 0; index < sql.length;) {
    const char = sql[index];
    const next = sql[index + 1];

    if (state === 'single-quote') {
      text += char;
      if (char === "'" && next === "'") {
        text += next;
        index += 2;
        continue;
      }
      if (char === "'") state = 'code';
      index++;
      continue;
    }

    if (state === 'double-quote') {
      text += char;
      if (char === '"' && next === '"') {
        text += next;
        index += 2;
        continue;
      }
      if (char === '"') state = 'code';
      index++;
      continue;
    }

    if (state === 'line-comment') {
      text += char;
      if (char === '\n') state = 'code';
      index++;
      continue;
    }

    if (state === 'block-comment') {
      if (char === '/' && next === '*') {
        text += '/*';
        blockCommentDepth++;
        index += 2;
        continue;
      }
      if (char === '*' && next === '/') {
        text += '*/';
        blockCommentDepth--;
        if (blockCommentDepth === 0) state = 'code';
        index += 2;
        continue;
      }
      text += char;
      index++;
      continue;
    }

    if (state === 'dollar-quote') {
      if (sql.startsWith(dollarQuoteDelimiter, index)) {
        text += dollarQuoteDelimiter;
        index += dollarQuoteDelimiter.length;
        state = 'code';
        continue;
      }
      text += char;
      index++;
      continue;
    }

    if (char === "'") {
      state = 'single-quote';
      text += char;
      index++;
      continue;
    }
    if (char === '"') {
      state = 'double-quote';
      text += char;
      index++;
      continue;
    }
    if (char === '-' && next === '-') {
      state = 'line-comment';
      text += '--';
      index += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block-comment';
      blockCommentDepth = 1;
      text += '/*';
      index += 2;
      continue;
    }
    if (char === '$') {
      const delimiter = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) {
        state = 'dollar-quote';
        dollarQuoteDelimiter = delimiter;
        text += delimiter;
        index += delimiter.length;
        continue;
      }
    }
    if (char === '@' && next && /[A-Za-z_]/.test(next)) {
      const match = sql.slice(index + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      const name = match?.[0];
      if (!name) {
        text += char;
        index++;
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(params, name)) {
        throw new Error(`Missing PostgreSQL query parameter: ${name}`);
      }
      let position = positions.get(name);
      if (position === undefined) {
        values.push(params[name]);
        position = values.length;
        positions.set(name, position);
      }
      text += `$${position}`;
      index += name.length + 1;
      continue;
    }

    text += char;
    index++;
  }

  return { text, values };
}

function normalizeQuery(sql: string, params?: QueryParams): CompiledQuery {
  if (!params) return { text: sql, values: [] };
  if (Array.isArray(params)) return { text: sql, values: [...params] };
  return compileNamedQuery(sql, params as Record<string, unknown>);
}

/**
 * Create an isolated service instance. The exported singleton below uses the
 * process environment; tests and future workers can inject a pool explicitly.
 */
export function createPostgresService(options: PostgresServiceOptions = {}) {
  const connectionString = options.connectionString?.trim() || resolveDatabaseUrl();
  const poolFactory = options.poolFactory ?? ((config: PoolConfig) => new Pool(config));
  let pool: PoolLike | null = options.pool ?? null;
  let initialization: Promise<void> | null = null;

  const isConfigured = (): boolean => Boolean(pool || connectionString);

  const getPool = (): PoolLike => {
    if (pool) return pool;
    if (!connectionString) {
      throw new Error('PostgreSQL is not configured; set DATABASE_URL to enable the query store');
    }
    pool = poolFactory({ connectionString, application_name: 'sparsetree' });
    return pool;
  };

  const execute = <T extends QueryResultRow>(
    executor: QueryExecutor,
    sql: string,
    params?: QueryParams
  ): Promise<QueryResult<T>> => {
    const query = normalizeQuery(sql, params);
    return executor.query<T>(query.text, query.values);
  };

  const queryAll = async <T extends QueryResultRow>(sql: string, params?: QueryParams): Promise<T[]> => {
    const result = await execute<T>(getPool(), sql, params);
    return result.rows;
  };

  const queryOne = async <T extends QueryResultRow>(sql: string, params?: QueryParams): Promise<T | undefined> => {
    const result = await execute<T>(getPool(), sql, params);
    return result.rows[0];
  };

  const run = <T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: QueryParams
  ): Promise<QueryResult<T>> => execute<T>(getPool(), sql, params);

  const transaction = async <T>(work: (tx: {
    queryAll<Row extends QueryResultRow>(sql: string, params?: QueryParams): Promise<Row[]>;
    queryOne<Row extends QueryResultRow>(sql: string, params?: QueryParams): Promise<Row | undefined>;
    run<Row extends QueryResultRow = QueryResultRow>(sql: string, params?: QueryParams): Promise<QueryResult<Row>>;
  }) => Promise<T>): Promise<T> => {
    const client = await getPool().connect();
    let started = false;
    try {
      await client.query('BEGIN');
      started = true;
      const result = await work({
        queryAll: async <Row extends QueryResultRow>(sql: string, params?: QueryParams) =>
          (await execute<Row>(client, sql, params)).rows,
        queryOne: async <Row extends QueryResultRow>(sql: string, params?: QueryParams) =>
          (await execute<Row>(client, sql, params)).rows[0],
        run: <Row extends QueryResultRow = QueryResultRow>(sql: string, params?: QueryParams) =>
          execute<Row>(client, sql, params),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (started) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  const loadSchema = (): Promise<string> => options.schemaSql !== undefined
    ? Promise.resolve(options.schemaSql)
    : readFile(options.schemaPath ?? POSTGRES_SCHEMA_PATH, 'utf8');

  const initDb = (): Promise<void> => {
    if (!initialization) {
      initialization = loadSchema()
        .then((schema) => transaction((tx) => tx.run(schema)))
        .then(() => undefined)
        .catch((error) => {
          initialization = null;
          throw error;
        });
    }
    return initialization;
  };

  const isAvailable = (): Promise<boolean> => {
    if (!isConfigured()) return Promise.resolve(false);
    return Promise.resolve()
      .then(() => getPool().query('SELECT 1'))
      .then(() => true, () => false);
  };

  const closeDb = async (): Promise<void> => {
    if (!pool) return;
    const activePool = pool;
    pool = null;
    initialization = null;
    await activePool.end();
  };

  const tableExists = async (tableName: string, schema = 'public'): Promise<boolean> => {
    const row = await queryOne<{ exists: boolean }>(
      'SELECT to_regclass(@qualifiedName) IS NOT NULL AS exists',
      { qualifiedName: `${schema}.${tableName}` }
    );
    return row?.exists ?? false;
  };

  const migrationApplied = async (name: string): Promise<boolean> => {
    const row = await queryOne<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM migration WHERE name = @name) AS exists',
      { name }
    );
    return row?.exists ?? false;
  };

  const recordMigration = (name: string): Promise<QueryResult> => run(
    `INSERT INTO migration (name)
     VALUES (@name)
     ON CONFLICT (name) DO NOTHING`,
    { name }
  );

  return {
    isConfigured,
    isAvailable,
    initDb,
    getPool,
    closeDb,
    queryAll,
    queryOne,
    run,
    transaction,
    tableExists,
    migrationApplied,
    recordMigration,
  };
}

export const postgresService = createPostgresService();
