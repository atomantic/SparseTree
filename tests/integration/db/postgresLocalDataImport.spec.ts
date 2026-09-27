import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresService } from '../../../server/src/db/postgres.service.js';
import { importPostgresLocalData, LOCAL_DATA_IMPORT_MIGRATION } from '../../../server/src/lib/postgres-local-data-import.js';

const connectionString = process.env.SPARSETREE_TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;
const hash = 'a'.repeat(64);
const sqliteSchema = readFileSync(new URL('../../../server/src/db/schema.sql', import.meta.url), 'utf8');

function seedLegacy(filename: string): void {
  const db = new Database(filename);
  try {
    db.exec(sqliteSchema);
    db.exec(`
      ALTER TABLE person ADD COLUMN is_unusual_death INTEGER DEFAULT 0;
      CREATE TABLE local_override (override_id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, field_name TEXT,
        original_value TEXT, override_value TEXT, reason TEXT, source TEXT DEFAULT 'local',
        created_at TEXT DEFAULT '2000-01-01 12:00:00', updated_at TEXT DEFAULT '2000-01-01 12:00:00');
      CREATE TABLE unusual_death_keyword (keyword TEXT PRIMARY KEY, created_at TEXT DEFAULT '2000-01-01 12:00:00');
      INSERT INTO person(person_id, display_name, is_unusual_death) VALUES
        ('old-root', 'Root', 1), ('old-person', 'Person', 0), ('old-other', 'Other', 0), ('same-id', 'Same ID', 0);
      INSERT INTO external_identity(person_id, source, external_id) VALUES
        ('old-root', 'familysearch', 'ROOT'), ('old-person', 'familysearch', 'PERSON'), ('old-other', 'familysearch', 'OTHER');
      INSERT INTO database_info(db_id, root_id, source_provider) VALUES ('old-db', 'old-root', 'familysearch');
      INSERT INTO vital_event(id, person_id, event_type, date_original, place, source) VALUES
        (41, 'old-person', 'birth', '1900', 'Provider place', 'familysearch'),
        (42, 'old-other', 'death', '1970', 'Local place', 'local');
      INSERT INTO claim(claim_id, person_id, predicate, value_text, source) VALUES
        ('old-provider', 'old-person', 'occupation', 'Painter', 'familysearch'),
        ('old-local', 'old-person', 'occupation', 'Researcher', 'local'),
        ('old-missing-provider', 'old-person', 'alias', 'Old provider alias', 'familysearch');
      INSERT INTO local_override(override_id, entity_type, entity_id, field_name, override_value) VALUES
        ('override-person', 'person', 'old-person', 'display_name', 'Research name'),
        ('override-event', 'vital_event', '41', 'place', 'Corrected place'),
        ('override-claim', 'claim', 'old-provider', 'value_text', 'Writer'),
        ('override-missing', 'claim', 'old-missing-provider', 'value_text', 'Corrected alias'),
        ('override-face', 'person', 'old-person', 'photo_face', '{"x":0.2,"y":0.3}'),
        ('override-same-id', 'person', 'same-id', 'bio', 'Local biography');
      INSERT INTO favorite(db_id, person_id, why_interesting, tags, added_at)
        VALUES ('old-db', 'old-person', 'Legacy favorite', '["artist"]', '2000-01-01 12:00:00');
      INSERT INTO discovery_dismissed(db_id, person_id, ai_reason, ai_tags, dismissed_at)
        VALUES ('old-db', 'old-other', 'Legacy dismissal', '["reviewed"]', '2000-01-01 12:00:00');
      INSERT INTO blob(blob_hash, path, mime_type, size_bytes, width, height, created_at)
        VALUES ('${hash}', 'blobs/aa/${hash}.jpg', 'image/jpeg', 9, 20, 30, '2000-01-01 12:00:00');
      INSERT INTO media(media_id, person_id, blob_hash, source, is_primary, caption)
        VALUES ('old-media', 'old-person', '${hash}', 'local', 1, 'Legacy portrait');
      INSERT INTO description(person_id, text, source) VALUES ('old-person', 'Research description', 'custom');
      INSERT INTO provider_mapping(person_id, provider, account_id, match_method)
        VALUES ('old-person', 'ancestry', 'provider-account', 'manual');
      INSERT INTO parent_edge(child_id, parent_id, parent_role, source) VALUES ('old-person', 'old-other', 'father', 'local');
      INSERT INTO spouse_edge(person1_id, person2_id, source) VALUES ('old-root', 'old-other', 'local');
      INSERT INTO unusual_death_keyword(keyword) VALUES ('fixture asteroid');
      INSERT INTO place_geocode(place_text, lat, lng, display_name, geocode_status, geocoded_at)
        VALUES ('Fixture place', 1.25, 2.5, 'Resolved fixture place', 'resolved', '2000-01-01 12:00:00');
    `);
  } finally {
    db.close();
  }
}

describePostgres('explicit SQLite local-data import into PostgreSQL', () => {
  const schema = `sparsetree_local_import_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let store: ReturnType<typeof createPostgresService>;
  let directory: string;
  let filename: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 2000 });
    pool.on('error', () => {});
    store = createPostgresService({ pool });
    await store.initDb();
    directory = await mkdtemp(path.join(os.tmpdir(), 'sparsetree-local-import-'));
    filename = path.join(directory, 'source.sqlite');
  });

  beforeEach(async () => {
    await rm(filename, { force: true });
    seedLegacy(filename);
    await store.run('TRUNCATE person, database_info, blob, place_geocode, unusual_death_keyword, local_override, migration CASCADE');
    await store.run(`INSERT INTO person(person_id, display_name) VALUES
      ('new-root', 'Root'), ('new-person', 'Person'), ('new-other', 'Other'), ('same-id', 'Same ID')`);
    await store.run(`INSERT INTO external_identity(person_id, source, external_id) VALUES
      ('new-root', 'familysearch', 'ROOT'), ('new-person', 'familysearch', 'PERSON'), ('new-other', 'familysearch', 'OTHER')`);
    await store.run("INSERT INTO database_info(db_id, root_id, source_provider) VALUES ('new-db', 'new-root', 'familysearch')");
    await store.run("INSERT INTO vital_event(person_id, event_type, date_original, place, source) VALUES ('new-person', 'birth', '1901', 'New provider place', 'familysearch')");
    await store.run("INSERT INTO claim(claim_id, person_id, predicate, value_text, source) VALUES ('new-provider', 'new-person', 'occupation', 'Painter', 'familysearch')");
  });

  afterAll(async () => {
    if (store) await store.closeDb();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  const modifyLegacy = (sql: string) => {
    const db = new Database(filename);
    try { db.exec(sql); } finally { db.close(); }
  };
  const assertRolledBack = async () => {
    expect(await store.queryOne('SELECT name FROM migration WHERE name = @name', { name: LOCAL_DATA_IMPORT_MIGRATION })).toBeUndefined();
    expect(await store.queryAll('SELECT * FROM local_override')).toEqual([]);
    expect(await store.queryAll('SELECT * FROM favorite')).toEqual([]);
    expect(await store.queryAll("SELECT * FROM claim WHERE source = 'local'")).toEqual([]);
    expect(await store.queryAll('SELECT * FROM blob')).toEqual([]);
  };

  it('maps identities and changed event/claim IDs while preserving all supported local metadata', async () => {
    const before = await readFile(filename);
    const result = await importPostgresLocalData(filename, { store });
    expect(result).toMatchObject({ alreadyApplied: false, dryRun: false, imported: { local_override: 6, claim: 2, favorite: 1, discovery_dismissed: 1, media: 1, unusual_death_flag: 1 } });
    expect(await readFile(filename)).toEqual(before);
    const birth = await store.queryOne<{ id: string }>("SELECT id::text FROM vital_event WHERE person_id = 'new-person' AND event_type = 'birth'");
    expect(birth?.id).not.toBe('41');
    expect(await store.queryAll('SELECT entity_type, entity_id, field_name, override_value FROM local_override')).toEqual(expect.arrayContaining([
      { entity_type: 'person', entity_id: 'new-person', field_name: 'display_name', override_value: 'Research name' },
      { entity_type: 'vital_event', entity_id: birth?.id, field_name: 'place', override_value: 'Corrected place' },
      { entity_type: 'claim', entity_id: 'new-provider', field_name: 'value_text', override_value: 'Writer' },
      { entity_type: 'claim', entity_id: 'old-missing-provider', field_name: 'value_text', override_value: 'Corrected alias' },
      { entity_type: 'person', entity_id: 'new-person', field_name: 'photo_face', override_value: '{"x":0.2,"y":0.3}' },
      { entity_type: 'person', entity_id: 'same-id', field_name: 'bio', override_value: 'Local biography' },
    ]));
    expect(await store.queryOne("SELECT person_id, source FROM claim WHERE claim_id = 'old-missing-provider'")).toEqual({ person_id: 'new-person', source: 'local' });
    expect(await store.queryOne('SELECT db_id, person_id, tags, added_at FROM favorite')).toEqual({ db_id: 'new-db', person_id: 'new-person', tags: ['artist'], added_at: new Date('2000-01-01T12:00:00Z') });
    expect(await store.queryOne('SELECT db_id, person_id, ai_tags FROM discovery_dismissed')).toEqual({ db_id: 'new-db', person_id: 'new-other', ai_tags: ['reviewed'] });
    expect(await store.queryOne('SELECT person_id, is_primary FROM media')).toEqual({ person_id: 'new-person', is_primary: true });
    expect(await store.queryOne('SELECT mime_type, size_bytes FROM blob')).toEqual({ mime_type: 'image/jpeg', size_bytes: '9' });
    expect(await store.queryOne('SELECT person_id, text FROM description')).toEqual({ person_id: 'new-person', text: 'Research description' });
    expect(await store.queryOne('SELECT person_id, account_id FROM provider_mapping')).toEqual({ person_id: 'new-person', account_id: 'provider-account' });
    expect(await store.queryOne('SELECT child_id, parent_id FROM parent_edge')).toEqual({ child_id: 'new-person', parent_id: 'new-other' });
    expect(await store.queryOne('SELECT person1_id, person2_id FROM spouse_edge')).toEqual({ person1_id: 'new-other', person2_id: 'new-root' });
    expect(await store.queryOne("SELECT is_unusual_death FROM person WHERE person_id = 'new-root'")).toEqual({ is_unusual_death: true });
    expect(await store.queryOne('SELECT keyword FROM unusual_death_keyword')).toEqual({ keyword: 'fixture asteroid' });
    expect(await store.queryOne('SELECT lat, lng FROM place_geocode')).toEqual({ lat: 1.25, lng: 2.5 });
  });

  it('keeps PostgreSQL conflicts and the existing primary photo', async () => {
    await store.run(`INSERT INTO local_override(override_id, entity_type, entity_id, field_name, override_value)
      VALUES ('new-override', 'person', 'new-person', 'display_name', 'Newer name');
      INSERT INTO favorite(db_id, person_id, why_interesting, tags) VALUES ('new-db', 'new-person', 'Newer favorite', '["new"]');
      INSERT INTO claim(claim_id, person_id, predicate, value_text, source) VALUES ('old-local', 'new-person', 'occupation', 'Newer claim', 'local');
      INSERT INTO media(media_id, person_id, source, is_primary) VALUES ('new-media', 'new-person', 'local', TRUE);
      INSERT INTO place_geocode(place_text, lat, lng, geocode_status) VALUES ('Fixture place', 8, 9, 'resolved');`);
    const result = await importPostgresLocalData(filename, { store });
    expect(result.preserved).toMatchObject({ favorite: 1, local_override: 1, claim: 2, place_geocode: 1 });
    expect(await store.queryOne("SELECT override_value FROM local_override WHERE override_id = 'new-override'")).toEqual({ override_value: 'Newer name' });
    expect(await store.queryOne('SELECT why_interesting, tags FROM favorite')).toEqual({ why_interesting: 'Newer favorite', tags: ['new'] });
    expect(await store.queryOne("SELECT value_text FROM claim WHERE claim_id = 'old-local'")).toEqual({ value_text: 'Newer claim' });
    expect(await store.queryAll('SELECT media_id FROM media WHERE is_primary = TRUE')).toEqual([{ media_id: 'new-media' }]);
    expect(await store.queryOne('SELECT lat, lng FROM place_geocode')).toEqual({ lat: 8, lng: 9 });
  });

  it('keeps natural-key media metadata and primary selection when legacy media IDs differ', async () => {
    await store.run(`INSERT INTO blob(blob_hash, path, mime_type) VALUES ('${hash}', 'blobs/aa/${hash}.png', 'image/png');
      INSERT INTO media(media_id, person_id, blob_hash, source, is_primary, caption)
      VALUES ('same-natural-media', 'new-person', '${hash}', 'local', FALSE, 'Newer caption');
      INSERT INTO media(media_id, person_id, source, is_primary) VALUES ('new-primary', 'new-person', 'familysearch', TRUE);`);
    const result = await importPostgresLocalData(filename, { store });
    expect(result.preserved).toMatchObject({ blob: 1, media: 1 });
    expect(await store.queryAll('SELECT media_id, caption, is_primary FROM media ORDER BY media_id')).toEqual([
      { media_id: 'new-primary', caption: null, is_primary: true },
      { media_id: 'same-natural-media', caption: 'Newer caption', is_primary: false },
    ]);
    expect(await store.queryOne('SELECT mime_type FROM blob')).toEqual({ mime_type: 'image/png' });
  });

  it('preserves the chosen legacy primary when duplicate natural-key media already exist', async () => {
    modifyLegacy(`UPDATE media SET is_primary = 0 WHERE media_id = 'old-media';
      INSERT INTO media(media_id, person_id, blob_hash, source, is_primary, caption)
      VALUES ('legacy-primary', 'old-person', '${hash}', 'local', 1, 'Chosen portrait');`);
    await importPostgresLocalData(filename, { store });
    expect(await store.queryAll('SELECT media_id, caption, is_primary FROM media')).toEqual([
      { media_id: 'legacy-primary', caption: 'Chosen portrait', is_primary: true },
    ]);
  });

  it('does not replay completed imports or resurrect subsequently deleted user rows', async () => {
    await importPostgresLocalData(filename, { store });
    await store.run('DELETE FROM favorite; DELETE FROM local_override');
    expect(await importPostgresLocalData(filename, { store })).toEqual({ alreadyApplied: true, dryRun: false, imported: {}, preserved: {} });
    expect(await store.queryAll('SELECT * FROM favorite')).toEqual([]);
    expect(await store.queryAll('SELECT * FROM local_override')).toEqual([]);
  });

  it('dry runs validate the full import and roll back every target row', async () => {
    const before = await readFile(filename);
    expect(await importPostgresLocalData(filename, { store, dryRun: true })).toMatchObject({ dryRun: true, imported: { local_override: 6, blob: 1, unusual_death_flag: 1 } });
    await assertRolledBack();
    expect(await readFile(filename)).toEqual(before);
    expect(await store.queryOne("SELECT is_unusual_death FROM person WHERE person_id = 'new-root'")).toEqual({ is_unusual_death: false });
  });

  it('aborts all writes when any local edit has an unmapped person', async () => {
    modifyLegacy(`INSERT INTO person(person_id, display_name) VALUES ('unmapped', 'Unmapped');
      INSERT INTO local_override(override_id, entity_type, entity_id, field_name, override_value) VALUES ('bad', 'person', 'unmapped', 'bio', 'Keep me');`);
    await expect(importPostgresLocalData(filename, { store })).rejects.toThrow('unmapped or ambiguous person');
    await assertRolledBack();
  });

  it('aborts when provider identities disagree about the target person', async () => {
    modifyLegacy("INSERT INTO external_identity(person_id, source, external_id) VALUES ('old-person', 'ancestry', 'conflicting')");
    await store.run("INSERT INTO external_identity(person_id, source, external_id) VALUES ('new-other', 'ancestry', 'conflicting')");
    await expect(importPostgresLocalData(filename, { store })).rejects.toThrow('unmapped or ambiguous person');
    await assertRolledBack();
  });

  it('aborts rather than dropping unsupported override entities or unmapped databases', async () => {
    modifyLegacy("INSERT INTO local_override(override_id, entity_type, entity_id, field_name) VALUES ('bad', 'relationship', 'missing', 'role')");
    await expect(importPostgresLocalData(filename, { store })).rejects.toThrow('unsupported or missing source entity');
    await assertRolledBack();
    modifyLegacy("DELETE FROM local_override WHERE override_id = 'bad'; UPDATE favorite SET db_id = 'missing-db'");
    await expect(importPostgresLocalData(filename, { store })).rejects.toThrow('unmapped database root');
    await assertRolledBack();
  });

  it('rejects multiple source claims or vital events collapsing onto one target entity', async () => {
    modifyLegacy(`INSERT INTO claim(claim_id, person_id, predicate, value_text, source)
      VALUES ('duplicate-provider', 'old-person', 'occupation', 'Painter', 'familysearch');
      INSERT INTO local_override(override_id, entity_type, entity_id, field_name, override_value)
      VALUES ('duplicate-edit', 'claim', 'duplicate-provider', 'value_text', 'Different edit');`);
    await expect(importPostgresLocalData(filename, { store })).rejects.toThrow('Multiple SQLite claims');
    await assertRolledBack();
    modifyLegacy(`DELETE FROM local_override WHERE override_id = 'duplicate-edit';
      UPDATE vital_event SET source = 'other-provider' WHERE id = 41;
      INSERT INTO vital_event(id, person_id, event_type, source) VALUES (99, 'old-person', 'birth', 'local');`);
    await expect(importPostgresLocalData(filename, { store })).rejects.toThrow('Multiple SQLite vital events');
    await assertRolledBack();
  });

  it('rejects databases that would collapse distinct favorites into one target row', async () => {
    modifyLegacy(`INSERT INTO database_info(db_id, root_id, source_provider) VALUES ('second-old-db', 'old-root', 'familysearch');
      INSERT INTO favorite(db_id, person_id, why_interesting) VALUES ('second-old-db', 'old-person', 'Different favorite');`);
    await expect(importPostgresLocalData(filename, { store })).rejects.toThrow('Multiple SQLite databases');
    await assertRolledBack();
  });

  it('rejects a legacy true manual flag when a changed PostgreSQL row may contain a newer clear', async () => {
    await store.run("UPDATE person SET display_name = 'Changed after creation' WHERE person_id = 'new-root'");
    await expect(importPostgresLocalData(filename, { store })).rejects.toThrow('manual unusual-death flag conflicts');
    await assertRolledBack();
    expect(await store.queryOne("SELECT is_unusual_death FROM person WHERE person_id = 'new-root'")).toEqual({ is_unusual_death: false });
  });
});
