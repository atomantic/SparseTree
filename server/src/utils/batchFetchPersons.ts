/**
 * Batch fetch person data (name + lifespan) for a list of canonical IDs.
 * Handles large ID lists by chunking to avoid SQLite's variable limit (~999).
 */

import { sqliteService } from '../db/sqlite.service.js';
import { buildLifespan } from './lifespan.js';

const CHUNK_SIZE = 500;

export function batchFetchPersons(personIds: string[]): Map<string, { name: string; lifespan: string }> {
  if (personIds.length === 0) return new Map();

  const result = new Map<string, { name: string; lifespan: string }>();

  for (let i = 0; i < personIds.length; i += CHUNK_SIZE) {
    const chunk = personIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map((_, j) => `@id${j}`).join(',');
    const params: Record<string, string> = {};
    chunk.forEach((id, j) => { params[`id${j}`] = id; });

    const rows = sqliteService.queryAll<{
      person_id: string;
      display_name: string;
      birth_year: number | null;
      death_year: number | null;
    }>(
      `SELECT p.person_id, p.display_name,
        (SELECT date_year FROM vital_event WHERE person_id = p.person_id AND event_type = 'birth') as birth_year,
        (SELECT date_year FROM vital_event WHERE person_id = p.person_id AND event_type = 'death') as death_year
       FROM person p
       WHERE p.person_id IN (${placeholders})`,
      params
    );

    for (const row of rows) {
      const lifespan = buildLifespan(row.birth_year, row.death_year);
      result.set(row.person_id, { name: row.display_name, lifespan });
    }
  }

  return result;
}
