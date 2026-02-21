/**
 * Bulk Discovery Service
 *
 * Orchestrates database-wide parent ID discovery across all persons
 * that have provider coverage gaps. Uses SSE-compatible async generator
 * for real-time progress. Supports cancellation.
 */

import type { BuiltInProvider, BulkDiscoveryProgress } from '@fsf/shared';
import { integrityService } from './integrity.service.js';
import { parentDiscoveryService } from './parent-discovery.service.js';
import { providerService } from './provider.service.js';
import { PROVIDER_DEFAULTS } from './scrapers/base.scraper.js';
import { logger } from '../lib/logger.js';
import { createOperationTracker } from '../utils/operationTracker.js';

const tracker = createOperationTracker('bulk-discover');

/**
 * Discover missing provider links for all persons in a database.
 * Yields BulkDiscoveryProgress events for SSE streaming.
 */
async function* discoverAllMissingLinks(
  dbId: string,
  provider: BuiltInProvider,
): AsyncGenerator<BulkDiscoveryProgress> {
  const operationId = tracker.generateId();
  tracker.start(operationId);

  const delays = PROVIDER_DEFAULTS[provider].rateLimitDefaults;

  logger.start('bulk-discover', `Starting bulk discovery for ${provider} in db ${dbId}`);

  yield {
    type: 'started',
    operationId,
    provider,
    current: 0,
    total: 0,
    discovered: 0,
    skipped: 0,
    errors: 0,
    message: 'Analyzing parent linkage gaps...',
  };

  // Pre-flight: ensure authenticated with provider
  const authResult = await providerService.ensureAuthenticated(provider);
  if (!authResult.authenticated) {
    tracker.finish();
    logger.error('bulk-discover', `Auth pre-flight failed for ${provider}: ${authResult.error}`);
    yield {
      type: 'error',
      operationId,
      provider,
      current: 0,
      total: 0,
      discovered: 0,
      skipped: 0,
      errors: 1,
      message: authResult.error || `Not authenticated with ${provider}`,
    };
    return;
  }

  // Get all parent linkage gaps for this provider
  const gaps = integrityService.getParentLinkageGaps(dbId, provider);

  // Deduplicate by childId - one scrape discovers both parents
  const uniqueChildIds = [...new Set(gaps.map(g => g.childId))];
  const total = uniqueChildIds.length;

  logger.data('bulk-discover', `Found ${total} unique children needing parent discovery for ${provider}`);

  if (total === 0) {
    tracker.finish();
    yield {
      type: 'completed',
      operationId,
      provider,
      current: 0,
      total: 0,
      discovered: 0,
      skipped: 0,
      errors: 0,
      message: 'No parent linkage gaps found.',
    };
    return;
  }

  let current = 0;
  let discovered = 0;
  let skipped = 0;
  let errors = 0;

  for (const childId of uniqueChildIds) {
    // Check cancellation
    if (tracker.isCancelled(operationId)) {
      logger.warn('bulk-discover', `Operation ${operationId} cancelled at ${current}/${total}`);
      tracker.finish();
      yield {
        type: 'cancelled',
        operationId,
        provider,
        current,
        total,
        discovered,
        skipped,
        errors,
        message: `Cancelled after processing ${current} of ${total} persons.`,
      };
      return;
    }

    current++;

    // Find the child's name from the gaps
    const gap = gaps.find(g => g.childId === childId);
    const childName = gap?.childName || childId;

    yield {
      type: 'progress',
      operationId,
      provider,
      current,
      total,
      discovered,
      skipped,
      errors,
      currentPerson: childName,
      message: `Discovering parents for ${childName} (${current}/${total})`,
    };

    // Discover parent IDs for this child
    const result = await parentDiscoveryService.discoverParentIds(dbId, childId, provider)
      .catch(err => ({
        personId: childId,
        provider,
        discovered: [],
        skipped: [],
        error: err.message,
      }));

    if (result.error && result.discovered.length === 0) {
      errors++;
      logger.error('bulk-discover', `Error discovering parents for ${childName}: ${result.error}`);
    } else {
      discovered += result.discovered.length;
      skipped += result.skipped.length;
    }

    // Rate limiting between requests
    if (current < total) {
      const delay = delays.minDelayMs + Math.random() * (delays.maxDelayMs - delays.minDelayMs);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  tracker.finish();

  logger.done('bulk-discover', `Bulk discovery complete: ${discovered} linked, ${skipped} skipped, ${errors} errors out of ${total} persons`);

  yield {
    type: 'completed',
    operationId,
    provider,
    current: total,
    total,
    discovered,
    skipped,
    errors,
    message: `Discovery complete. ${discovered} parent links discovered, ${skipped} skipped, ${errors} errors.`,
  };
}

export const bulkDiscoveryService = {
  discoverAllMissingLinks,
  requestCancel: () => {
    const result = tracker.requestCancel();
    if (result) logger.warn('bulk-discover', `Cancellation requested for ${tracker.getActiveId()}`);
    return result;
  },
  isRunning: () => tracker.isRunning(),
  getActiveOperationId: () => tracker.getActiveId(),
};
