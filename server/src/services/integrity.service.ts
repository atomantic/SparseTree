/**
 * Data Integrity Service
 *
 * Checks database integrity: provider coverage gaps, missing parent links,
 * orphaned edges, and stale provider cache data.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  IntegritySummary,
  ProviderCoverageGap,
  ParentLinkageGap,
  OrphanedEdge,
  StaleRecord,
  BuiltInProvider,
} from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';
import { resolveDbId } from './database.service.js';
import { logger } from '../lib/logger.js';
import { PROVIDER_CACHE_DIR } from '../utils/paths.js';

const ALL_PROVIDERS: BuiltInProvider[] = ['familysearch', 'ancestry', 'wikitree', '23andme'];

/**
 * Get full integrity summary with counts for all check types.
 * Stale record count is deferred (-1) to avoid blocking on filesystem I/O.
 */
function getIntegritySummary(dbId: string): IntegritySummary {
  const internalDbId = resolveDbId(dbId) || dbId;

  logger.start('integrity', `Running integrity checks for db ${internalDbId}`);

  logger.data('integrity', 'Starting coverage gap count...');
  const coverageGaps = getProviderCoverageGapCount(internalDbId);
  logger.data('integrity', `Coverage gaps: ${coverageGaps}`);

  logger.data('integrity', 'Starting parent linkage gap count...');
  const parentLinkageGaps = getParentLinkageGapCount(internalDbId);
  logger.data('integrity', `Parent linkage gaps: ${parentLinkageGaps}`);

  logger.data('integrity', 'Starting orphaned edge count...');
  const orphanedEdges = getOrphanedEdgeCount(internalDbId);

  logger.done('integrity', `Checks complete: coverage=${coverageGaps}, parents=${parentLinkageGaps}, orphans=${orphanedEdges}`);

  return {
    dbId: internalDbId,
    coverageGaps,
    parentLinkageGaps,
    orphanedEdges,
    staleRecords: -1, // Computed on-demand via /stale endpoint (requires file I/O)
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Count persons with coverage gaps (have some but not all provider links).
 * Uses a CTE for clarity and performance.
 */
function getProviderCoverageGapCount(dbId: string): number {
  const row = sqliteService.queryOne<{ count: number }>(
    `WITH linked_counts AS (
       SELECT dm.person_id, COUNT(DISTINCT ei.source) as provider_count
       FROM database_membership dm
       JOIN external_identity ei ON dm.person_id = ei.person_id
       WHERE dm.db_id = @dbId
       GROUP BY dm.person_id
     )
     SELECT COUNT(*) as count FROM linked_counts
     WHERE provider_count > 0 AND provider_count < @providerCount`,
    { dbId, providerCount: ALL_PROVIDERS.length }
  );
  return row?.count ?? 0;
}

/**
 * Count parent edges where child has a provider link but parent doesn't
 * for at least one of the child's providers.
 * Uses EXISTS + EXCEPT to avoid cross-product explosion.
 */
function getParentLinkageGapCount(dbId: string): number {
  const row = sqliteService.queryOne<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM parent_edge pe
     JOIN database_membership dm ON pe.child_id = dm.person_id AND dm.db_id = @dbId
     WHERE EXISTS (
       SELECT source FROM external_identity WHERE person_id = pe.child_id
       EXCEPT
       SELECT source FROM external_identity WHERE person_id = pe.parent_id
     )`,
    { dbId }
  );
  return row?.count ?? 0;
}

/**
 * Count orphaned parent edges (parent_id referencing non-existent person)
 */
function getOrphanedEdgeCount(dbId: string): number {
  const row = sqliteService.queryOne<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM parent_edge pe
     JOIN database_membership dm ON pe.child_id = dm.person_id AND dm.db_id = @dbId
     LEFT JOIN person p ON pe.parent_id = p.person_id
     WHERE p.person_id IS NULL`,
    { dbId }
  );
  return row?.count ?? 0;
}

/**
 * Get persons with provider coverage gaps (have some but not all provider links)
 */
function getProviderCoverageGaps(dbId: string, providers?: string[]): ProviderCoverageGap[] {
  const internalDbId = resolveDbId(dbId) || dbId;
  const targetProviders = providers?.length ? providers : ALL_PROVIDERS;

  const rows = sqliteService.queryAll<{
    person_id: string;
    display_name: string;
    linked_sources: string;
    generation: number | null;
  }>(
    `SELECT
       dm.person_id,
       p.display_name,
       GROUP_CONCAT(DISTINCT ei.source) as linked_sources,
       dm.generation
     FROM database_membership dm
     JOIN person p ON dm.person_id = p.person_id
     JOIN external_identity ei ON dm.person_id = ei.person_id
     WHERE dm.db_id = @dbId
     GROUP BY dm.person_id
     HAVING COUNT(DISTINCT ei.source) < @providerCount
     ORDER BY dm.generation, p.display_name
     LIMIT 500`,
    { dbId: internalDbId, providerCount: targetProviders.length }
  );

  return rows.map(row => {
    const linked = row.linked_sources.split(',');
    const missing = targetProviders.filter(p => !linked.includes(p));
    return {
      personId: row.person_id,
      displayName: row.display_name,
      linkedProviders: linked,
      missingProviders: missing,
      generation: row.generation ?? undefined,
    };
  });
}

/**
 * Get parent edges where child has provider link but parent doesn't.
 * Requires idx_external_identity_person_source for fast correlated subqueries.
 * Unfiltered path uses EXCEPT to avoid cross-product.
 */
function getParentLinkageGaps(dbId: string, provider?: string): ParentLinkageGap[] {
  const internalDbId = resolveDbId(dbId) || dbId;

  if (provider) {
    // EXISTS/NOT EXISTS with composite index: O(N) with 2 index probes per row
    const rows = sqliteService.queryAll<{
      child_id: string;
      child_name: string;
      parent_id: string;
      parent_name: string;
      parent_role: string;
    }>(
      `SELECT
         pe.child_id,
         pc.display_name as child_name,
         pe.parent_id,
         pp.display_name as parent_name,
         pe.parent_role
       FROM parent_edge pe
       JOIN database_membership dm ON pe.child_id = dm.person_id AND dm.db_id = @dbId
       JOIN person pc ON pe.child_id = pc.person_id
       JOIN person pp ON pe.parent_id = pp.person_id
       WHERE EXISTS (SELECT 1 FROM external_identity WHERE person_id = pe.child_id AND source = @provider)
         AND NOT EXISTS (SELECT 1 FROM external_identity WHERE person_id = pe.parent_id AND source = @provider)
       ORDER BY pc.display_name, pe.parent_role
       LIMIT 500`,
      { dbId: internalDbId, provider }
    );

    return rows.map(row => ({
      childId: row.child_id,
      childName: row.child_name,
      parentId: row.parent_id,
      parentName: row.parent_name,
      parentRole: row.parent_role,
      provider,
      childHasProviderLink: true,
    }));
  }

  // Unfiltered: use EXCEPT to find provider gaps without cross-product
  const rows = sqliteService.queryAll<{
    child_id: string;
    child_name: string;
    parent_id: string;
    parent_name: string;
    parent_role: string;
  }>(
    `SELECT
       pe.child_id,
       pc.display_name as child_name,
       pe.parent_id,
       pp.display_name as parent_name,
       pe.parent_role
     FROM parent_edge pe
     JOIN database_membership dm ON pe.child_id = dm.person_id AND dm.db_id = @dbId
     JOIN person pc ON pe.child_id = pc.person_id
     JOIN person pp ON pe.parent_id = pp.person_id
     WHERE EXISTS (
       SELECT source FROM external_identity WHERE person_id = pe.child_id
       EXCEPT
       SELECT source FROM external_identity WHERE person_id = pe.parent_id
     )
     ORDER BY pc.display_name, pe.parent_role
     LIMIT 500`,
    { dbId: internalDbId }
  );

  return rows.map(row => ({
    childId: row.child_id,
    childName: row.child_name,
    parentId: row.parent_id,
    parentName: row.parent_name,
    parentRole: row.parent_role,
    provider: 'multiple',
    childHasProviderLink: true,
  }));
}

/**
 * Get orphaned parent edges (parent_id referencing non-existent person records)
 */
function getOrphanedEdges(dbId: string): OrphanedEdge[] {
  const internalDbId = resolveDbId(dbId) || dbId;

  const rows = sqliteService.queryAll<{
    id: number;
    child_id: string;
    parent_id: string;
    parent_role: string;
  }>(
    `SELECT pe.id, pe.child_id, pe.parent_id, pe.parent_role
     FROM parent_edge pe
     JOIN database_membership dm ON pe.child_id = dm.person_id AND dm.db_id = @dbId
     LEFT JOIN person p ON pe.parent_id = p.person_id
     WHERE p.person_id IS NULL
     ORDER BY pe.child_id
     LIMIT 500`,
    { dbId: internalDbId }
  );

  return rows.map(row => ({
    edgeId: row.id,
    childId: row.child_id,
    parentId: row.parent_id,
    parentRole: row.parent_role,
    missingPerson: 'parent' as const,
  }));
}

/**
 * Get stale provider cache records older than N days.
 * This does filesystem I/O so is only called on-demand (not in summary).
 * Limits file reads to avoid blocking the event loop too long.
 */
function getStaleProviderData(dbId: string, days = 30): StaleRecord[] {
  const internalDbId = resolveDbId(dbId) || dbId;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();
  const now = Date.now();

  const rows = sqliteService.queryAll<{
    person_id: string;
    display_name: string;
    source: string;
    external_id: string;
  }>(
    `SELECT ei.person_id, p.display_name, ei.source, ei.external_id
     FROM external_identity ei
     JOIN database_membership dm ON ei.person_id = dm.person_id AND dm.db_id = @dbId
     JOIN person p ON ei.person_id = p.person_id
     ORDER BY p.display_name
     LIMIT 2000`,
    { dbId: internalDbId }
  );

  const stale: StaleRecord[] = [];

  for (const row of rows) {
    const cachePath = path.join(PROVIDER_CACHE_DIR, row.source, `${row.external_id}.json`);
    if (!fs.existsSync(cachePath)) continue;

    const raw = fs.readFileSync(cachePath, 'utf-8');
    let cacheContent = null;
    if (raw.startsWith('{')) { try { cacheContent = JSON.parse(raw); } catch { /* corrupted */ } }
    if (!cacheContent) {
      logger.warn('integrity', `Corrupted cache file: ${cachePath}`);
      continue;
    }
    if (cacheContent.scrapedAt && cacheContent.scrapedAt < cutoffIso) {
      const scrapedDate = new Date(cacheContent.scrapedAt);
      const ageDays = Math.floor((now - scrapedDate.getTime()) / (1000 * 60 * 60 * 24));
      stale.push({
        personId: row.person_id,
        displayName: row.display_name,
        provider: row.source,
        externalId: row.external_id,
        scrapedAt: cacheContent.scrapedAt,
        ageDays,
      });
    }

    // Cap results to prevent massive response
    if (stale.length >= 500) break;
  }

  return stale;
}

export const integrityService = {
  getIntegritySummary,
  getProviderCoverageGaps,
  getParentLinkageGaps,
  getOrphanedEdges,
  getStaleProviderData,
};
