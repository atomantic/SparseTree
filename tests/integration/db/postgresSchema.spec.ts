import { readFile } from 'fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  POSTGRES_SCHEMA_PATH,
  createPostgresService,
} from '../../../server/src/db/postgres.service.js';

const connectionString = process.env.SPARSETREE_TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres('PostgreSQL schema baseline', () => {
  const schemaName = `sparsetree_test_${process.pid}_${Date.now()}`;
  const quotedSchema = `"${schemaName}"`;
  let pool: Pool;
  let schemaSql: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString, application_name: 'sparsetree-schema-test' });
    await pool.query(`CREATE SCHEMA ${quotedSchema}`);
    const baseline = await readFile(POSTGRES_SCHEMA_PATH, 'utf8');
    schemaSql = `SET search_path TO ${quotedSchema};\n${baseline}`;
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await pool.end();
  });

  it('can be applied twice and creates the current derived-store tables', async () => {
    await createPostgresService({ pool, schemaSql }).initDb();
    await createPostgresService({ pool, schemaSql }).initDb();

    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schemaName]
    );

    expect(result.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
      'person',
      'external_identity',
      'parent_edge',
      'database_info',
      'database_membership',
      'favorite',
      'local_override',
      'person_search',
      'audit_run',
      'audit_issue',
      'audit_change',
      'migration',
    ]));
  });

  it('uses PostgreSQL-native booleans, timestamps, JSON, and indexed tsvectors', async () => {
    const columns = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = $1
         AND (table_name, column_name) IN (
           ('person', 'living'),
           ('person', 'created_at'),
           ('favorite', 'tags'),
           ('audit_run', 'config'),
           ('person_search', 'search_document')
         )`,
      [schemaName]
    );

    expect(columns.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ table_name: 'person', column_name: 'living', data_type: 'boolean' }),
      expect.objectContaining({ table_name: 'person', column_name: 'created_at', data_type: 'timestamp with time zone' }),
      expect.objectContaining({ table_name: 'favorite', column_name: 'tags', data_type: 'jsonb' }),
      expect.objectContaining({ table_name: 'audit_run', column_name: 'config', data_type: 'jsonb' }),
      expect.objectContaining({ table_name: 'person_search', column_name: 'search_document', data_type: 'tsvector' }),
    ]));

    const searchIndex = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = $1 AND indexname = 'idx_person_search_document'`,
      [schemaName]
    );
    expect(searchIndex.rows[0]?.indexdef).toContain('USING gin');
  });
});
