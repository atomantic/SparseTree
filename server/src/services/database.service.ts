import fs from 'fs';
import path from 'path';
import type { Database, DatabaseInfo } from '@fsf/shared';

// Data directory is at root of project, not in server/
const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
// Sample databases included in the repo
const SAMPLES_DIR = path.resolve(import.meta.dirname, '../../../samples');

// Helper to parse database info from a file
function parseDatabaseInfo(filePath: string, filename: string, isSample = false): DatabaseInfo {
  const match = filename.match(/^db-([^.]+)\.json$/);
  const id = match ? match[1] : filename;

  const content = fs.readFileSync(filePath, 'utf-8');
  const db: Database = JSON.parse(content);
  const personCount = Object.keys(db).length;

  // Extract root ID and max generations from filename
  const parts = id.split('-');
  let rootId = id;
  let maxGenerations: number | undefined;

  if (parts.length > 2 && /^\d+$/.test(parts[parts.length - 1])) {
    const possibleRootId = parts.slice(0, -1).join('-');
    if (db[possibleRootId]) {
      rootId = possibleRootId;
      maxGenerations = parseInt(parts[parts.length - 1]);
    }
  }

  const rootName = db[rootId]?.name;

  return { id, filename, personCount, rootId, rootName, maxGenerations, isSample };
}

// Find database file path, checking both data and samples directories
function findDatabasePath(id: string): string | null {
  const filename = `db-${id}.json`;
  const dataPath = path.join(DATA_DIR, filename);
  const samplePath = path.join(SAMPLES_DIR, filename);

  if (fs.existsSync(dataPath)) return dataPath;
  if (fs.existsSync(samplePath)) return samplePath;
  return null;
}

export const databaseService = {
  async listDatabases(): Promise<DatabaseInfo[]> {
    const results: DatabaseInfo[] = [];
    const seenIds = new Set<string>();

    // Load from data directory (user databases)
    if (fs.existsSync(DATA_DIR)) {
      const files = fs.readdirSync(DATA_DIR);
      const dbFiles = files.filter(f => f.startsWith('db-') && f.endsWith('.json'));

      for (const filename of dbFiles) {
        const filePath = path.join(DATA_DIR, filename);
        const info = parseDatabaseInfo(filePath, filename, false);
        results.push(info);
        seenIds.add(info.id);
      }
    }

    // Load from samples directory (bundled sample databases)
    if (fs.existsSync(SAMPLES_DIR)) {
      const files = fs.readdirSync(SAMPLES_DIR);
      const dbFiles = files.filter(f => f.startsWith('db-') && f.endsWith('.json'));

      for (const filename of dbFiles) {
        const filePath = path.join(SAMPLES_DIR, filename);
        const info = parseDatabaseInfo(filePath, filename, true);
        // Don't add if user has their own copy
        if (!seenIds.has(info.id)) {
          results.push(info);
        }
      }
    }

    return results;
  },

  async getDatabaseInfo(id: string): Promise<DatabaseInfo> {
    const filename = `db-${id}.json`;
    const filePath = findDatabasePath(id);

    if (!filePath) {
      throw new Error(`Database ${id} not found`);
    }

    const isSample = filePath.includes(SAMPLES_DIR);
    return parseDatabaseInfo(filePath, filename, isSample);
  },

  async getDatabase(id: string): Promise<Database> {
    const filePath = findDatabasePath(id);

    if (!filePath) {
      throw new Error(`Database ${id} not found`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  },

  async deleteDatabase(id: string): Promise<void> {
    const filename = `db-${id}.json`;
    const dataPath = path.join(DATA_DIR, filename);
    const samplePath = path.join(SAMPLES_DIR, filename);

    // Only allow deleting user databases, not samples
    if (fs.existsSync(samplePath) && !fs.existsSync(dataPath)) {
      throw new Error(`Cannot delete sample database ${id}`);
    }

    if (!fs.existsSync(dataPath)) {
      throw new Error(`Database ${id} not found`);
    }

    fs.unlinkSync(dataPath);
  }
};
