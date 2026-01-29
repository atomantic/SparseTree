/**
 * Parent Discovery Service
 *
 * Discovers and links provider-specific IDs for a person's parents
 * by scraping the person's page on the provider and extracting parent references.
 * Supports single-person discovery and recursive ancestor traversal.
 */

import type {
  BuiltInProvider,
} from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';
import { augmentationService } from './augmentation.service.js';
import { databaseService } from './database.service.js';
import { browserService } from './browser.service.js';
import { providerService } from './provider.service.js';
import { getScraper } from './scrapers/index.js';
import { PROVIDER_DEFAULTS } from './scrapers/base.scraper.js';
import { logger } from '../lib/logger.js';

interface DiscoverParentsResult {
  personId: string;
  provider: BuiltInProvider;
  discovered: Array<{
    parentId: string;
    parentRole: string;
    parentName: string;
    externalId: string;
    providerUrl: string;
    confidence: number;
    nameMatch: boolean;
  }>;
  skipped: Array<{
    parentId: string;
    parentRole: string;
    reason: 'already_linked' | 'not_found_on_provider' | 'name_mismatch_below_threshold';
  }>;
  error?: string;
}

interface DiscoverAncestorsResult {
  provider: BuiltInProvider;
  totalDiscovered: number;
  totalSkipped: number;
  totalErrors: number;
  generationsTraversed: number;
  personsVisited: number;
  results: DiscoverParentsResult[];
  error?: string;
}

/**
 * Normalize a name for fuzzy comparison (lowercase, trim, remove accents/extra spaces)
 */
function normalizeNameForComparison(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\s+/g, ' ');
}

/**
 * Compare two names and return whether they match
 */
function namesMatch(localName: string, providerName: string): boolean {
  const a = normalizeNameForComparison(localName);
  const b = normalizeNameForComparison(providerName);

  if (!a || !b) return false;
  if (a === b) return true;

  // Check if one contains the other (handles "John Smith" vs "John Adam Smith")
  if (a.includes(b) || b.includes(a)) return true;

  // Check if last names match (common for first-name variations)
  const aLast = a.split(' ').pop() || '';
  const bLast = b.split(' ').pop() || '';
  if (aLast === bLast && aLast.length > 2) return true;

  return false;
}

/**
 * Get the provider URL for a person, constructing it from the external ID and provider info.
 */
function buildProviderUrl(provider: BuiltInProvider, externalId: string, treeId?: string): string {
  switch (provider) {
    case 'ancestry':
      return treeId
        ? `https://www.ancestry.com/family-tree/person/tree/${treeId}/person/${externalId}/facts`
        : `https://www.ancestry.com/search/?name=${externalId}`;
    case 'familysearch':
      return `https://www.familysearch.org/tree/person/details/${externalId}`;
    case 'wikitree':
      return `https://www.wikitree.com/wiki/${externalId}`;
    default:
      return '';
  }
}

/**
 * Get the Ancestry tree ID from a person's augmentation data
 */
function getAncestryTreeId(personId: string): string | undefined {
  const augmentation = augmentationService.getAugmentation(personId);
  const ancestryPlatform = augmentation?.platforms?.find(p => p.platform === 'ancestry');
  if (!ancestryPlatform?.url) return undefined;
  const parsed = augmentationService.parseAncestryUrl(ancestryPlatform.url);
  return parsed?.treeId;
}

export const parentDiscoveryService = {
  /**
   * Discover provider IDs for a person's parents.
   *
   * Navigates to the person's page on the provider, extracts parent IDs + names,
   * matches them to local parents by role and name, and registers the discovered links.
   */
  async discoverParentIds(
    dbId: string,
    personId: string,
    provider: BuiltInProvider
  ): Promise<DiscoverParentsResult> {
    const result: DiscoverParentsResult = {
      personId,
      provider,
      discovered: [],
      skipped: [],
    };

    // Resolve canonical ID
    const canonicalId = idMappingService.resolveId(personId, 'familysearch') || personId;

    // Get this person's external ID for the provider
    const externalId = idMappingService.getExternalId(canonicalId, provider);
    if (!externalId) {
      result.error = `Person ${personId} has no ${provider} external ID`;
      return result;
    }

    // Query parent_edge for this person's parents
    const parentEdges = sqliteService.queryAll<{
      parent_id: string;
      parent_role: string;
    }>(
      `SELECT parent_id, parent_role FROM parent_edge WHERE child_id = @childId ORDER BY parent_role`,
      { childId: canonicalId }
    );

    if (parentEdges.length === 0) {
      result.error = 'No parents found in local database';
      return result;
    }

    // Check which parents already have an external ID for this provider
    const parentsNeedingDiscovery: Array<{ parentId: string; role: string; name: string }> = [];

    for (const edge of parentEdges) {
      const existingExtId = idMappingService.getExternalId(edge.parent_id, provider);
      if (existingExtId) {
        result.skipped.push({
          parentId: edge.parent_id,
          parentRole: edge.parent_role,
          reason: 'already_linked',
        });
        continue;
      }

      // Get parent name from local database
      const parent = await databaseService.getPerson(dbId, edge.parent_id).catch(() => null);
      const parentName = parent?.name || '';

      parentsNeedingDiscovery.push({
        parentId: edge.parent_id,
        role: edge.parent_role,
        name: parentName,
      });
    }

    if (parentsNeedingDiscovery.length === 0) {
      return result;
    }

    // Ensure authenticated with provider (handles browser connection + login)
    const authResult = await providerService.ensureAuthenticated(provider);
    if (!authResult.authenticated) {
      result.error = authResult.error || `Not authenticated with ${provider}`;
      return result;
    }

    // Get scraper and verify it supports parent extraction
    const scraper = getScraper(provider);
    if (!scraper.extractParentIds) {
      result.error = `${provider} scraper does not support parent extraction`;
      return result;
    }

    // For Ancestry, we need a tree ID - get it from augmentation
    let treeId: string | undefined;
    if (provider === 'ancestry') {
      treeId = getAncestryTreeId(personId) || getAncestryTreeId(canonicalId);
    }

    // Build the person URL and navigate worker page to it
    // (Ancestry scraper reads tree ID from the page URL before navigating to facts)
    const personUrl = buildProviderUrl(provider, externalId, treeId);
    logger.start('discover', `🔍 Discovering ${provider} parent IDs for ${personId} from ${personUrl}`);

    const page = await browserService.getWorkerPage(personUrl);

    // Extract parent IDs from the provider page (scraper navigates and waits internally)
    const scrapedParents = await scraper.extractParentIds(page, externalId);

    if (!scrapedParents.fatherId && !scrapedParents.motherId) {
      // No parents found on provider page
      for (const parent of parentsNeedingDiscovery) {
        result.skipped.push({
          parentId: parent.parentId,
          parentRole: parent.role,
          reason: 'not_found_on_provider',
        });
      }
      logger.data('discover', `No parents found on ${provider} page for ${externalId}`);
      return result;
    }

    logger.data('discover', `Scraped parents: father=${scrapedParents.fatherId}(${scrapedParents.fatherName}), mother=${scrapedParents.motherId}(${scrapedParents.motherName})`);

    // Match scraped parents to local parents by role
    for (const parent of parentsNeedingDiscovery) {
      let matchedExternalId: string | undefined;
      let matchedName: string | undefined;

      if (parent.role === 'father' && scrapedParents.fatherId) {
        matchedExternalId = scrapedParents.fatherId;
        matchedName = scrapedParents.fatherName;
      } else if (parent.role === 'mother' && scrapedParents.motherId) {
        matchedExternalId = scrapedParents.motherId;
        matchedName = scrapedParents.motherName;
      }

      if (!matchedExternalId) {
        result.skipped.push({
          parentId: parent.parentId,
          parentRole: parent.role,
          reason: 'not_found_on_provider',
        });
        continue;
      }

      // Verify by name comparison
      const nameMatch = matchedName && parent.name
        ? namesMatch(parent.name, matchedName)
        : false;

      const confidence = nameMatch ? 1.0 : 0.7;

      // Register the external ID
      const providerUrl = buildProviderUrl(provider, matchedExternalId, treeId);

      idMappingService.registerExternalId(parent.parentId, provider, matchedExternalId, {
        url: providerUrl,
        confidence,
      });

      augmentationService.addPlatform(parent.parentId, provider, providerUrl, matchedExternalId);

      result.discovered.push({
        parentId: parent.parentId,
        parentRole: parent.role,
        parentName: parent.name,
        externalId: matchedExternalId,
        providerUrl,
        confidence,
        nameMatch,
      });

      logger.done('discover', `🔗 Linked ${parent.role} ${parent.name} → ${provider}:${matchedExternalId} (confidence: ${confidence})`);
    }

    return result;
  },

  /**
   * Discover provider IDs for ancestors by BFS traversal upward.
   *
   * Starting from a person, discovers parent IDs, then traverses upward
   * to discover grandparents, great-grandparents, etc.
   */
  async discoverAncestorIds(
    dbId: string,
    personId: string,
    provider: BuiltInProvider,
    maxGenerations = 50
  ): Promise<DiscoverAncestorsResult> {
    const result: DiscoverAncestorsResult = {
      provider,
      totalDiscovered: 0,
      totalSkipped: 0,
      totalErrors: 0,
      generationsTraversed: 0,
      personsVisited: 0,
      results: [],
    };

    const visited = new Set<string>();
    const queue: Array<{ id: string; generation: number }> = [{ id: personId, generation: 0 }];
    const delays = PROVIDER_DEFAULTS[provider].rateLimitDefaults;

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.id) || current.generation > maxGenerations) {
        continue;
      }

      visited.add(current.id);
      result.personsVisited++;

      if (current.generation > result.generationsTraversed) {
        result.generationsTraversed = current.generation;
      }

      // Discover parent IDs for current person
      const discoverResult = await this.discoverParentIds(dbId, current.id, provider);
      result.results.push(discoverResult);

      if (discoverResult.error) {
        result.totalErrors++;
      }

      result.totalDiscovered += discoverResult.discovered.length;
      result.totalSkipped += discoverResult.skipped.length;

      // Add discovered parents (and already-linked parents) to the queue
      const canonicalId = idMappingService.resolveId(current.id, 'familysearch') || current.id;
      const parentEdges = sqliteService.queryAll<{ parent_id: string }>(
        `SELECT parent_id FROM parent_edge WHERE child_id = @childId`,
        { childId: canonicalId }
      );

      for (const edge of parentEdges) {
        if (!visited.has(edge.parent_id)) {
          // Only add to queue if this parent now has the provider ID
          const hasProviderLink = !!idMappingService.getExternalId(edge.parent_id, provider);
          if (hasProviderLink) {
            queue.push({ id: edge.parent_id, generation: current.generation + 1 });
          }
        }
      }

      // Rate limiting between requests
      if (queue.length > 0) {
        const delay = delays.minDelayMs + Math.random() * (delays.maxDelayMs - delays.minDelayMs);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    logger.done('discover', `🏁 Ancestor discovery complete: ${result.totalDiscovered} linked, ${result.personsVisited} visited, ${result.generationsTraversed} generations`);

    return result;
  },

  /**
   * Check if a person's parents need discovery for a given provider.
   * Returns true if the person is linked to the provider but at least one
   * parent exists locally without a corresponding provider link.
   */
  checkParentsNeedDiscovery(canonicalId: string, provider: BuiltInProvider): boolean {
    // Get this person's parents
    const parentEdges = sqliteService.queryAll<{ parent_id: string }>(
      `SELECT parent_id FROM parent_edge WHERE child_id = @childId`,
      { childId: canonicalId }
    );

    if (parentEdges.length === 0) return false;

    // Check if any parent lacks the provider's external ID
    for (const edge of parentEdges) {
      const extId = idMappingService.getExternalId(edge.parent_id, provider);
      if (!extId) return true;
    }

    return false;
  },
};
