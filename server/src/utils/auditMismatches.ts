/**
 * Helpers for detecting disagreements between provider-sourced vital events.
 *
 * A disagreement must be between sources. Multiple values from one source are
 * not enough evidence to ask the user to resolve a cross-provider conflict.
 */

export interface EventSourceValue {
  eventType: string;
  value: string | number;
  source: string | null;
}

export interface EventMismatch {
  eventType: string;
  details: string;
}

type ValuesMatch = (a: string | number, b: string | number) => boolean;

function sourceName(source: string | null): string {
  return source?.trim() || 'local';
}

function formatSourceValues(entries: EventSourceValue[]): string {
  const bySource = new Map<string, Set<string>>();

  for (const entry of entries) {
    const source = sourceName(entry.source);
    const values = bySource.get(source) ?? new Set<string>();
    values.add(String(entry.value));
    bySource.set(source, values);
  }

  return [...bySource.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, values]) => `${source}: ${[...values].sort().join(' / ')}`)
    .join(', ');
}

/**
 * Find event types where at least two sources have no matching value.
 *
 * A source can contain more than one value (notably legacy records with a
 * null source). We suppress a mismatch when the two sources share any value,
 * because there is no unambiguous cross-provider disagreement to resolve.
 */
export function findCrossSourceMismatches(
  entries: EventSourceValue[],
  valuesMatch: ValuesMatch,
): EventMismatch[] {
  const byEventType = new Map<string, EventSourceValue[]>();

  for (const entry of entries) {
    const values = byEventType.get(entry.eventType) ?? [];
    values.push(entry);
    byEventType.set(entry.eventType, values);
  }

  const mismatches: EventMismatch[] = [];

  for (const [eventType, eventEntries] of byEventType) {
    const bySource = new Map<string, EventSourceValue[]>();
    for (const entry of eventEntries) {
      const source = sourceName(entry.source);
      const values = bySource.get(source) ?? [];
      values.push(entry);
      bySource.set(source, values);
    }

    const sourceValues = [...bySource.values()];
    const hasDisagreement = sourceValues.some((values, index) =>
      sourceValues.slice(index + 1).some(otherValues =>
        values.every(value => otherValues.every(other => !valuesMatch(value.value, other.value)))
      )
    );

    if (hasDisagreement) {
      mismatches.push({ eventType, details: formatSourceValues(eventEntries) });
    }
  }

  return mismatches;
}
