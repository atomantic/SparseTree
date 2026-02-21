/**
 * Ancestry Update Service
 *
 * Orchestrates BFS traversal of ancestors to synchronize with Ancestry.com.
 * Processes free hints, ensures records exist, and downloads provider data.
 */

import type { AncestryUpdateProgress } from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';
import { augmentationService } from './augmentation.service.js';
import { ancestryHintsService } from './ancestry-hints.service.js';
import { providerService } from './provider.service.js';
import { browserService } from './browser.service.js';
import { multiPlatformComparisonService } from './multi-platform-comparison.service.js';
import { logger } from '../lib/logger.js';
import { createOperationTracker } from '../utils/operationTracker.js';

const tracker = createOperationTracker('ancestry-update');
let activeProgress: AncestryUpdateProgress | null = null;

interface QueuedPerson {
  personId: string;
  personName: string;
  generation: number;
}

interface QueueBuildResult {
  queue: QueuedPerson[];
  maxGeneration: number;
}

/**
 * Build a BFS queue from the local database starting at rootPersonId.
 * Only follows parent_edge table, not external provider data.
 */
function buildQueueFromDatabase(
  dbId: string,
  rootPersonId: string,
  maxGenerations: number | 'full'
): QueueBuildResult {
  const maxGen = maxGenerations === 'full' ? 100 : maxGenerations;
  const visited = new Set<string>();
  const queue: QueuedPerson[] = [];

  // BFS: start with root
  const bfsQueue: Array<{ personId: string; generation: number }> = [
    { personId: rootPersonId, generation: 0 }
  ];

  while (bfsQueue.length > 0) {
    const current = bfsQueue.shift()!;

    if (visited.has(current.personId)) continue;
    if (current.generation > maxGen) continue;

    visited.add(current.personId);

    // Get person name
    const person = sqliteService.queryOne<{ display_name: string }>(
      'SELECT display_name FROM person WHERE person_id = @personId',
      { personId: current.personId }
    );

    if (!person) continue;

    queue.push({
      personId: current.personId,
      personName: person.display_name,
      generation: current.generation,
    });

    // Get parents from parent_edge table
    const parents = sqliteService.queryAll<{ parent_id: string; parent_role: string }>(
      'SELECT parent_id, parent_role FROM parent_edge WHERE child_id = @personId',
      { personId: current.personId }
    );

    for (const parent of parents) {
      if (!visited.has(parent.parent_id)) {
        bfsQueue.push({
          personId: parent.parent_id,
          generation: current.generation + 1,
        });
      }
    }
  }

  const actualMaxGen = queue.reduce((max, p) => Math.max(max, p.generation), 0);

  return { queue, maxGeneration: actualMaxGen };
}

/**
 * Check if a person has an Ancestry link.
 * Returns the Ancestry URL if linked, null otherwise.
 */
function getAncestryLink(personId: string): { url: string; treeId: string; ancestryPersonId: string } | null {
  const augmentation = augmentationService.getAugmentation(personId);
  const ancestryPlatform = augmentation?.platforms?.find(p => p.platform === 'ancestry');

  if (!ancestryPlatform?.url) return null;

  const parsed = augmentationService.parseAncestryUrl(ancestryPlatform.url);
  if (!parsed) return null;

  return {
    url: ancestryPlatform.url,
    treeId: parsed.treeId,
    ancestryPersonId: parsed.ancestryPersonId,
  };
}

/**
 * Get the count of parents in the queue for a person.
 */
function countParentsInQueue(personId: string, visited: Set<string>): number {
  const parents = sqliteService.queryAll<{ parent_id: string }>(
    'SELECT parent_id FROM parent_edge WHERE child_id = @personId',
    { personId }
  );

  return parents.filter(p => !visited.has(p.parent_id)).length;
}

/**
 * Create a log entry object.
 */
function makeLogEntry(
  level: string,
  emoji: string,
  message: string
): { timestamp: string; level: string; emoji: string; message: string } {
  return {
    timestamp: new Date().toISOString(),
    level,
    emoji,
    message,
  };
}

/**
 * Main update generator - processes persons in BFS order, yielding progress events.
 */
async function* runAncestryUpdate(
  dbId: string,
  rootPersonId: string,
  maxGenerations: number | 'full',
  isTestMode: boolean = false
): AsyncGenerator<AncestryUpdateProgress> {
  const operationId = tracker.generateId();
  tracker.start(operationId);

  const stats = {
    recordsLinked: 0,
    hintsProcessed: 0,
    dataDownloaded: 0,
    parentsQueued: 0,
    skipped: 0,
    errors: 0,
  };

  // Initial progress state
  const baseProgress: Omit<AncestryUpdateProgress, 'type' | 'message'> = {
    operationId,
    dbId,
    queueSize: 0,
    processedCount: 0,
    currentGeneration: 0,
    maxGenerations,
    stats,
  };

  // Yield started event
  activeProgress = {
    ...baseProgress,
    type: 'started',
    message: 'Starting Ancestry update...',
    logEntry: makeLogEntry('info', '🚀', `Starting update for ${rootPersonId}, depth=${maxGenerations}`),
  };
  yield activeProgress;

  logger.start('ancestry-update', `Starting update for root ${rootPersonId}, depth=${maxGenerations}`);

  // Verify browser connection
  const isConnected = await browserService.verifyAndReconnect();
  if (!isConnected) {
    tracker.finish();
    activeProgress = null;
    yield {
      ...baseProgress,
      type: 'error',
      message: 'Browser not connected',
      logEntry: makeLogEntry('error', '❌', 'Browser not connected'),
    };
    return;
  }

  // Check Ancestry authentication
  const authResult = await providerService.ensureAuthenticated('ancestry');
  if (!authResult.authenticated) {
    tracker.finish();
    activeProgress = null;
    yield {
      ...baseProgress,
      type: 'error',
      message: authResult.error || 'Not authenticated with Ancestry',
      logEntry: makeLogEntry('error', '❌', authResult.error || 'Not authenticated with Ancestry'),
    };
    return;
  }

  // Build the queue from local database
  const { queue, maxGeneration } = buildQueueFromDatabase(dbId, rootPersonId, maxGenerations);

  if (queue.length === 0) {
    tracker.finish();
    activeProgress = null;
    yield {
      ...baseProgress,
      type: 'error',
      message: 'No persons found in queue',
      logEntry: makeLogEntry('error', '❌', 'No persons found in database'),
    };
    return;
  }

  baseProgress.queueSize = queue.length;
  baseProgress.maxGenerations = maxGenerations === 'full' ? maxGeneration : maxGenerations;

  activeProgress = {
    ...baseProgress,
    type: 'queue_built',
    message: `Built queue: ${queue.length} persons across ${maxGeneration} generations`,
    logEntry: makeLogEntry('info', '📋', `Built queue: ${queue.length} persons across ${maxGeneration} generations`),
  };
  yield activeProgress;

  logger.data('ancestry-update', `Built queue: ${queue.length} persons across ${maxGeneration} generations`);

  const visited = new Set<string>();

  // Process each person in queue order
  for (let i = 0; i < queue.length; i++) {
    // Check for cancellation
    if (tracker.isCancelled(operationId)) {
      tracker.finish();
      activeProgress = null;
      logger.warn('ancestry-update', `Cancelled at ${i + 1}/${queue.length} persons`);
      yield {
        ...baseProgress,
        type: 'cancelled',
        processedCount: i,
        stats,
        message: `Cancelled after processing ${i} persons`,
        logEntry: makeLogEntry('warn', '⚠', `Cancelled at ${i + 1}/${queue.length} persons`),
      };
      return;
    }

    const person = queue[i];
    visited.add(person.personId);

    // Yield person_started event
    activeProgress = {
      ...baseProgress,
      type: 'person_started',
      processedCount: i,
      currentGeneration: person.generation,
      currentPerson: {
        personId: person.personId,
        personName: person.personName,
        generation: person.generation,
      },
      stats,
      message: `Processing ${person.personName} (gen ${person.generation}, ${i + 1}/${queue.length})`,
      logEntry: makeLogEntry('info', '🔍', `Processing ${person.personName} (gen ${person.generation}, ${i + 1}/${queue.length})`),
    };
    yield activeProgress;

    logger.browser('ancestry-update', `Processing ${person.personName} (gen ${person.generation}, ${i + 1}/${queue.length})`);

    // Step 1: Check if person has Ancestry link
    const ancestryLink = getAncestryLink(person.personId);

    activeProgress = {
      ...baseProgress,
      type: 'step_complete',
      processedCount: i,
      currentGeneration: person.generation,
      currentPerson: {
        personId: person.personId,
        personName: person.personName,
        generation: person.generation,
      },
      currentStep: 'ensureRecord',
      stepMessage: ancestryLink ? 'Ancestry record exists' : 'No Ancestry link',
      stats,
      message: ancestryLink ? 'Ancestry record exists' : 'No Ancestry link - skipping hints',
      logEntry: makeLogEntry(
        ancestryLink ? 'success' : 'warn',
        ancestryLink ? '✓' : '⚠',
        `${person.personName}: ${ancestryLink ? 'Ancestry record exists' : 'No Ancestry link - skipping hints'}`
      ),
    };
    yield activeProgress;

    if (ancestryLink) {
      stats.recordsLinked++;
    }

    // Step 2: Process free hints (only if has Ancestry link and not test mode)
    if (ancestryLink && !isTestMode) {
      const hintResult = await ancestryHintsService.processPersonHints(person.personId).catch(err => {
        logger.error('ancestry-update', `Error processing hints for ${person.personName}: ${err.message}`);
        return {
          personId: person.personId,
          treeId: ancestryLink.treeId,
          hintsFound: 0,
          hintsProcessed: 0,
          hintsSkipped: 0,
          errors: [err.message],
        };
      });

      stats.hintsProcessed += hintResult.hintsProcessed;

      activeProgress = {
        ...baseProgress,
        type: 'step_complete',
        processedCount: i,
        currentGeneration: person.generation,
        currentPerson: {
          personId: person.personId,
          personName: person.personName,
          generation: person.generation,
        },
        currentStep: 'processHints',
        stepMessage: hintResult.hintsProcessed > 0
          ? `Processed ${hintResult.hintsProcessed} hints`
          : (hintResult.hintsFound === 0 ? 'No free hints' : 'No hints processed'),
        stats,
        message: `Hints: ${hintResult.hintsProcessed}/${hintResult.hintsFound} processed`,
        logEntry: makeLogEntry(
          hintResult.hintsProcessed > 0 ? 'success' : 'info',
          hintResult.hintsProcessed > 0 ? '✓' : '📋',
          `${person.personName}: ${hintResult.hintsProcessed > 0 ? `${hintResult.hintsProcessed} hints processed` : 'No free hints'}`
        ),
      };
      yield activeProgress;
    } else if (!ancestryLink) {
      stats.skipped++;
      activeProgress = {
        ...baseProgress,
        type: 'step_complete',
        processedCount: i,
        currentGeneration: person.generation,
        currentPerson: {
          personId: person.personId,
          personName: person.personName,
          generation: person.generation,
        },
        currentStep: 'processHints',
        stepMessage: 'Skipped (no Ancestry link)',
        stats,
        message: 'Skipped hints (no Ancestry link)',
        logEntry: makeLogEntry('skip', '⏭', `${person.personName}: Skipped hints (no Ancestry link)`),
      };
      yield activeProgress;
    }

    // Step 3: Download provider data if person has Ancestry link
    let dataDownloaded = false;
    let downloadMessage: string;

    if (ancestryLink && !isTestMode) {
      // Check if data is already cached
      const cachedData = multiPlatformComparisonService.getCachedProviderDataForPerson(person.personId);

      if (cachedData.ancestry) {
        dataDownloaded = true;
        downloadMessage = 'Provider data already cached';
      } else {
        // Download/scrape the Ancestry data
        const refreshResult = await multiPlatformComparisonService
          .refreshFromProvider(dbId, person.personId, 'ancestry')
          .catch(err => {
            logger.error('ancestry-update', `Error downloading data for ${person.personName}: ${err.message}`);
            return null;
          });

        if (refreshResult) {
          dataDownloaded = true;
          downloadMessage = 'Downloaded Ancestry data';
        } else {
          downloadMessage = 'Failed to download data';
        }
      }
    } else if (!ancestryLink) {
      downloadMessage = 'Skipped (no Ancestry link)';
    } else {
      downloadMessage = 'Skipped (test mode)';
    }

    if (dataDownloaded) {
      stats.dataDownloaded++;
    }

    activeProgress = {
      ...baseProgress,
      type: 'step_complete',
      processedCount: i,
      currentGeneration: person.generation,
      currentPerson: {
        personId: person.personId,
        personName: person.personName,
        generation: person.generation,
      },
      currentStep: 'downloadData',
      stepMessage: downloadMessage,
      stats,
      message: downloadMessage,
      logEntry: makeLogEntry(
        dataDownloaded ? 'success' : 'info',
        dataDownloaded ? '📥' : '📭',
        `${person.personName}: ${downloadMessage}`
      ),
    };
    yield activeProgress;

    // Step 4: Report parents queued
    const parentsInQueue = countParentsInQueue(person.personId, visited);
    stats.parentsQueued += parentsInQueue;

    activeProgress = {
      ...baseProgress,
      type: 'step_complete',
      processedCount: i,
      currentGeneration: person.generation,
      currentPerson: {
        personId: person.personId,
        personName: person.personName,
        generation: person.generation,
      },
      currentStep: 'queueParents',
      stepMessage: parentsInQueue > 0 ? `${parentsInQueue} parents queued` : 'No parents in queue',
      stats,
      message: parentsInQueue > 0 ? `${parentsInQueue} parents queued` : 'No parents in queue',
      logEntry: makeLogEntry(
        'info',
        '👨‍👩‍👦',
        `${person.personName}: ${parentsInQueue > 0 ? `${parentsInQueue} parents queued` : 'No parents in queue'}`
      ),
    };
    yield activeProgress;

    // Yield person_complete event
    activeProgress = {
      ...baseProgress,
      type: 'person_complete',
      processedCount: i + 1,
      currentGeneration: person.generation,
      currentPerson: {
        personId: person.personId,
        personName: person.personName,
        generation: person.generation,
      },
      stats,
      message: `Completed ${person.personName}`,
      logEntry: makeLogEntry('success', '✅', `Completed ${person.personName}`),
    };
    yield activeProgress;
  }

  // All done
  tracker.finish();
  activeProgress = null;

  logger.done('ancestry-update', `Completed: ${queue.length} persons, ${stats.hintsProcessed} hints processed`);

  yield {
    ...baseProgress,
    type: 'completed',
    processedCount: queue.length,
    stats,
    message: `Completed: ${queue.length} persons, ${stats.hintsProcessed} hints processed`,
    logEntry: makeLogEntry(
      'success',
      '✅',
      `Completed: ${queue.length}/${queue.length} persons, ${stats.hintsProcessed} hints processed`
    ),
  };
}

/**
 * Get current progress status.
 */
function getStatus(): { running: boolean; operationId: string | null; progress: AncestryUpdateProgress | null } {
  return {
    running: tracker.isRunning(),
    operationId: tracker.getActiveId(),
    progress: activeProgress,
  };
}

/**
 * Validate that a person can be used as a root for Ancestry update.
 * Returns validation info including whether the person has an Ancestry link.
 */
function validateRoot(
  dbId: string,
  personId: string
): { valid: boolean; hasAncestryLink: boolean; personName: string; error?: string } {
  // Resolve person ID
  const canonicalId = idMappingService.resolveId(personId, 'familysearch') || personId;

  // Check if person exists
  const person = sqliteService.queryOne<{ display_name: string }>(
    'SELECT display_name FROM person WHERE person_id = @personId',
    { personId: canonicalId }
  );

  if (!person) {
    return {
      valid: false,
      hasAncestryLink: false,
      personName: '',
      error: 'Person not found',
    };
  }

  // Check for Ancestry link
  const ancestryLink = getAncestryLink(canonicalId);

  return {
    valid: true,
    hasAncestryLink: !!ancestryLink,
    personName: person.display_name,
  };
}

export const ancestryUpdateService = {
  runAncestryUpdate,
  requestCancel: () => {
    const result = tracker.requestCancel();
    if (result) logger.warn('ancestry-update', `Cancellation requested for ${tracker.getActiveId()}`);
    return result;
  },
  isRunning: () => tracker.isRunning(),
  getActiveOperationId: () => tracker.getActiveId(),
  getStatus,
  validateRoot,
};
