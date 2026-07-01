/**
 * Tree Auditor Agent — check implementations.
 *
 * Split out of auditor-agent.service.ts (tracked as a god-file in
 * scripts/check-file-sizes.ts) so new checks don't keep growing that file.
 * Structural checks that predate this split still live in auditor-agent.service.ts;
 * moving those is tracked separately in PLAN.md.
 */

import { ulid } from 'ulid';
import type { AuditIssue, AuditIssueType, AuditIssueSeverity } from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';

export function makeIssue(
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

/**
 * Flag persons with a verified provider identity but no recorded parents —
 * their parents may be discoverable from the linked provider. Unlinked persons
 * are skipped since there's no provider to pull additional generations from
 * (mirrors the skip-if-unlinked reasoning in checkUnlinkedProviders).
 * parentCount is passed in by the caller (auditPerson), which already fetches the
 * person's parent_edge rows for BFS traversal — avoids a second query per person.
 */
export function checkMissingParents(
  runId: string, personId: string, displayName: string, linkedSources: Set<string>, parentCount: number,
): AuditIssue[] {
  if (linkedSources.size === 0) return [];
  if (parentCount > 0) return [];

  return [makeIssue(runId, personId, 'missing_parents', 'info',
    `${displayName} has no recorded parents but is linked to ${[...linkedSources].join(', ')} — parents may be discoverable`,
    null, null)];
}

/**
 * links defaults to a fresh query, but the caller (auditPerson) usually already has
 * these rows from computing linkedSources — pass them through to avoid a second
 * external_identity query for the same person.
 */
export function checkStaleRecord(
  runId: string, personId: string, displayName: string, staleDays: number,
  links?: { source: string; last_seen_at: string | null }[],
): AuditIssue[] {
  const rows = links ?? sqliteService.queryAll<{ source: string; last_seen_at: string | null }>(
    'SELECT source, last_seen_at FROM external_identity WHERE person_id = @personId',
    { personId }
  );

  const issues: AuditIssue[] = [];
  const nowMs = Date.now();

  for (const link of rows) {
    if (!link.last_seen_at) continue;
    const seenAtMs = Date.parse(link.last_seen_at);
    if (Number.isNaN(seenAtMs)) continue;

    const ageDays = Math.floor((nowMs - seenAtMs) / (24 * 60 * 60 * 1000));
    if (ageDays >= staleDays) {
      issues.push(makeIssue(runId, personId, 'stale_record', 'info',
        `${displayName}: ${link.source} data hasn't been refreshed in ${ageDays} days (threshold ${staleDays})`,
        link.last_seen_at, null, link.source));
    }
  }

  return issues;
}

const DUPLICATE_SUSPECT_YEAR_TOLERANCE = 2;

/**
 * Whole-database pass grouping persons by normalized name and flagging pairs
 * with a close birth year as possible duplicates. Not a per-person check, so
 * it's invoked once per fresh audit run (see runAudit) rather than from
 * auditPerson — a path audit operates on a specific list of IDs, not the
 * whole tree, so it isn't a natural fit for this check.
 */
export function checkDuplicateSuspects(runId: string, dbId: string): AuditIssue[] {
  const persons = sqliteService.queryAll<{
    person_id: string;
    display_name: string;
    birth_year: number | null;
  }>(
    `SELECT p.person_id, p.display_name,
            (SELECT ve.date_year FROM vital_event ve
             WHERE ve.person_id = p.person_id AND ve.event_type = 'birth' AND ve.date_year IS NOT NULL
             ORDER BY ve.confidence DESC, ve.source
             LIMIT 1) as birth_year
     FROM person p
     JOIN database_membership dm ON dm.person_id = p.person_id
     WHERE dm.db_id = @dbId`,
    { dbId }
  );

  const buckets = new Map<string, typeof persons>();
  for (const person of persons) {
    const key = person.display_name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(person);
    } else {
      buckets.set(key, [person]);
    }
  }

  const issues: AuditIssue[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        if (a.birth_year === null || b.birth_year === null) continue;
        if (Math.abs(a.birth_year - b.birth_year) > DUPLICATE_SUSPECT_YEAR_TOLERANCE) continue;

        issues.push(makeIssue(runId, a.person_id, 'duplicate_suspect', 'warning',
          `${a.display_name} (b. ${a.birth_year}) closely matches ${b.display_name} (b. ${b.birth_year}) — possible duplicate person`,
          b.person_id, null));
      }
    }
  }

  return issues;
}
