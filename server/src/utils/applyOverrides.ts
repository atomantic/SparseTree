/** Apply PostgreSQL user edits after assembling provider-owned person rows. */
import { postgresService, type createPostgresService } from '../db/postgres.service.js';

interface OverridablePerson {
  name?: string;
  birthName?: string;
  gender?: string;
  bio?: string;
  birth?: { date?: string; place?: string };
  death?: { date?: string; place?: string };
  burial?: { date?: string; place?: string };
  lifespan?: string;
  location?: string;
}

interface OverrideField {
  entity_type: string;
  field_name: string;
  override_value: string | null;
  event_type: string | null;
}

export function createOverrideApplier(store: ReturnType<typeof createPostgresService> = postgresService) {
  return async function applyLocalOverrides(
    person: OverridablePerson,
    personId: string,
    options?: { recomputeLifespan?: (person: OverridablePerson) => void },
  ): Promise<void> {
    // Fetch related fields together instead of opening one query per event.
    const fields = await store.queryAll<OverrideField>(
      `SELECT o.entity_type, o.field_name, o.override_value, e.event_type
       FROM local_override o
       LEFT JOIN vital_event e ON o.entity_type = 'vital_event' AND o.entity_id = e.id::text
       WHERE (o.entity_type = 'person' AND o.entity_id = @personId)
          OR e.person_id = @personId
       ORDER BY o.updated_at, o.override_id`, { personId });
    for (const field of fields) {
      const value = field.override_value;
      if (field.entity_type === 'person') {
        if (['name', 'display_name'].includes(field.field_name) && value !== null) person.name = value;
        else if (field.field_name === 'gender' && value !== null) person.gender = value;
        else if (['birth_name', 'birthName'].includes(field.field_name)) person.birthName = value ?? undefined;
        else if (field.field_name === 'bio') person.bio = value ?? undefined;
        continue;
      }
      const eventType = field.event_type;
      if (eventType !== 'birth' && eventType !== 'death' && eventType !== 'burial') continue;
      const event = person[eventType] ??= {};
      if (field.field_name === 'date' || field.field_name === `${eventType}_date`) event.date = value ?? undefined;
      else if (field.field_name === 'place' || field.field_name === `${eventType}_place`) event.place = value ?? undefined;
    }
    options?.recomputeLifespan?.(person);
  };
}

export const applyLocalOverrides = createOverrideApplier();
