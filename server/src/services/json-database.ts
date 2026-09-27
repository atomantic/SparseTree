import fs from 'node:fs';
import path from 'node:path';
import type { Database, DatabaseInfo, OnThisDayEvent, PersonWithId } from '@fsf/shared';
import { DATA_DIR } from '../utils/paths.js';
import { parseYear } from '../utils/parseYear.js';
import { getJsonTreeStats, matchesAnniversary, sortAnniversaries } from './database-stats.js';

export function createJsonDatabase(
  dataDir = DATA_DIR,
  samplesDir = path.resolve(import.meta.dirname, '../../../samples'),
) {
  const aliases = new Map<string, string>();
  const files = () => [dataDir, samplesDir].flatMap(directory => !fs.existsSync(directory) ? [] :
    fs.readdirSync(directory).filter(name => /^db-[^.]+\.json$/.test(name)).map(name => ({
      filename: name, filePath: path.join(directory, name), isSample: directory === samplesDir,
    })));
  const load = (filePath: string): Database => JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const info = (file: ReturnType<typeof files>[number], db = load(file.filePath)): DatabaseInfo => {
    const id = file.filename.slice(3, -5);
    const parts = id.split('-');
    const possibleRoot = parts.slice(0, -1).join('-');
    const depth = parts.length > 2 && /^\d+$/.test(parts.at(-1)!) && db[possibleRoot] ? Number(parts.at(-1)) : undefined;
    const rootId = depth === undefined ? id : possibleRoot;
    return { id, filename: file.filename, rootId, rootName: db[rootId]?.name,
      maxGenerations: depth, personCount: Object.keys(db).length, isSample: file.isSample };
  };
  const find = (id: string) => {
    const all = files();
    const alias = aliases.get(id) ?? id;
    const exact = all.find(file => file.filename === `db-${alias}.json`);
    if (exact) return exact;
    return all.find(file => {
      const db = load(file.filePath);
      const root = info(file, db).rootId;
      return root === alias || db[root]?.canonicalId === id;
    });
  };
  const getDatabase = async (id: string): Promise<Database> => {
    const file = find(id);
    if (!file) throw new Error(`Database ${id} not found`);
    return load(file.filePath);
  };
  const getDatabaseInfo = async (id: string): Promise<DatabaseInfo> => {
    const file = find(id);
    if (!file) throw new Error(`Database ${id} not found`);
    return info(file);
  };
  const getPerson = async (dbId: string, personId: string): Promise<PersonWithId | null> => {
    const db = await getDatabase(dbId);
    const id = db[personId] ? personId : Object.keys(db).find(key => db[key].canonicalId === personId || key === aliases.get(personId));
    return id ? { ...db[id], id } : null;
  };
  return {
    rememberInfo(value: DatabaseInfo, requestedId = value.id): void {
      if (!value.rootExternalId) return;
      aliases.set(value.id, value.rootExternalId);
      aliases.set(value.rootId, value.rootExternalId);
      aliases.set(requestedId, value.rootExternalId);
    },
    rememberPerson(value: PersonWithId): void {
      if (value.externalId) aliases.set(value.id, value.externalId);
    },
    resolveDbId: async (id: string): Promise<string | null> => id,
    async listDatabases(): Promise<DatabaseInfo[]> {
      const results = new Map<string, DatabaseInfo>();
      for (const file of files()) {
        const value = info(file);
        if (!results.has(value.id)) results.set(value.id, value);
      }
      return [...results.values()];
    },
    getDatabaseInfo,
    getDatabase,
    getPerson,
    async getPersonsBatch(ids: string[]): Promise<PersonWithId[]> {
      if (!ids.length) return [];
      const requested = new Set(ids);
      const found = new Map<string, PersonWithId>();
      for (const file of files()) {
        for (const [id, person] of Object.entries(load(file.filePath))) {
          for (const key of [id, person.canonicalId]) {
            if (key && requested.has(key) && !found.has(key)) found.set(key, { ...person, id: key });
          }
        }
      }
      return ids.flatMap(id => found.has(id) ? [found.get(id)!] : []);
    },
    async listPersons(dbId: string, options?: { page?: number; limit?: number }): Promise<{ persons: PersonWithId[]; total: number }> {
      const db = await getDatabase(dbId);
      const ids = Object.keys(db);
      const limit = options?.limit ?? 100;
      const offset = ((options?.page ?? 1) - 1) * limit;
      return { persons: ids.slice(offset, offset + limit).map(id => ({ ...db[id], id })), total: ids.length };
    },
    async personExists(dbId: string, personId: string): Promise<boolean> {
      return Boolean(await getPerson(dbId, personId));
    },
    async isRoot(personId: string): Promise<boolean> {
      return Boolean(find(personId));
    },
    async getAncestorsLimited(dbId: string, personId: string, depth: number): Promise<Database> {
      const db = await getDatabase(dbId);
      const root = await getPerson(dbId, personId);
      if (!root) return {};
      const result: Database = {};
      const queue = [{ id: root.id, generation: 0 }];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const { id, generation } = queue[cursor];
        if (!db[id] || result[id]) continue;
        result[id] = db[id];
        if (generation < depth) for (const parent of db[id].parents ?? []) if (parent) queue.push({ id: parent, generation: generation + 1 });
      }
      return result;
    },
    assertDeletable(id: string): void {
      const file = find(id);
      if (file?.isSample) throw new Error(`Cannot delete sample database ${id}`);
    },
    async deleteDatabase(id: string): Promise<void> {
      const file = find(id);
      if (file?.isSample) throw new Error(`Cannot delete sample database ${id}`);
      if (file) fs.unlinkSync(file.filePath);
    },
    async getTreeStats(id: string) {
      return getJsonTreeStats(await getDatabase(id), (await getDatabaseInfo(id)).rootId);
    },
    async getOnThisDay(id: string, month: number, day: number): Promise<OnThisDayEvent[]> {
      const db = await getDatabase(id);
      const events: OnThisDayEvent[] = [];
      for (const [personId, person] of Object.entries(db)) {
        for (const eventType of ['birth', 'death'] as const) {
          const event = person[eventType];
          if (!event?.date || !matchesAnniversary(event.date, month, day)) continue;
          events.push({ personId, displayName: person.name, gender: person.gender, eventType,
            dateOriginal: event.date, year: parseYear(event.dateFormal ?? event.date), place: event.place, hasPhoto: false });
        }
      }
      return sortAnniversaries(events);
    },
  };
}
