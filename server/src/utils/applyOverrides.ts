/**
 * Apply local overrides to a person-like object.
 * Modifies the person in place to reflect user overrides from local_override table.
 */

import { sqliteService } from '../db/sqlite.service.js';
import { localOverrideService } from '../services/local-override.service.js';

interface OverridablePerson {
  name?: string;
  gender?: string;
  birth?: { date?: string; place?: string };
  death?: { date?: string; place?: string };
  lifespan?: string;
  location?: string;
}

/**
 * Apply local overrides (person-level and vital_event-level) to a person object.
 * Handles field name variants: 'date'/'birth_date'/'death_date', 'place'/'birth_place'/'death_place'.
 *
 * @param person - The person-like object to modify in place
 * @param personId - Canonical person ID
 * @param options.recomputeLifespan - If provided, called after applying overrides to recompute derived fields
 */
export function applyLocalOverrides(
  person: OverridablePerson,
  personId: string,
  options?: { recomputeLifespan?: (person: OverridablePerson) => void },
): void {
  // Get person-level overrides (name, gender)
  const personOverrides = localOverrideService.getOverridesForEntity('person', personId);
  for (const override of personOverrides) {
    if (override.fieldName === 'name' && override.overrideValue) {
      person.name = override.overrideValue;
    } else if (override.fieldName === 'gender' && override.overrideValue) {
      person.gender = override.overrideValue;
    }
  }

  // Get vital event IDs for this person and check for overrides
  const vitalEventIds = sqliteService.queryAll<{ id: number; event_type: string }>(
    `SELECT id, event_type FROM vital_event WHERE person_id = @personId`,
    { personId }
  );

  for (const event of vitalEventIds) {
    const eventOverrides = localOverrideService.getOverridesForEntity('vital_event', String(event.id));
    for (const override of eventOverrides) {
      if (event.event_type === 'birth') {
        if (!person.birth) person.birth = {};
        if (override.fieldName === 'date' || override.fieldName === 'birth_date') {
          person.birth.date = override.overrideValue ?? undefined;
        } else if (override.fieldName === 'place' || override.fieldName === 'birth_place') {
          person.birth.place = override.overrideValue ?? undefined;
        }
      } else if (event.event_type === 'death') {
        if (!person.death) person.death = {};
        if (override.fieldName === 'date' || override.fieldName === 'death_date') {
          person.death.date = override.overrideValue ?? undefined;
        } else if (override.fieldName === 'place' || override.fieldName === 'death_place') {
          person.death.place = override.overrideValue ?? undefined;
        }
      }
    }
  }

  // Optionally recompute derived fields
  options?.recomputeLifespan?.(person);
}
