import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPostgresService } from '../../../server/src/db/postgres.service.js';
import { createPostgresWriter } from '../../../server/src/lib/postgres-writer.js';
import { createLocalOverrideService } from '../../../server/src/services/local-override.service.js';
import { createDeathsService } from '../../../server/src/services/deaths.service.js';
import { createPostgresDatabase } from '../../../server/src/services/postgres-database.js';

vi.mock('../../../server/src/services/database.service.js', () => ({ databaseService: { isPostgresEnabled: async () => false } }));
import { createAugmentationService } from '../../../server/src/services/augmentation.service.js';

const connectionString = process.env.SPARSETREE_TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;
const PERSON = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const EXTERNAL = 'ROOT-153';
const graph = (extra = {}) => ({ [EXTERNAL]: {
  name: 'Provider Name', gender: 'unknown' as const, living: false,
  parents: [], children: [], birth: { date: '1900', place: 'York' },
  occupation: 'Cartographer', causeOfDeath: 'drowned', ...extra,
} });

describePostgres('PostgreSQL local edits and enrichment', () => {
  const schema = `sparsetree_local_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let store: ReturnType<typeof createPostgresService>;
  let overrides: ReturnType<typeof createLocalOverrideService>;
  let deaths: ReturnType<typeof createDeathsService>;
  let writer: ReturnType<typeof createPostgresWriter>;
  let directory: string;
  let augmentation: ReturnType<typeof createAugmentationService>;

  beforeAll(async () => {
    admin = new Pool({ connectionString });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    store = createPostgresService({ pool: new Pool({ connectionString, options: `-c search_path=${schema}` }) });
    await store.initDb();
    overrides = createLocalOverrideService(store);
    deaths = createDeathsService(store);
    writer = createPostgresWriter(store);
    directory = await mkdtemp(path.join(os.tmpdir(), 'sparsetree-local-'));
    augmentation = createAugmentationService(store, directory, async () => true);
  });
  beforeEach(async () => {
    await store.run('TRUNCATE person, local_override, database_info CASCADE');
    await writer.rebuildDatabase({ rootExternalId: EXTERNAL, database: graph(), canonicalIds: { [EXTERNAL]: PERSON } });
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    if (store) await store.closeDb();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('keeps one override identity under concurrent updates and preserves null/empty values', async () => {
    const first = await overrides.setOverride('person', PERSON, 'name', 'Edited', 'Provider Name', { reason: 'Family record' });
    const updated = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      overrides.setOverride('person', PERSON, 'name', String(i), 'must not replace original')));
    expect(new Set(updated.map(row => row.overrideId))).toEqual(new Set([first.overrideId]));
    const cleared = await overrides.setOverride('person', PERSON, 'name', '', null);
    expect(cleared).toMatchObject({ originalValue: 'Provider Name', overrideValue: '', reason: 'Family record' });
    expect(cleared.createdAt).toBe(first.createdAt);
    expect(typeof cleared.updatedAt).toBe('string');
    expect(await overrides.countOverrides()).toBe(1);
    expect((await createPostgresDatabase(store).getPerson(PERSON, PERSON))?.name).toBe('');
    await overrides.setOverride('person', PERSON, 'bio', null, 'Before');
    expect(await overrides.getEffectiveValue('person', PERSON, 'bio', 'Provider')).toMatchObject({ value: null, isOverridden: true });
    expect(await overrides.removeOverride('person', PERSON, 'bio')).toBe(true);
    expect(await overrides.removeOverride('person', PERSON, 'bio')).toBe(false);
  });

  it('creates a missing event once and returns numeric IDs under concurrent requests', async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, () => overrides.ensureVitalEvent(PERSON, 'burial')));
    expect(new Set(ids).size).toBe(1);
    expect(typeof ids[0]).toBe('number');
    await overrides.setOverride('vital_event', String(ids[0]), 'place', '', null);
    const all = await overrides.getAllOverridesForPerson(PERSON);
    expect(all.eventOverrides).toHaveLength(1);
    expect(all.eventOverrides[0].overrideValue).toBe('');
  });

  it('preserves overridden claim and event IDs when provider data changes or disappears', async () => {
    const claim = (await overrides.getClaimsForPerson(PERSON, 'occupation'))[0];
    const event = await overrides.getVitalEventId(PERSON, 'birth');
    await overrides.setOverride('person', PERSON, 'name', 'Local Name', 'Provider Name');
    await overrides.setOverride('claim', claim.claimId, 'value_text', 'Local Job', claim.value);
    await overrides.setOverride('vital_event', String(event), 'birth_date', '1901', '1900');
    await writer.rebuildDatabase({ rootExternalId: EXTERNAL, database: graph({ name: 'New Provider', occupation: 'Surveyor', birth: undefined }) });
    const claims = await overrides.getClaimsForPerson(PERSON, 'occupation');
    expect(claims).toEqual([expect.objectContaining({ claimId: claim.claimId, value: 'Local Job', originalValue: 'Surveyor' })]);
    const person = await createPostgresDatabase(store).getPerson(PERSON, PERSON);
    expect(person).toMatchObject({ name: 'Local Name', occupation: 'Local Job', birth: { date: '1901' } });
    expect(await overrides.getVitalEventId(PERSON, 'birth')).toBe(event);
    await writer.rebuildDatabase({ rootExternalId: EXTERNAL, database: graph({ occupation: undefined }) });
    expect((await overrides.getClaimsForPerson(PERSON, 'occupation'))[0]).toMatchObject({ value: 'Local Job', claimId: claim.claimId });
  });

  it('treats a null claim override as a cleared value and rolls back a failed delete', async () => {
    const { claimId } = await overrides.addClaim(PERSON, 'protected', 'Original');
    await overrides.setOverride('claim', claimId, 'value_text', null, 'Original');
    expect((await overrides.getClaimsForPerson(PERSON, 'protected'))[0].value).toBeNull();
    await store.run(`CREATE FUNCTION reject_local_claim_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN IF OLD.predicate = 'protected' THEN RAISE EXCEPTION 'deliberate test rejection'; END IF; RETURN OLD; END; $$;
      CREATE TRIGGER reject_local_claim_delete BEFORE DELETE ON claim FOR EACH ROW EXECUTE FUNCTION reject_local_claim_delete()`);
    await expect(overrides.deleteClaim(claimId)).rejects.toThrow('deliberate test rejection');
    expect(await overrides.hasOverride('claim', claimId, 'value_text')).toBe(true);
    expect(await overrides.getClaim(claimId)).not.toBeNull();
    await store.run('DROP TRIGGER reject_local_claim_delete ON claim; DROP FUNCTION reject_local_claim_delete()');
    expect(await overrides.deleteClaim(claimId)).toBe(true);
    expect(await overrides.hasOverride('claim', claimId, 'value_text')).toBe(false);
  });

  it('persists death updates atomically with native booleans and no duplicate claims', async () => {
    await Promise.all(Array.from({ length: 8 }, () => deaths.setDeathInfo(PERSON, { circumstance: 'Shipwreck', isUnusualManual: true })));
    expect(await overrides.getClaimsForPerson(PERSON, 'deathCircumstance')).toHaveLength(1);
    const info = await deaths.getDeathInfo(PERSON);
    expect(info).toMatchObject({ cause: 'drowned', circumstance: 'Shipwreck', isUnusualManual: true, isUnusual: true });
    expect(await deaths.listDeaths({ q: 'Provider', unusualOnly: true })).toMatchObject({ total: 1 });
    await store.run(`CREATE FUNCTION reject_death_flag() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN IF NOT NEW.is_unusual_death THEN RAISE EXCEPTION 'deliberate flag rejection'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER reject_death_flag BEFORE UPDATE ON person FOR EACH ROW EXECUTE FUNCTION reject_death_flag()`);
    await expect(deaths.setDeathInfo(PERSON, { cause: 'New cause', isUnusualManual: false })).rejects.toThrow('deliberate flag rejection');
    expect((await deaths.getDeathInfo(PERSON)).cause).toBe('drowned');
    await store.run('DROP TRIGGER reject_death_flag ON person; DROP FUNCTION reject_death_flag()');
    await deaths.setDeathInfo(PERSON, { cause: null, circumstance: '', isUnusualManual: false });
    expect(await deaths.getDeathInfo(PERSON)).toMatchObject({ cause: null, circumstance: null, isUnusualManual: false, isUnusual: false });
  });

  it('invalidates the keyword cache after an insert/delete and keeps uniqueness', async () => {
    await deaths.listKeywords();
    await Promise.all([deaths.addKeyword(' Meteor '), deaths.addKeyword('meteor')]);
    expect((await deaths.listKeywords()).filter(value => value === 'meteor')).toEqual(['meteor']);
    await deaths.setDeathInfo(PERSON, { cause: 'meteor' });
    expect((await deaths.getDeathInfo(PERSON)).matchedKeywords).toContain('meteor');
    expect(await deaths.removeKeyword('METEOR')).toBe(true);
    expect(await deaths.removeKeyword('meteor')).toBe(false);
    expect((await deaths.getDeathInfo(PERSON)).matchedKeywords).not.toContain('meteor');
  });

  it('imports legacy augmentation JSON once and uses native JSONB for canonical aliases', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${EXTERNAL}.json`), JSON.stringify({
      id: EXTERNAL, wikipediaUrl: 'https://en.wikipedia.org/wiki/Test', wikipediaDescription: '', updatedAt: '2020-01-01T00:00:00.000Z',
    }));
    const data = await augmentation.getAugmentation(PERSON);
    expect(data).toMatchObject({ id: EXTERNAL, platforms: [{ platform: 'wikipedia' }], photos: [], descriptions: [] });
    expect((await store.queryOne<{ kind: string }>('SELECT jsonb_typeof(data) AS kind FROM person_augmentation'))?.kind).toBe('object');
    await augmentation.addDescription(PERSON, '', 'local');
    expect(await augmentation.getAugmentation(EXTERNAL)).toMatchObject({ descriptions: [{ text: '', source: 'local', language: 'en' }] });
    expect(JSON.parse(await readFile(path.join(directory, `${EXTERNAL}.json`), 'utf8')).descriptions[0].text).toBe('');
  });

  it('serializes concurrent augmentation mutations and keeps state across JSON rebuilds', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => augmentation.addPlatform(
      i % 2 ? EXTERNAL : PERSON, 'wikipedia', `https://en.wikipedia.org/wiki/Test${i}`, undefined, { registerIdentity: false })));
    await Promise.all([
      augmentation.addPhoto(PERSON, 'https://example.test/portrait.jpg', 'wikipedia', true),
      augmentation.addDescription(EXTERNAL, 'Biography', 'local'),
      augmentation.addPlatform(PERSON, 'wikitree', 'https://www.wikitree.com/wiki/Test-1', undefined, { registerIdentity: false }),
    ]);
    const before = await augmentation.getAugmentation(PERSON);
    expect(before?.platforms).toHaveLength(2);
    expect(before?.photos).toEqual([expect.objectContaining({ source: 'wikipedia', isPrimary: true })]);
    expect(before?.descriptions).toEqual([expect.objectContaining({ text: 'Biography' })]);
    await writer.rebuildDatabase({ rootExternalId: EXTERNAL, database: graph() });
    expect(await augmentation.getAugmentation(PERSON)).toEqual(before);
    await store.run('DELETE FROM database_info WHERE root_id = @id', { id: PERSON });
    await store.run('DELETE FROM person WHERE person_id = @id', { id: PERSON });
    expect(await store.queryAll('SELECT * FROM person_augmentation')).toEqual([]);
  });
});
