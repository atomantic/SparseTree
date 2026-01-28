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
import { PROVIDER_DEFAULTS } from './scrapers/base.scraper.js';
import { logger } from '../lib/logger.js';

// In-memory cancellation flags keyed by operationId
const cancelledOperations = new Set<string>();

// Track running operation (only one at a time)
let activeOperationId: string | null = null;

let operationCounter = 0;

function generateOperationId(): string {
  operationCounter++;
  return `bulk-discover-${Date.now()}-${operationCounter}`;
}

/**
 * Discover missing provider links for all persons in a database.
 * Yields BulkDiscoveryProgress events for SSE streaming.
 */
async function* discoverAllMissingLinks(
  dbId: string,
  provider: BuiltInProvider,
): AsyncGenerator<BulkDiscoveryProgress> {
  const operationId = generateOperationId();
  activeOperationId = operationId;
  cancelledOperations.delete(operationId);

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

  // Get all parent linkage gaps for this provider
  const gaps = integrityService.getParentLinkageGaps(dbId, provider);

  // Deduplicate by childId - one scrape discovers both parents
  const uniqueChildIds = [...new Set(gaps.map(g => g.childId))];
  const total = uniqueChildIds.length;

  logger.data('bulk-discover', `Found ${total} unique children needing parent discovery for ${provider}`);

  if (total === 0) {
    activeOperationId = null;
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
    if (cancelledOperations.has(operationId)) {
      logger.warn('bulk-discover', `Operation ${operationId} cancelled at ${current}/${total}`);
      activeOperationId = null;
      cancelledOperations.delete(operationId);
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

  activeOperationId = null;

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

/**
 * Request cancellation of the active bulk discovery operation
 */
function requestCancel(): boolean {
  if (!activeOperationId) return false;
  cancelledOperations.add(activeOperationId);
  logger.warn('bulk-discover', `Cancellation requested for ${activeOperationId}`);
  return true;
}

/**
 * Check if a bulk discovery operation is currently running
 */
function isRunning(): boolean {
  return activeOperationId !== null;
}

/**
 * Get the active operation ID if one is running
 */
function getActiveOperationId(): string | null {
  return activeOperationId;
}

export const bulkDiscoveryService = {
  discoverAllMissingLinks,
  requestCancel,
  isRunning,
  getActiveOperationId,
};
