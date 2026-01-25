/**
 * Local Override Service
 *
 * Manages user edits that take precedence over provider data.
 * Implements Layer 3 of the three-layer data model:
 * 1. Raw provider data (JSON cache)
 * 2. Provider data in SQLite (person, vital_event, claim)
 * 3. Local overrides (this service) - highest priority
 */

import { ulid } from 'ulid';
import { sqliteService } from '../db/sqlite.service.js';

export interface LocalOverride {
  overrideId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  originalValue: string | null;
  overrideValue: string | null;
  reason?: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SetOverrideOptions {
  reason?: string;
  source?: string;
}

type OverrideRow = {
  override_id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  original_value: string | null;
  override_value: string | null;
  reason: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

function rowToOverride(row: OverrideRow): LocalOverride {
  return {
    overrideId: row.override_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fieldName: row.field_name,
    originalValue: row.original_value,
    overrideValue: row.override_value,
    reason: row.reason ?? undefined,
    source: row.source ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const localOverrideService = {
  /**
   * Set or update an override for a specific field
   */
  setOverride(
    entityType: string,
    entityId: string,
    fieldName: string,
    value: string | null,
    originalValue: string | null,
    options?: SetOverrideOptions
  ): LocalOverride {
    const overrideId = ulid();
    const now = new Date().toISOString();

    // Use INSERT OR REPLACE to handle both new and existing overrides
    sqliteService.run(
      `INSERT INTO local_override (override_id, entity_type, entity_id, field_name, original_value, override_value, reason, source, created_at, updated_at)
       VALUES (@overrideId, @entityType, @entityId, @fieldName, @originalValue, @overrideValue, @reason, @source, @createdAt, @updatedAt)
       ON CONFLICT(entity_type, entity_id, field_name) DO UPDATE SET
         override_value = @overrideValue,
         reason = COALESCE(@reason, reason),
         source = COALESCE(@source, source),
         updated_at = @updatedAt`,
      {
        overrideId,
        entityType,
        entityId,
        fieldName,
        originalValue,
        overrideValue: value,
        reason: options?.reason ?? null,
        source: options?.source ?? 'local',
        createdAt: now,
        updatedAt: now,
      }
    );

    // Return the current state
    const result = this.getOverride(entityType, entityId, fieldName);
    if (!result) {
      throw new Error('Failed to set override');
    }
    return result;
  },

  /**
   * Get a specific override
   */
  getOverride(entityType: string, entityId: string, fieldName: string): LocalOverride | null {
    const row = sqliteService.queryOne<OverrideRow>(
      `SELECT * FROM local_override WHERE entity_type = @entityType AND entity_id = @entityId AND field_name = @fieldName`,
      { entityType, entityId, fieldName }
    );
    return row ? rowToOverride(row) : null;
  },

  /**
   * Get all overrides for a specific entity
   */
  getOverridesForEntity(entityType: string, entityId: string): LocalOverride[] {
    const rows = sqliteService.queryAll<OverrideRow>(
      `SELECT * FROM local_override WHERE entity_type = @entityType AND entity_id = @entityId`,
      { entityType, entityId }
    );
    return rows.map(rowToOverride);
  },

  /**
   * Get all overrides for a person, including related vital events and claims
   */
  getAllOverridesForPerson(personId: string): {
    personOverrides: LocalOverride[];
    eventOverrides: LocalOverride[];
    claimOverrides: LocalOverride[];
  } {
    // Get direct person overrides
    const personOverrides = this.getOverridesForEntity('person', personId);

    // Get vital event IDs for this person
    const vitalEventIds = sqliteService.queryAll<{ id: number }>(
      `SELECT id FROM vital_event WHERE person_id = @personId`,
      { personId }
    ).map(r => r.id.toString());

    // Get claim IDs for this person
    const claimIds = sqliteService.queryAll<{ claim_id: string }>(
      `SELECT claim_id FROM claim WHERE person_id = @personId`,
      { personId }
    ).map(r => r.claim_id);

    // Get overrides for events
    const eventOverrides: LocalOverride[] = [];
    for (const eventId of vitalEventIds) {
      const overrides = this.getOverridesForEntity('vital_event', eventId);
      eventOverrides.push(...overrides);
    }

    // Get overrides for claims
    const claimOverrides: LocalOverride[] = [];
    for (const claimId of claimIds) {
      const overrides = this.getOverridesForEntity('claim', claimId);
      claimOverrides.push(...overrides);
    }

    return { personOverrides, eventOverrides, claimOverrides };
  },

  /**
   * Remove an override (revert to original value)
   */
  removeOverride(entityType: string, entityId: string, fieldName: string): boolean {
    const result = sqliteService.run(
      `DELETE FROM local_override WHERE entity_type = @entityType AND entity_id = @entityId AND field_name = @fieldName`,
      { entityType, entityId, fieldName }
    );
    return result.changes > 0;
  },

  /**
   * Check if a field has an override
   */
  hasOverride(entityType: string, entityId: string, fieldName: string): boolean {
    const row = sqliteService.queryOne<{ override_id: string }>(
      `SELECT override_id FROM local_override WHERE entity_type = @entityType AND entity_id = @entityId AND field_name = @fieldName`,
      { entityType, entityId, fieldName }
    );
    return !!row;
  },

  /**
   * Get the effective value for a field (override if exists, otherwise original)
   */
  getEffectiveValue(
    entityType: string,
    entityId: string,
    fieldName: string,
    originalValue: string | null
  ): { value: string | null; isOverridden: boolean; override?: LocalOverride } {
    const override = this.getOverride(entityType, entityId, fieldName);
    if (override) {
      return {
        value: override.overrideValue,
        isOverridden: true,
        override,
      };
    }
    return { value: originalValue, isOverridden: false };
  },

  /**
   * Get all overrides (for admin/debug purposes)
   */
  getAllOverrides(limit = 100, offset = 0): LocalOverride[] {
    const rows = sqliteService.queryAll<OverrideRow>(
      `SELECT * FROM local_override ORDER BY updated_at DESC LIMIT @limit OFFSET @offset`,
      { limit, offset }
    );
    return rows.map(rowToOverride);
  },

  /**
   * Count total overrides
   */
  countOverrides(): number {
    const result = sqliteService.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM local_override');
    return result?.count ?? 0;
  },

  /**
   * Get vital event ID by person and event type
   */
  getVitalEventId(personId: string, eventType: string): number | null {
    const row = sqliteService.queryOne<{ id: number }>(
      `SELECT id FROM vital_event WHERE person_id = @personId AND event_type = @eventType LIMIT 1`,
      { personId, eventType }
    );
    return row?.id ?? null;
  },

  /**
   * Create a vital event if it doesn't exist (for adding overrides to events that don't have source data)
   */
  ensureVitalEvent(personId: string, eventType: string): number {
    const existingId = this.getVitalEventId(personId, eventType);
    if (existingId !== null) {
      return existingId;
    }

    // Create a new vital event with local source
    const result = sqliteService.run(
      `INSERT INTO vital_event (person_id, event_type, source) VALUES (@personId, @eventType, 'local')`,
      { personId, eventType }
    );

    return Number(result.lastInsertRowid);
  },

  /**
   * Add a new claim (occupation, alias, etc.)
   */
  addClaim(personId: string, predicate: string, value: string): { claimId: string } {
    const claimId = ulid();

    sqliteService.run(
      `INSERT INTO claim (claim_id, person_id, predicate, value_text, source) VALUES (@claimId, @personId, @predicate, @value, 'local')`,
      { claimId, personId, predicate, value }
    );

    return { claimId };
  },

  /**
   * Update a claim value
   */
  updateClaim(claimId: string, value: string): boolean {
    const result = sqliteService.run(
      `UPDATE claim SET value_text = @value WHERE claim_id = @claimId`,
      { claimId, value }
    );
    return result.changes > 0;
  },

  /**
   * Delete a claim
   */
  deleteClaim(claimId: string): boolean {
    // First remove any overrides for this claim
    sqliteService.run(
      `DELETE FROM local_override WHERE entity_type = 'claim' AND entity_id = @claimId`,
      { claimId }
    );

    // Then delete the claim itself
    const result = sqliteService.run(
      `DELETE FROM claim WHERE claim_id = @claimId`,
      { claimId }
    );
    return result.changes > 0;
  },

  /**
   * Get a claim by ID
   */
  getClaim(claimId: string): { claimId: string; personId: string; predicate: string; value: string; source: string } | null {
    const row = sqliteService.queryOne<{
      claim_id: string;
      person_id: string;
      predicate: string;
      value_text: string;
      source: string;
    }>(`SELECT claim_id, person_id, predicate, value_text, source FROM claim WHERE claim_id = @claimId`, { claimId });

    if (!row) return null;
    return {
      claimId: row.claim_id,
      personId: row.person_id,
      predicate: row.predicate,
      value: row.value_text,
      source: row.source,
    };
  },

  /**
   * Get all claims for a person (with override data merged)
   */
  getClaimsForPerson(personId: string, predicate?: string): Array<{
    claimId: string;
    predicate: string;
    value: string;
    source: string;
    isOverridden: boolean;
    originalValue?: string;
  }> {
    let query = `SELECT claim_id, predicate, value_text, source FROM claim WHERE person_id = @personId`;
    const params: Record<string, unknown> = { personId };

    if (predicate) {
      query += ` AND predicate = @predicate`;
      params.predicate = predicate;
    }

    const rows = sqliteService.queryAll<{
      claim_id: string;
      predicate: string;
      value_text: string;
      source: string;
    }>(query, params);

    return rows.map(row => {
      const override = this.getOverride('claim', row.claim_id, 'value_text');
      return {
        claimId: row.claim_id,
        predicate: row.predicate,
        value: override?.overrideValue ?? row.value_text,
        source: row.source,
        isOverridden: !!override,
        originalValue: override ? row.value_text : undefined,
      };
    });
  },
};
