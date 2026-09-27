/** Fetch display metadata in one PostgreSQL array query, retaining the caller's ID map. */
import { postgresService } from '../db/postgres.service.js';
import { buildLifespan } from './lifespan.js';

export async function batchFetchPersons(personIds: string[]): Promise<Map<string, { name: string; lifespan: string }>> {
  if (personIds.length === 0) return new Map();
  const rows = await postgresService.queryAll<{
    person_id: string;
    display_name: string;
    birth_year: number | null;
    death_year: number | null;
  }>(
    `SELECT p.person_id, p.display_name,
      (SELECT date_year FROM vital_event WHERE person_id = p.person_id AND event_type = 'birth' ORDER BY id LIMIT 1) AS birth_year,
      (SELECT date_year FROM vital_event WHERE person_id = p.person_id AND event_type = 'death' ORDER BY id LIMIT 1) AS death_year
     FROM person p WHERE p.person_id = ANY(@personIds::text[])`, { personIds },
  );
  return new Map(rows.map(row => [row.person_id, {
    name: row.display_name, lifespan: buildLifespan(row.birth_year, row.death_year),
  }]));
}
