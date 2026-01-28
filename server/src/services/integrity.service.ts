/**
 * Data Integrity Service
 *
 * Checks database integrity: provider coverage gaps, missing parent links,
 * orphaned edges, and stale provider cache data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../../data');
const PROVIDER_CACHE_DIR = path.join(DATA_DIR, 'provider-cache');

const ALL_PROVIDERS: BuiltInProvider[] = ['familysearch', 'ancestry', 'wikitree', '23andme'];

/**
 * Get full integrity summary with counts for all check types
 */
function getIntegritySummary(dbId: string): IntegritySummary {
  const internalDbId = resolveDbId(dbId) || dbId;

  logger.start('integrity', `Running integrity checks for db ${internalDbId}`);

  const coverageGaps = getProviderCoverageGapCount(internalDbId);
  const parentLinkageGaps = getParentLinkageGapCount(internalDbId);
  const orphanedEdges = getOrphanedEdgeCount(internalDbId);
  const staleRecords = getStaleRecordCount(internalDbId, 30);

  logger.done('integrity', `Checks complete: coverage=${coverageGaps}, parents=${parentLinkageGaps}, orphans=${orphanedEdges}, stale=${staleRecords}`);

  return {
    dbId: internalDbId,
    coverageGaps,
    parentLinkageGaps,
    orphanedEdges,
    staleRecords,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Count persons with coverage gaps (have some but not all provider links)
 */
function getProviderCoverageGapCount(dbId: string): number {
  const row = sqliteService.queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT dm.person_id) as count
     FROM database_membership dm
     JOIN external_identity ei ON dm.person_id = ei.person_id
     WHERE dm.db_id = @dbId
       AND dm.person_id NOT IN (
         SELECT person_id FROM external_identity
         GROUP BY person_id
         HAVING COUNT(DISTINCT source) >= @providerCount
       )`,
    { dbId, providerCount: ALL_PROVIDERS.length }
  );
  return row?.count ?? 0;
}

/**
 * Count parent edges where child has a provider link but parent doesn't
 */
function getParentLinkageGapCount(dbId: string): number {
  const row = sqliteService.queryOne<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM parent_edge pe
     JOIN database_membership dm ON pe.child_id = dm.person_id AND dm.db_id = @dbId
     WHERE EXISTS (
       SELECT 1 FROM external_identity ei WHERE ei.person_id = pe.child_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM external_identity ei2
       WHERE ei2.person_id = pe.parent_id
         AND ei2.source IN (
           SELECT source FROM external_identity WHERE person_id = pe.child_id
         )
     )`,
    { dbId }
  );
  return row?.count ?? 0;
}

/**
 * Count orphaned parent edges (referencing non-existent person records)
 */
function getOrphanedEdgeCount(dbId: string): number {
  const row = sqliteService.queryOne<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM parent_edge pe
     JOIN database_membership dm ON pe.child_id = dm.person_id AND dm.db_id = @dbId
     WHERE NOT EXISTS (SELECT 1 FROM person p WHERE p.person_id = pe.parent_id)
        OR NOT EXISTS (SELECT 1 FROM person p WHERE p.person_id = pe.child_id)`,
    { dbId }
  );
  return row?.count ?? 0;
}

/**
 * Count stale provider cache files older than N days
 */
function getStaleRecordCount(dbId: string, days: number): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();

  // Get persons in this database that have external identities
  const rows = sqliteService.queryAll<{ person_id: string; source: string; external_id: string }>(
    `SELECT ei.person_id, ei.source, ei.external_id
     FROM external_identity ei
     JOIN database_membership dm ON ei.person_id = dm.person_id AND dm.db_id = @dbId`,
    { dbId }
  );

  let count = 0;
  for (const row of rows) {
    const cachePath = path.join(PROVIDER_CACHE_DIR, row.source, `${row.external_id}.json`);
    if (!fs.existsSync(cachePath)) continue;

    const cacheContent = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    if (cacheContent.scrapedAt && cacheContent.scrapedAt < cutoffIso) {
      count++;
    }
  }

  return count;
}

/**
 * Get persons with provider coverage gaps (have some but not all provider links)
 */
function getProviderCoverageGaps(dbId: string, providers?: string[]): ProviderCoverageGap[] {
  const internalDbId = resolveDbId(dbId) || dbId;
  const targetProviders = providers?.length ? providers : ALL_PROVIDERS;

  // Get all persons in database with their linked providers
  const rows = sqliteService.queryAll<{
    person_id: string;
    display_name: string;
    linked_sources: string;
  }>(
    `SELECT
       dm.person_id,
       p.display_name,
       GROUP_CONCAT(DISTINCT ei.source) as linked_sources
     FROM database_membership dm
     JOIN person p ON dm.person_id = p.person_id
     LEFT JOIN external_identity ei ON dm.person_id = ei.person_id
     WHERE dm.db_id = @dbId
     GROUP BY dm.person_id
     HAVING linked_sources IS NOT NULL
       AND linked_sources != ''`,
    { dbId: internalDbId }
  );

  const gaps: ProviderCoverageGap[] = [];

  for (const row of rows) {
    const linked = row.linked_sources.split(',');
    const missing = targetProviders.filter(p => !linked.includes(p));

    if (missing.length > 0 && linked.length > 0) {
      gaps.push({
        personId: row.person_id,
        displayName: row.display_name,
        linkedProviders: linked,
        missingProviders: missing,
      });
    }
  }

  return gaps;
}

/**
 * Get parent edges where child has provider link but parent doesn't
 */
function getParentLinkageGaps(dbId: string, provider?: string): ParentLinkageGap[] {
  const internalDbId = resolveDbId(dbId) || dbId;

  // If provider is specified, filter to that specific provider
  const providerFilter = provider
    ? `AND ei_child.source = @provider`
    : '';

  const rows = sqliteService.queryAll<{
    child_id: string;
    child_name: string;
    parent_id: string;
    parent_name: string;
    parent_role: string;
    child_provider: string;
  }>(
    `SELECT
       pe.child_id,
       pc.display_name as child_name,
       pe.parent_id,
       pp.display_name as parent_name,
       pe.parent_role,
       ei_child.source as child_provider
     FROM parent_edge pe
     JOIN database_membership dm ON pe.child_id = dm.person_id AND dm.db_id = @dbId
     JOIN person pc ON pe.child_id = pc.person_id
     JOIN person pp ON pe.parent_id = pp.person_id
     JOIN external_identity ei_child ON pe.child_id = ei_child.person_id ${providerFilter}
     WHERE NOT EXISTS (
       SELECT 1 FROM external_identity ei_parent
       WHERE ei_parent.person_id = pe.parent_id
         AND ei_parent.source = ei_child.source
     )
     ORDER BY pc.display_name, pe.parent_role`,
    { dbId: internalDbId, provider: provider || '' }
  );

  return rows.map(row => ({
    childId: row.child_id,
    childName: row.child_name,
    parentId: row.parent_id,
    parentName: row.parent_name,
    parentRole: row.parent_role,
    provider: row.child_provider,
    childHasProviderLink: true,
  }));
}

/**
 * Get orphaned parent edges (referencing non-existent person records)
 */
function getOrphanedEdges(dbId: string): OrphanedEdge[] {
  const internalDbId = resolveDbId(dbId) || dbId;

  const rows = sqliteService.queryAll<{
    id: number;
    child_id: string;
    parent_id: string;
    parent_role: string;
    child_exists: number;
    parent_exists: number;
  }>(
    `SELECT
       pe.id,
       pe.child_id,
       pe.parent_id,
       pe.parent_role,
       (SELECT COUNT(*) FROM person WHERE person_id = pe.child_id) as child_exists,
       (SELECT COUNT(*) FROM person WHERE person_id = pe.parent_id) as parent_exists
     FROM parent_edge pe
     JOIN database_membership dm ON pe.child_id = dm.person_id AND dm.db_id = @dbId
     WHERE NOT EXISTS (SELECT 1 FROM person p WHERE p.person_id = pe.parent_id)
        OR NOT EXISTS (SELECT 1 FROM person p WHERE p.person_id = pe.child_id)
     ORDER BY pe.child_id`,
    { dbId: internalDbId }
  );

  return rows.map(row => ({
    edgeId: row.id,
    childId: row.child_id,
    parentId: row.parent_id,
    parentRole: row.parent_role,
    missingPerson: row.child_exists === 0 && row.parent_exists === 0
      ? 'both'
      : row.child_exists === 0
        ? 'child'
        : 'parent',
  }));
}

/**
 * Get stale provider cache records older than N days
 */
function getStaleProviderData(dbId: string, days = 30): StaleRecord[] {
  const internalDbId = resolveDbId(dbId) || dbId;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();
  const now = Date.now();

  // Get persons in this database that have external identities
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
     ORDER BY p.display_name`,
    { dbId: internalDbId }
  );

  const stale: StaleRecord[] = [];

  for (const row of rows) {
    const cachePath = path.join(PROVIDER_CACHE_DIR, row.source, `${row.external_id}.json`);
    if (!fs.existsSync(cachePath)) continue;

    const cacheContent = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
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
