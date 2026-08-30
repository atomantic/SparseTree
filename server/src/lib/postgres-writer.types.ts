import type { Database, Person } from '@fsf/shared';
import type { QueryResult, QueryResultRow } from 'pg';
import type { QueryParams } from '../db/postgres.service.js';

export type CanonicalIds = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

export interface ProviderLifeEvent {
  eventType: string;
  eventRole?: string;
  sourceId?: string;
  dateOriginal?: string;
  dateFormal?: string;
  dateYear?: number;
  dateMonth?: number;
  dateDay?: number;
  dateEndYear?: number;
  placeOriginal?: string;
  placeNormalized?: string;
  placeId?: string;
  value?: string;
  description?: string;
  cause?: string;
}

export interface ProviderNote {
  noteType?: string;
  title?: string;
  content: string;
  contentType?: string;
  language?: string;
  sourceId?: string;
  author?: string;
}

export interface WritablePerson extends Person {
  titleOfNobility?: string;
  militaryService?: string;
  causeOfDeath?: string;
  allLifeEvents?: ProviderLifeEvent[];
  notes?: ProviderNote[];
}

export type WritableDatabase = Record<string, WritablePerson>;

export interface PostgresTransaction {
  queryAll<Row extends QueryResultRow>(sql: string, params?: QueryParams): Promise<Row[]>;
  queryOne<Row extends QueryResultRow>(sql: string, params?: QueryParams): Promise<Row | undefined>;
  run<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: QueryParams
  ): Promise<QueryResult<Row>>;
}

export interface PostgresWriterService {
  isConfigured(): boolean;
  initDb(): Promise<void>;
  closeDb(): Promise<void>;
  transaction<T>(work: (tx: PostgresTransaction) => Promise<T>): Promise<T>;
}

export interface PostgresRebuildOptions {
  rootExternalId: string;
  database: Database | WritableDatabase;
  databaseId?: string;
  canonicalIds?: CanonicalIds;
  isSample?: boolean;
}

export interface PostgresRebuildResult {
  databaseId: string;
  rootPersonId: string;
  personIds: Map<string, string>;
  personCount: number;
  parentEdgeCount: number;
  spouseEdgeCount: number;
}
