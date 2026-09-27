import { ulid } from 'ulid';
import type { AuditIssue, AuditIssueType, AuditIssueSeverity, BuiltInProvider } from '@fsf/shared';
import type { AuditStore } from './audit-persistence.js';
import { findCrossSourceMismatches, type EventSourceValue } from '../utils/auditMismatches.js';
import { placeContains, placesMatch } from '../utils/normalizePlace.js';
import { getCachedProviderVitalValues } from '../utils/auditProviderVitals.js';
import config from '../lib/config.js';

const PRIMARY_PROVIDERS: BuiltInProvider[] = ['familysearch', 'ancestry'];
const OPTIONAL_PROVIDERS: BuiltInProvider[] = ['wikitree', '23andme'];

export function createAuditChecks(store: AuditStore) {
  interface PersonVitals {
    personId: string;
    displayName: string;
    gender: string | null;
    birthYear: number | null;
    deathYear: number | null;
    burialYear: number | null;
    christeningYear: number | null;
  }

  async function getPersonVitals(personId: string): Promise<PersonVitals | undefined> {
    // Single JOIN query instead of two separate queries
    const rows = await store.queryAll<{
      person_id: string;
      display_name: string;
      gender: string | null;
      event_type: string | null;
      date_year: number | null;
    }>(
      `SELECT p.person_id, p.display_name, p.gender, ve.event_type, ve.date_year
       FROM person p
       LEFT JOIN vital_event ve ON p.person_id = ve.person_id
       WHERE p.person_id = @personId`,
      { personId }
    );

    if (rows.length === 0) return undefined;

    const first = rows[0];
    const yearFor = (type: string) => rows.find(r => r.event_type === type)?.date_year ?? null;

    return {
      personId: first.person_id,
      displayName: first.display_name,
      gender: first.gender,
      birthYear: yearFor('birth'),
      deathYear: yearFor('death'),
      burialYear: yearFor('burial'),
      christeningYear: yearFor('christening'),
    };
  }

  function checkImpossibleDates(runId: string, vitals: PersonVitals): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const { personId, displayName, birthYear, deathYear, burialYear } = vitals;

    // Born after death
    if (birthYear && deathYear && birthYear > deathYear) {
      issues.push(makeIssue(runId, personId, 'impossible_date', 'error',
        `${displayName}: birth year (${birthYear}) is after death year (${deathYear})`,
        String(birthYear), String(deathYear)));
    }

    // Burial before death
    if (deathYear && burialYear && burialYear < deathYear) {
      issues.push(makeIssue(runId, personId, 'impossible_date', 'warning',
        `${displayName}: burial year (${burialYear}) is before death year (${deathYear})`,
        String(burialYear), String(deathYear)));
    }

    // Unreasonable lifespan (> 120 years)
    if (birthYear && deathYear && (deathYear - birthYear) > 120) {
      issues.push(makeIssue(runId, personId, 'impossible_date', 'warning',
        `${displayName}: lifespan of ${deathYear - birthYear} years seems unreasonable`,
        String(deathYear - birthYear), null));
    }

    return issues;
  }

  async function checkParentAgeConflict(runId: string, personId: string, displayName: string, birthYear: number | null): Promise<AuditIssue[]> {
    if (!birthYear) return [];

    // Single query with JOIN to get parent info + birth year
    const parents = await store.queryAll<{
      parent_id: string;
      parent_role: string;
      display_name: string;
      parent_birth_year: number | null;
    }>(
      `SELECT pe.parent_id, pe.parent_role, p.display_name,
              ve.date_year as parent_birth_year
       FROM parent_edge pe
       JOIN person p ON pe.parent_id = p.person_id
       LEFT JOIN vital_event ve ON ve.person_id = pe.parent_id AND ve.event_type = 'birth'
       WHERE pe.child_id = @personId`,
      { personId }
    );

    const issues: AuditIssue[] = [];

    for (const parent of parents) {
      if (!parent.parent_birth_year) continue;

      const ageAtChildBirth = birthYear - parent.parent_birth_year;

      // Check negative age first (more specific) before < 12 (which also catches negatives)
      if (ageAtChildBirth < 0) {
        issues.push(makeIssue(runId, personId, 'parent_age_conflict', 'error',
          `${parent.display_name} (${parent.parent_role}) born after ${displayName} — parent born ${parent.parent_birth_year}, child born ${birthYear}`,
          String(parent.parent_birth_year), String(birthYear)));
      } else if (ageAtChildBirth < 12) {
        issues.push(makeIssue(runId, personId, 'parent_age_conflict', 'error',
          `${parent.display_name} (${parent.parent_role}) was ${ageAtChildBirth} at birth of ${displayName} — too young`,
          String(ageAtChildBirth), null));
      } else if (ageAtChildBirth > 80) {
        issues.push(makeIssue(runId, personId, 'parent_age_conflict', 'warning',
          `${parent.display_name} (${parent.parent_role}) was ${ageAtChildBirth} at birth of ${displayName} — unusually old`,
          String(ageAtChildBirth), null));
      }
    }

    return issues;
  }

  function checkPlaceholderName(runId: string, personId: string, displayName: string): AuditIssue[] {
    const normalized = displayName.toLowerCase().trim();
    if (config.knownUnknowns.some(u => u.toLowerCase() === normalized)) {
      return [makeIssue(runId, personId, 'placeholder_name', 'info',
        `"${displayName}" is a placeholder name`,
        displayName, null)];
    }
    return [];
  }

  async function checkMissingGender(runId: string, personId: string, displayName: string, gender: string | null): Promise<AuditIssue[]> {
    if (gender && gender !== 'unknown') return [];

    const parentRole = await store.queryOne<{ parent_role: string }>(
      'SELECT parent_role FROM parent_edge WHERE parent_id = @personId LIMIT 1',
      { personId }
    );

    if (parentRole?.parent_role === 'father' || parentRole?.parent_role === 'mother') {
      const implied = parentRole.parent_role === 'father' ? 'male' : 'female';
      return [makeIssue(runId, personId, 'missing_gender', 'info',
        `${displayName} has gender "${gender ?? 'null'}" but is listed as ${parentRole.parent_role} — should be ${implied}`,
        gender ?? 'unknown', implied)];
    }

    return [];
  }

  async function checkOrphanedEdges(runId: string, personId: string): Promise<AuditIssue[]> {
    const orphans = await store.queryAll<{
      id: number;
      parent_id: string;
      parent_role: string;
    }>(
      `SELECT pe.id, pe.parent_id, pe.parent_role
       FROM parent_edge pe
       LEFT JOIN person p ON pe.parent_id = p.person_id
       WHERE pe.child_id = @personId AND p.person_id IS NULL`,
      { personId }
    );

    return orphans.map(o => makeIssue(runId, personId, 'orphaned_edge', 'error',
      `Parent edge references non-existent ${o.parent_role} (${o.parent_id})`,
      o.parent_id, null));
  }

  /**
   * Check if person is missing links to providers they could be linked to.
   * For ancestry: only flag if a child in the BFS chain already has an ancestry link
   * (ancestry requires a connected chain from the root).
   */
  async function checkUnlinkedProviders(
    runId: string, personId: string, displayName: string, childHasAncestry: boolean,
  ): Promise<{ issues: AuditIssue[]; linkedSources: Set<string> }> {
    const linked = await store.queryAll<{ source: string }>(
      'SELECT DISTINCT source FROM external_identity WHERE person_id = @personId',
      { personId }
    );

    const linkedSources = new Set(linked.map(l => l.source));

    // Only flag if person has at least one provider link (otherwise they're likely too old/mythological)
    if (linkedSources.size === 0) return { issues: [], linkedSources };

    const issues: AuditIssue[] = [];
    const currentStr = [...linkedSources].join(',');

    for (const provider of PRIMARY_PROVIDERS) {
      if (linkedSources.has(provider)) continue;
      // Only flag ancestry if the child in the chain is already linked to ancestry
      if (provider === 'ancestry' && !childHasAncestry) continue;
      issues.push(makeIssue(
        runId, personId, 'unlinked_provider', 'info',
        `${displayName} is linked to ${currentStr} but not ${provider}`,
        currentStr, provider, provider,
      ));
    }
    for (const provider of OPTIONAL_PROVIDERS) {
      if (linkedSources.has(provider)) continue;
      issues.push(makeIssue(
        runId, personId, 'unlinked_provider', 'hint',
        `${displayName} is linked to ${currentStr} but not ${provider}`,
        currentStr, provider, provider,
      ));
    }

    return { issues, linkedSources };
  }

  async function getCrossSourceVitalValues(personId: string): Promise<EventSourceValue[]> {
    const events = await store.queryAll<{
      event_type: string;
      date_year: number | null;
      place: string | null;
      source: string | null;
    }>(
      `SELECT event_type, date_year, place, source FROM vital_event
       WHERE person_id = @personId
       ORDER BY event_type, source`,
      { personId }
    );

    const values: EventSourceValue[] = events.flatMap(event => {
      const eventValues: EventSourceValue[] = [];
      if (event.date_year !== null) {
        eventValues.push({ eventType: event.event_type, value: event.date_year, source: event.source });
      }
      const place = event.place?.trim();
      if (place) eventValues.push({ eventType: event.event_type, value: place, source: event.source });
      return eventValues;
    });

    return [...values, ...await getCachedProviderVitalValues(personId, store)];
  }

  function checkDateMismatches(
    runId: string,
    personId: string,
    displayName: string,
    events: EventSourceValue[],
  ): AuditIssue[] {
    const dateEvents = events
      .filter((event): event is EventSourceValue & { value: number } => typeof event.value === 'number');

    return findCrossSourceMismatches(dateEvents, (left, right) => left === right)
      .map(({ eventType, details }) => makeIssue(runId, personId, 'date_mismatch', 'warning',
        `${displayName}: ${eventType} date differs across sources (${details})`,
        details, null));
  }

  function checkPlaceMismatches(
    runId: string,
    personId: string,
    displayName: string,
    events: EventSourceValue[],
  ): AuditIssue[] {
    const placeEvents = events
      .filter((event): event is EventSourceValue & { value: string } => typeof event.value === 'string');

    const samePlace = (left: string | number, right: string | number) => {
      const a = String(left);
      const b = String(right);
      return placesMatch(a, b) || placeContains(a, b) || placeContains(b, a);
    };

    return findCrossSourceMismatches(placeEvents, samePlace).map(({ eventType, details }) => makeIssue(
      runId, personId, 'place_mismatch', 'warning',
      `${displayName}: ${eventType} place differs across sources (${details})`,
      details, null,
    ));
  }

  function makeIssue(
    runId: string,
    personId: string,
    issueType: AuditIssueType,
    severity: AuditIssueSeverity,
    description: string,
    currentValue: string | null,
    suggestedValue: string | null,
    suggestedSource?: string,
  ): AuditIssue {
    return {
      issueId: ulid(),
      runId,
      personId,
      issueType,
      severity,
      description,
      currentValue,
      suggestedValue,
      suggestedSource: suggestedSource ?? null,
      status: 'open',
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    };
  }

  async function auditPerson(
    runId: string, personId: string, checksEnabled: AuditIssueType[], childHasAncestry: boolean,
  ): Promise<{ issues: AuditIssue[]; displayName?: string; linkedSources: Set<string> }> {
    const vitals = await getPersonVitals(personId);
    if (!vitals) return { issues: [], linkedSources: new Set() };

    const issues: AuditIssue[] = [];
    let linkedSources = new Set<string>();
    const crossSourceVitalValues = checksEnabled.includes('date_mismatch') || checksEnabled.includes('place_mismatch')
      ? await getCrossSourceVitalValues(vitals.personId)
      : [];

    if (checksEnabled.includes('impossible_date')) {
      issues.push(...checkImpossibleDates(runId, vitals));
    }
    if (checksEnabled.includes('parent_age_conflict')) {
      issues.push(...await checkParentAgeConflict(runId, vitals.personId, vitals.displayName, vitals.birthYear));
    }
    if (checksEnabled.includes('placeholder_name')) {
      issues.push(...checkPlaceholderName(runId, vitals.personId, vitals.displayName));
    }
    if (checksEnabled.includes('missing_gender')) {
      issues.push(...await checkMissingGender(runId, vitals.personId, vitals.displayName, vitals.gender));
    }
    if (checksEnabled.includes('orphaned_edge')) {
      issues.push(...await checkOrphanedEdges(runId, vitals.personId));
    }
    if (checksEnabled.includes('unlinked_provider')) {
      const result = await checkUnlinkedProviders(runId, vitals.personId, vitals.displayName, childHasAncestry);
      issues.push(...result.issues);
      linkedSources = result.linkedSources;
    } else {
      // Still need linked sources for ancestry chain tracking even if check is disabled
      const linked = await store.queryAll<{ source: string }>(
        'SELECT DISTINCT source FROM external_identity WHERE person_id = @personId',
        { personId }
      );
      linkedSources = new Set(linked.map(l => l.source));
    }
    if (checksEnabled.includes('date_mismatch')) {
      issues.push(...checkDateMismatches(runId, vitals.personId, vitals.displayName, crossSourceVitalValues));
    }
    if (checksEnabled.includes('place_mismatch')) {
      issues.push(...checkPlaceMismatches(runId, vitals.personId, vitals.displayName, crossSourceVitalValues));
    }

    return { issues, displayName: vitals.displayName, linkedSources };
  }

  return { auditPerson };
}
