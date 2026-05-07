/**
 * Deaths service — cause-of-death capture, search, and unusual classification.
 *
 * Data model:
 *  - cause:        claim.predicate = 'causeOfDeath'   (short, e.g. "drowned")
 *  - circumstance: claim.predicate = 'deathCircumstance' (longer narrative)
 *  - manual flag:  person.is_unusual_death = 1
 *  - auto flag:    cause/circumstance/bio matches a keyword in
 *                  unusual_death_keyword
 *  - effective unusual = manual OR auto
 *
 * User edits write through localOverrideService so they survive resyncs from
 * providers (claim row is replaced, override on it persists).
 */

import { sqliteService } from '../db/sqlite.service.js';
import { localOverrideService } from './local-override.service.js';

export interface DeathInfo {
  personId: string;
  cause: string | null;
  circumstance: string | null;
  isUnusualManual: boolean;
  isUnusualAuto: boolean;
  isUnusual: boolean;
  matchedKeywords: string[];
  causeIsLocal: boolean;
  circumstanceIsLocal: boolean;
}

export interface DeathListItem extends DeathInfo {
  displayName: string;
  birthYear: number | null;
  deathYear: number | null;
  deathPlace: string | null;
}

export interface DeathListResult {
  items: DeathListItem[];
  total: number;
  limit: number;
  offset: number;
}

let cachedKeywords: string[] | null = null;

function getKeywords(): string[] {
  if (cachedKeywords) return cachedKeywords;
  const rows = sqliteService.queryAll<{ keyword: string }>(
    'SELECT keyword FROM unusual_death_keyword'
  );
  cachedKeywords = rows.map(r => r.keyword);
  return cachedKeywords;
}

function invalidateKeywordCache(): void {
  cachedKeywords = null;
}

function matchKeywords(text: string | null | undefined): string[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const matches: string[] = [];
  for (const kw of getKeywords()) {
    if (haystack.includes(kw)) matches.push(kw);
  }
  return matches;
}

function readClaim(personId: string, predicate: string): { value: string | null; isLocal: boolean } {
  const claims = localOverrideService.getClaimsForPerson(personId, predicate);
  if (claims.length === 0) return { value: null, isLocal: false };
  // Prefer most-recently-overridden value; otherwise first claim
  const overridden = claims.find(c => c.isOverridden);
  const chosen = overridden ?? claims[0];
  return { value: chosen.value || null, isLocal: chosen.source === 'local' || chosen.isOverridden };
}

function readLifeEventCause(personId: string): string | null {
  const row = sqliteService.queryOne<{ cause: string | null }>(
    `SELECT cause FROM life_event
     WHERE person_id = @personId AND event_type LIKE '%Death%' AND cause IS NOT NULL AND cause != ''
     LIMIT 1`,
    { personId }
  );
  return row?.cause ?? null;
}

export const deathsService = {
  /** Get cause / circumstance / unusual status for a single person. */
  getDeathInfo(personId: string): DeathInfo {
    const cause = readClaim(personId, 'causeOfDeath');
    // Fall back to life_event.cause if no claim exists
    const causeValue = cause.value ?? readLifeEventCause(personId);
    const circumstance = readClaim(personId, 'deathCircumstance');

    const personRow = sqliteService.queryOne<{ is_unusual_death: number | null }>(
      'SELECT is_unusual_death FROM person WHERE person_id = @personId',
      { personId }
    );
    const isUnusualManual = (personRow?.is_unusual_death ?? 0) === 1;

    const matched = [
      ...matchKeywords(causeValue),
      ...matchKeywords(circumstance.value),
    ];
    const matchedKeywords = Array.from(new Set(matched));
    const isUnusualAuto = matchedKeywords.length > 0;

    return {
      personId,
      cause: causeValue,
      circumstance: circumstance.value,
      isUnusualManual,
      isUnusualAuto,
      isUnusual: isUnusualManual || isUnusualAuto,
      matchedKeywords,
      causeIsLocal: cause.isLocal,
      circumstanceIsLocal: circumstance.isLocal,
    };
  },

  /**
   * Update cause / circumstance / unusual flag.
   * cause and circumstance write through claim+local_override so they
   * survive provider resyncs.
   */
  setDeathInfo(
    personId: string,
    updates: {
      cause?: string | null;
      circumstance?: string | null;
      isUnusualManual?: boolean;
      reason?: string;
    }
  ): DeathInfo {
    if (updates.cause !== undefined) {
      this.upsertClaimWithOverride(personId, 'causeOfDeath', updates.cause, updates.reason);
    }
    if (updates.circumstance !== undefined) {
      this.upsertClaimWithOverride(personId, 'deathCircumstance', updates.circumstance, updates.reason);
    }
    if (updates.isUnusualManual !== undefined) {
      sqliteService.run(
        'UPDATE person SET is_unusual_death = @flag, updated_at = datetime(\'now\') WHERE person_id = @personId',
        { personId, flag: updates.isUnusualManual ? 1 : 0 }
      );
    }
    return this.getDeathInfo(personId);
  },

  /** Internal: write a claim value as an override-aware update. */
  upsertClaimWithOverride(personId: string, predicate: string, value: string | null, reason?: string): void {
    const existing = localOverrideService.getClaimsForPerson(personId, predicate);

    if (existing.length === 0) {
      // No claim exists — create a local one
      if (value && value.trim()) {
        localOverrideService.addClaim(personId, predicate, value.trim());
      }
      return;
    }

    const claim = existing[0];
    const trimmed = value?.trim() || null;

    if (claim.source === 'local' && !claim.isOverridden) {
      // Pure local claim — just update it directly (or delete if cleared)
      if (trimmed === null || trimmed === '') {
        localOverrideService.deleteClaim(claim.claimId);
      } else {
        localOverrideService.updateClaim(claim.claimId, trimmed);
      }
      return;
    }

    // Provider claim — write an override on its value_text field
    localOverrideService.setOverride(
      'claim',
      claim.claimId,
      'value_text',
      trimmed,
      claim.value,
      { reason, source: 'local' }
    );
  },

  /**
   * List persons with any death-cause data, optionally filtered.
   *
   * Sources scanned: claim.causeOfDeath, claim.deathCircumstance,
   * life_event.cause (death events). When `unusualOnly` is true, only
   * persons with manual flag OR keyword match are returned.
   */
  listDeaths(opts: {
    q?: string;
    unusualOnly?: boolean;
    dbId?: string;
    limit?: number;
    offset?: number;
  } = {}): DeathListResult {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);

    // Build a unified cause text per person from:
    //   - claim with predicate 'causeOfDeath' or 'deathCircumstance'
    //   - life_event.cause for death events
    // Death year and place come from vital_event.death.
    //
    // local_override on claim.value_text takes precedence.

    const params: Record<string, unknown> = { limit, offset };
    let dbJoin = '';
    if (opts.dbId) {
      dbJoin = 'INNER JOIN database_membership dm ON dm.person_id = p.person_id AND dm.db_id = @dbId';
      params.dbId = opts.dbId;
    }

    let qFilter = '';
    if (opts.q && opts.q.trim()) {
      params.q = `%${opts.q.trim().toLowerCase()}%`;
      qFilter = `AND (
        LOWER(COALESCE(cause_text, '')) LIKE @q OR
        LOWER(COALESCE(circumstance_text, '')) LIKE @q OR
        LOWER(p.display_name) LIKE @q
      )`;
    }

    // Build keyword OR-chain for SQL-side auto-classification (so unusualOnly
    // composes correctly with LIMIT and COUNT). Without this, JS post-filter
    // would silently truncate any page where most rows are non-unusual.
    const keywords = getKeywords();
    const keywordClauses: string[] = [];
    keywords.forEach((kw, i) => {
      const key = `kw${i}`;
      params[key] = `%${kw}%`;
      keywordClauses.push(
        `LOWER(COALESCE(cause_text, '')) LIKE @${key} OR LOWER(COALESCE(circumstance_text, '')) LIKE @${key}`
      );
    });
    const autoMatchExpr = keywordClauses.length > 0
      ? `(${keywordClauses.join(' OR ')})`
      : '0';
    const unusualFilter = opts.unusualOnly
      ? `AND (is_unusual_death = 1 OR ${autoMatchExpr})`
      : '';

    // CTE: aggregated per-person cause data
    const baseCte = `
      WITH cause_claim AS (
        SELECT c.person_id,
               COALESCE(o.override_value, c.value_text) AS value_text
        FROM claim c
        LEFT JOIN local_override o
          ON o.entity_type = 'claim' AND o.entity_id = c.claim_id AND o.field_name = 'value_text'
        WHERE c.predicate = 'causeOfDeath'
      ),
      circumstance_claim AS (
        SELECT c.person_id,
               COALESCE(o.override_value, c.value_text) AS value_text
        FROM claim c
        LEFT JOIN local_override o
          ON o.entity_type = 'claim' AND o.entity_id = c.claim_id AND o.field_name = 'value_text'
        WHERE c.predicate = 'deathCircumstance'
      ),
      death_event AS (
        SELECT person_id,
               MAX(date_year) AS date_year,
               MAX(COALESCE(place_normalized, place_original)) AS place,
               MAX(cause) AS le_cause
        FROM life_event
        WHERE event_type LIKE '%Death%'
        GROUP BY person_id
      ),
      death_vital AS (
        SELECT person_id, date_year, place
        FROM vital_event
        WHERE event_type = 'death'
      ),
      person_death AS (
        SELECT
          p.person_id,
          p.display_name,
          p.is_unusual_death,
          (SELECT date_year FROM vital_event WHERE person_id = p.person_id AND event_type = 'birth' LIMIT 1) AS birth_year,
          COALESCE(dv.date_year, de.date_year) AS death_year,
          COALESCE(dv.place,     de.place)     AS death_place,
          COALESCE(cc.value_text, de.le_cause)  AS cause_text,
          ic.value_text                          AS circumstance_text
        FROM person p
        ${dbJoin}
        LEFT JOIN cause_claim cc ON cc.person_id = p.person_id
        LEFT JOIN circumstance_claim ic ON ic.person_id = p.person_id
        LEFT JOIN death_event de ON de.person_id = p.person_id
        LEFT JOIN death_vital dv ON dv.person_id = p.person_id
        WHERE (cc.value_text IS NOT NULL OR ic.value_text IS NOT NULL OR de.le_cause IS NOT NULL OR p.is_unusual_death = 1)
      )
    `;

    const filterSql = `WHERE 1=1 ${qFilter} ${unusualFilter}`;

    const rows = sqliteService.queryAll<{
      person_id: string;
      display_name: string;
      is_unusual_death: number | null;
      birth_year: number | null;
      death_year: number | null;
      death_place: string | null;
      cause_text: string | null;
      circumstance_text: string | null;
    }>(
      `${baseCte}
       SELECT * FROM person_death
       ${filterSql}
       ORDER BY death_year IS NULL, death_year ASC, display_name
       LIMIT @limit OFFSET @offset`,
      params
    );

    const totalRow = sqliteService.queryOne<{ count: number }>(
      `${baseCte} SELECT COUNT(*) AS count FROM person_death ${filterSql}`,
      params
    );

    const items: DeathListItem[] = rows.map(r => {
      const matched = Array.from(new Set([
        ...matchKeywords(r.cause_text),
        ...matchKeywords(r.circumstance_text),
      ]));
      const manual = (r.is_unusual_death ?? 0) === 1;
      const auto = matched.length > 0;
      return {
        personId: r.person_id,
        displayName: r.display_name,
        birthYear: r.birth_year,
        deathYear: r.death_year,
        deathPlace: r.death_place,
        cause: r.cause_text,
        circumstance: r.circumstance_text,
        isUnusualManual: manual,
        isUnusualAuto: auto,
        isUnusual: manual || auto,
        matchedKeywords: matched,
        causeIsLocal: false,
        circumstanceIsLocal: false,
      };
    });

    return {
      items,
      total: totalRow?.count ?? 0,
      limit,
      offset,
    };
  },

  /** Return the seeded keyword list. */
  listKeywords(): string[] {
    return [...getKeywords()].sort();
  },

  addKeyword(keyword: string): void {
    const k = keyword.trim().toLowerCase();
    if (!k) return;
    sqliteService.run(
      'INSERT OR IGNORE INTO unusual_death_keyword (keyword) VALUES (@k)',
      { k }
    );
    invalidateKeywordCache();
  },

  removeKeyword(keyword: string): boolean {
    const result = sqliteService.run(
      'DELETE FROM unusual_death_keyword WHERE keyword = @k',
      { k: keyword.trim().toLowerCase() }
    );
    invalidateKeywordCache();
    return result.changes > 0;
  },

  /** All persons whose effective death info is "unusual" — capped at 500. */
  listUnusualDeaths(dbId?: string): DeathListItem[] {
    return this.listDeaths({ unusualOnly: true, dbId, limit: 500, offset: 0 }).items;
  },
};
