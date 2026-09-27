import { createPostgresSearch } from './postgres-search.js';
import { createJsonSearch } from './json-search.js';
import { postgresService } from '../db/postgres.service.js';
import { logger } from '../lib/logger.js';
import { createJsonDatabase } from './json-database.js';
import { createPostgresDatabase, DatabaseNotFoundError, type PostgresStore } from './postgres-database.js';
import { scraperService } from './scraper.service.js';

/** Only availability failures may replay a read against JSON; SQL bugs surface. */
export function isQueryStoreUnavailable(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.some(isQueryStoreUnavailable);
  if (!error || typeof error !== 'object') return false;
  const { code, message, syscall } = error as { code?: string; message?: string; syscall?: string };
  return Boolean((code === 'ENOENT' && syscall === 'connect') || code?.startsWith('08') || [
    'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
    '57P01', '57P02', '57P03', '53300', '42P01', '3F000', '3D000', '28P01', '28000',
  ].includes(code ?? '') || [
    'Connection terminated unexpectedly', 'Connection terminated',
    'Connection terminated due to connection timeout', 'timeout exceeded when trying to connect', 'Query read timeout',
  ].includes(message ?? ''));
}

export function createDatabaseService(
  store: PostgresStore = postgresService,
  json = createJsonDatabase(),
  postgres = createPostgresDatabase(store, undefined, id => scraperService.hasPhoto(id)),
) {
  let availability: Promise<boolean> | undefined;
  let retryAfter = 0;
  const unavailable = () => {
    availability = Promise.resolve(false);
    retryAfter = Date.now() + 5_000;
    logger.warn('db', 'PostgreSQL query store unavailable; serving JSON-backed reads');
  };
  const isPostgresEnabled = async (): Promise<boolean> => {
    if (!store.isConfigured()) return false;
    if (!availability || (retryAfter && Date.now() >= retryAfter)) {
      retryAfter = 0;
      availability = store.initDb().then(() => store.queryOne<{ populated: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM person) AS populated',
      )).then(row => {
        if (!row?.populated) unavailable();
        return row?.populated ?? false;
      }).catch(error => {
        if (!isQueryStoreUnavailable(error)) throw error;
        unavailable();
        return false;
      });
    }
    return availability;
  };
  const read = <Args extends unknown[], Result>(
    fromPostgres: (...args: Args) => Promise<Result>,
    fromJson: (...args: Args) => Promise<Result>,
  ) => async (...args: Args): Promise<Result> => {
    if (await isPostgresEnabled()) {
      try {
        return await fromPostgres(...args);
      } catch (error) {
        if (error instanceof DatabaseNotFoundError) return fromJson(...args);
        if (!isQueryStoreUnavailable(error)) throw error;
        unavailable();
      }
    }
    return fromJson(...args);
  };
  const write = <Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      if (!await isPostgresEnabled()) throw new Error('PostgreSQL is required for this operation');
      // Writes are never retried against another backend after an uncertain outcome.
      return operation(...args);
    };
  const postgresSearch = createPostgresSearch(store, postgres);
  const jsonSearch = createJsonSearch(json.getDatabase);
  return {
    search: read(postgresSearch.search, jsonSearch.search),
    quickSearch: read(postgresSearch.quickSearch, jsonSearch.quickSearch),
    isPostgresEnabled,
    async reinitialize(): Promise<boolean> {
      availability = undefined;
      retryAfter = 0;
      return isPostgresEnabled();
    },
    resolveDbId: read(postgres.resolveDbId, json.resolveDbId),
    listDatabases: read(async () => {
      const values = await postgres.listDatabases();
      values.forEach(value => json.rememberInfo(value));
      return values;
    }, json.listDatabases),
    getDatabaseInfo: read(async id => {
      const value = await postgres.getDatabaseInfo(id);
      json.rememberInfo(value, id);
      return value;
    }, json.getDatabaseInfo),
    getDatabase: read(postgres.getDatabase, json.getDatabase),
    getPerson: read(async (dbId, personId) => {
      const value = await postgres.getPerson(dbId, personId);
      if (value) json.rememberPerson(value);
      return value;
    }, json.getPerson),
    getPersonsBatch: read(postgres.getPersonsBatch, json.getPersonsBatch),
    getAncestorsLimited: read(postgres.getAncestorsLimited, json.getAncestorsLimited),
    listPersons: read(postgres.listPersons, json.listPersons),
    personExists: read(postgres.personExists, json.personExists),
    isRoot: read(postgres.isRoot, json.isRoot),
    getTreeStats: read(postgres.getTreeStats, json.getTreeStats),
    getOnThisDay: read(postgres.getOnThisDay, json.getOnThisDay),
    createRoot: write(postgres.createRoot),
    updateRoot: write(postgres.updateRoot),
    refreshRootCount: write(postgres.refreshRootCount),
    calculateMaxGenerations: write(postgres.calculateMaxGenerations),
    async deleteDatabase(id: string): Promise<void> {
      if (store.isConfigured()) {
        if (!await isPostgresEnabled()) throw new Error('PostgreSQL must be available before deleting a database');
        // Remember the JSON alias before removing the query-store root.
        const info = await postgres.getDatabaseInfo(id);
        json.rememberInfo(info, id);
        json.assertDeletable(id);
        await postgres.deleteDatabase(id);
      }
      await json.deleteDatabase(id);
    },
  };
}

export const databaseService = createDatabaseService();
export const resolveDbId = databaseService.resolveDbId;
