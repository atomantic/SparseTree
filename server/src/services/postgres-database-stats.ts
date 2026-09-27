import type { PostgresStore } from './postgres-database.js';
import type { TreeStats } from './database-stats.js';

export async function getPostgresTreeStats(store: PostgresStore, dbId: string): Promise<TreeStats> {
  // Total persons
  const totalResult = await store.queryOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM database_membership WHERE db_id = @dbId',
    { dbId }
  );
  const totalPersons = totalResult?.count ?? 0;

  // Gender breakdown
  const genderRows = await store.queryAll<{ gender: string | null; count: number }>(
    `SELECT p.gender, COUNT(*)::int as count
     FROM database_membership dm
     JOIN person p ON dm.person_id = p.person_id
     WHERE dm.db_id = @dbId
     GROUP BY p.gender`,
    { dbId }
  );
  const gender = { male: 0, female: 0, unknown: 0 };
  for (const row of genderRows) {
    const key = row.gender === 'male' ? 'male' : row.gender === 'female' ? 'female' : 'unknown';
    gender[key] = row.count;
  }

  // Completeness: birth date
  const birthDateResult = await store.queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT ve.person_id)::int as count
     FROM vital_event ve
     JOIN database_membership dm ON ve.person_id = dm.person_id AND dm.db_id = @dbId
     WHERE ve.event_type = 'birth' AND ve.date_original IS NOT NULL`,
    { dbId }
  );

  // Completeness: birth place
  const birthPlaceResult = await store.queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT ve.person_id)::int as count
     FROM vital_event ve
     JOIN database_membership dm ON ve.person_id = dm.person_id AND dm.db_id = @dbId
     WHERE ve.event_type = 'birth' AND ve.place IS NOT NULL`,
    { dbId }
  );

  // Completeness: death date (only for non-living)
  const deathDateResult = await store.queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT ve.person_id)::int as count
     FROM vital_event ve
     JOIN database_membership dm ON ve.person_id = dm.person_id AND dm.db_id = @dbId
     JOIN person p ON ve.person_id = p.person_id AND p.living = FALSE
     WHERE ve.event_type = 'death' AND ve.date_original IS NOT NULL`,
    { dbId }
  );

  // Completeness: death place (only for non-living)
  const deathPlaceResult = await store.queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT ve.person_id)::int as count
     FROM vital_event ve
     JOIN database_membership dm ON ve.person_id = dm.person_id AND dm.db_id = @dbId
     JOIN person p ON ve.person_id = p.person_id AND p.living = FALSE
     WHERE ve.event_type = 'death' AND ve.place IS NOT NULL`,
    { dbId }
  );

  // Completeness: has photo
  const photoResult = await store.queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT m.person_id)::int as count
     FROM media m
     JOIN database_membership dm ON m.person_id = dm.person_id AND dm.db_id = @dbId`,
    { dbId }
  );

  // Provider coverage
  const providerRows = await store.queryAll<{ source: string; count: number }>(
    `SELECT ei.source, COUNT(DISTINCT ei.person_id)::int as count
     FROM external_identity ei
     JOIN database_membership dm ON ei.person_id = dm.person_id AND dm.db_id = @dbId
     GROUP BY ei.source
     ORDER BY count DESC`,
    { dbId }
  );
  const providers: Record<string, number> = {};
  for (const row of providerRows) {
    providers[row.source] = row.count;
  }

  // Favorites count
  const favResult = await store.queryOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM favorite WHERE db_id = @dbId',
    { dbId }
  );

  // Generation distribution (from database_membership)
  const generationRows = await store.queryAll<{ generation: number; count: number }>(
    `SELECT generation, COUNT(*)::int as count
     FROM database_membership
     WHERE db_id = @dbId AND generation IS NOT NULL
     GROUP BY generation
     ORDER BY generation`,
    { dbId }
  );

  // Century distribution (from birth year)
  const centuryRows = await store.queryAll<{ century: number; count: number }>(
    `SELECT CAST((ve.date_year / 100) AS INTEGER) as century, COUNT(DISTINCT ve.person_id)::int as count
     FROM vital_event ve
     JOIN database_membership dm ON ve.person_id = dm.person_id AND dm.db_id = @dbId
     WHERE ve.event_type = 'birth' AND ve.date_year IS NOT NULL
     GROUP BY century
     ORDER BY century`,
    { dbId }
  );

  // Surname distribution (extract last word of display_name, top 30)
  const surnameRows = await store.queryAll<{ surname: string; count: number }>(
    `SELECT
       TRIM(SUBSTR(p.display_name, STRPOS(p.display_name, ' ') + 1)) as surname,
       COUNT(*)::int as count
     FROM database_membership dm
     JOIN person p ON dm.person_id = p.person_id
     WHERE dm.db_id = @dbId
       AND p.display_name IS NOT NULL
       AND STRPOS(p.display_name, ' ') > 0
     GROUP BY surname
     HAVING TRIM(SUBSTR(p.display_name, STRPOS(p.display_name, ' ') + 1)) != '' AND COUNT(*) > 1
     ORDER BY count DESC
     LIMIT 30`,
    { dbId }
  );

  // Lifespan statistics — average age at death
  // Join birth and death vital_events for the same person, compute age
  const lifespanOverall = await store.queryOne<{ avgAge: number; count: number }>(
    `SELECT ROUND(AVG(d.date_year - b.date_year), 1)::float8 as "avgAge", COUNT(*)::int as count
     FROM vital_event b
     JOIN vital_event d ON b.person_id = d.person_id
     JOIN database_membership dm ON b.person_id = dm.person_id AND dm.db_id = @dbId
     WHERE b.event_type = 'birth' AND b.date_year IS NOT NULL
       AND d.event_type = 'death' AND d.date_year IS NOT NULL
       AND (d.date_year - b.date_year) BETWEEN 0 AND 120`,
    { dbId }
  );

  const lifespanByGender = await store.queryAll<{ gender: string; avgAge: number; count: number }>(
    `SELECT COALESCE(p.gender, 'unknown') as gender,
            ROUND(AVG(d.date_year - b.date_year), 1)::float8 as "avgAge",
            COUNT(*)::int as count
     FROM vital_event b
     JOIN vital_event d ON b.person_id = d.person_id
     JOIN database_membership dm ON b.person_id = dm.person_id AND dm.db_id = @dbId
     JOIN person p ON b.person_id = p.person_id
     WHERE b.event_type = 'birth' AND b.date_year IS NOT NULL
       AND d.event_type = 'death' AND d.date_year IS NOT NULL
       AND (d.date_year - b.date_year) BETWEEN 0 AND 120
     GROUP BY p.gender
     ORDER BY p.gender`,
    { dbId }
  );

  // Top birth places (full place string, top 30)
  const birthPlaceRows = await store.queryAll<{ place: string; count: number }>(
    `SELECT ve.place, COUNT(DISTINCT ve.person_id)::int as count
     FROM vital_event ve
     JOIN database_membership dm ON ve.person_id = dm.person_id AND dm.db_id = @dbId
     WHERE ve.event_type = 'birth' AND ve.place IS NOT NULL AND ve.place != ''
     GROUP BY ve.place
     ORDER BY count DESC
     LIMIT 30`,
    { dbId }
  );

  // Top birth countries — extract last comma-separated segment in JS for reliability
  const allBirthPlaces = await store.queryAll<{ place: string }>(
    `SELECT ve.place
     FROM vital_event ve
     JOIN database_membership dm ON ve.person_id = dm.person_id AND dm.db_id = @dbId
     WHERE ve.event_type = 'birth' AND ve.place IS NOT NULL AND ve.place != ''`,
    { dbId }
  );
  const countryCounts = new Map<string, number>();
  for (const { place } of allBirthPlaces) {
    const parts = place.split(',');
    const country = parts[parts.length - 1].trim();
    if (country) {
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    }
  }
  const birthCountryRows = [...countryCounts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Top occupations from claims table
  const occupationRows = await store.queryAll<{ occupation: string; count: number }>(
    `SELECT c.value_text as occupation, COUNT(DISTINCT c.person_id)::int as count
     FROM claim c
     JOIN database_membership dm ON c.person_id = dm.person_id AND dm.db_id = @dbId
     WHERE c.predicate = 'occupation' AND c.value_text IS NOT NULL AND c.value_text != ''
     GROUP BY c.value_text
     ORDER BY count DESC
     LIMIT 30`,
    { dbId }
  );

  const lifespanByCentury = await store.queryAll<{ century: number; avgAge: number; count: number }>(
    `SELECT CAST((b.date_year / 100) AS INTEGER) as century,
            ROUND(AVG(d.date_year - b.date_year), 1)::float8 as "avgAge",
            COUNT(*)::int as count
     FROM vital_event b
     JOIN vital_event d ON b.person_id = d.person_id
     JOIN database_membership dm ON b.person_id = dm.person_id AND dm.db_id = @dbId
     WHERE b.event_type = 'birth' AND b.date_year IS NOT NULL
       AND d.event_type = 'death' AND d.date_year IS NOT NULL
       AND (d.date_year - b.date_year) BETWEEN 0 AND 120
     GROUP BY century
     ORDER BY century`,
    { dbId }
  );

  return {
    totalPersons,
    gender,
    completeness: {
      hasBirthDate: birthDateResult?.count ?? 0,
      hasBirthPlace: birthPlaceResult?.count ?? 0,
      hasDeathDate: deathDateResult?.count ?? 0,
      hasDeathPlace: deathPlaceResult?.count ?? 0,
      hasPhoto: photoResult?.count ?? 0,
    },
    providers,
    favorites: favResult?.count ?? 0,
    generations: generationRows.map(r => ({ generation: r.generation, count: r.count })),
    centuries: centuryRows.map(r => ({ century: r.century, count: r.count })),
    surnames: surnameRows.map(r => ({ surname: r.surname, count: r.count })),
    lifespans: {
      overall: lifespanOverall?.count ? { avgAge: lifespanOverall.avgAge, count: lifespanOverall.count } : null,
      byGender: lifespanByGender.map(r => ({ gender: r.gender, avgAge: r.avgAge, count: r.count })),
      byCentury: lifespanByCentury.map(r => ({ century: r.century, avgAge: r.avgAge, count: r.count })),
    },
    birthPlaces: birthPlaceRows.map(r => ({ place: r.place, count: r.count })),
    birthCountries: birthCountryRows.map(r => ({ country: r.country, count: r.count })),
    occupations: occupationRows.map(r => ({ occupation: r.occupation, count: r.count })),
  };
}
