/**
 * Ancestry Free Hints Automation Service
 *
 * Automates the processing of free hints on Ancestry.com.
 * Supports both single-person hint processing and batch processing via BFS traversal.
 */

import type { Page } from 'playwright';
import type { AncestryHintProgress, AncestryHintResult } from '@fsf/shared';
import { browserService } from './browser.service.js';
import { augmentationService } from './augmentation.service.js';
import { providerService } from './provider.service.js';
import { PROVIDER_DEFAULTS } from './scrapers/base.scraper.js';
import { logger } from '../lib/logger.js';

// In-memory cancellation flags keyed by operationId
const cancelledOperations = new Set<string>();

// Track running operation (only one at a time)
let activeOperationId: string | null = null;

let operationCounter = 0;

function generateOperationId(): string {
  operationCounter++;
  return `ancestry-hints-${Date.now()}-${operationCounter}`;
}

// Resilient multi-selector approach for Ancestry hint processing
const HINTS_SELECTORS = {
  // Hint cards on the hints page
  hintCard: '[data-testid="hint-card"], .hintCard, [class*="hint-card"], .recordHint, [data-testid="record-hint"], .hint-record-card',
  // The Review button on a hint card
  reviewButton: 'button:has-text("Review"), [data-testid="review-hint-button"], a:has-text("Review")',
  // "Yes" button to save the hint
  saveYesButton: 'button:has-text("Yes"), [data-testid="save-yes-button"]',
  // Checkboxes for adding related people (more specific - only in person/relationship sections)
  addRelatedCheckbox: '[data-testid="add-person-checkbox"]:not(:checked), .addPersonCheckbox:not(:checked), [class*="person-checkbox"]:not(:checked)',
  // Save to tree button - more specific to avoid matching other save buttons
  saveToTreeButton: 'button:has-text("Save to tree"), button:has-text("Save to Tree"), [data-testid="save-to-tree-button"]',
  // Fallback save button if specific one not found
  saveButtonFallback: "button:has-text(\"Save\"):not(:has-text(\"Don't\"))",
  // Indicator that there are no hints
  noHintsIndicator: ':has-text("No hints"), :has-text("no free hints"), :has-text("No record hints")',
  // Free hints filter might already be applied, check for "Free" indicator
  freeHintBadge: '.free-badge, [data-testid="free-hint"], :has-text("Free")',
  // Loading indicator
  loadingIndicator: '.loading, [data-testid="loading"], .spinner',
  // Modal/dialog container
  modalContainer: '[role="dialog"], .modal, [data-testid="hint-modal"]',
};

/**
 * Wait for hints page to fully load
 */
async function waitForHintsPageLoad(page: Page): Promise<void> {
  await page.waitForTimeout(2000);

  // Wait for loading to finish
  const loadingEl = await page.$(HINTS_SELECTORS.loadingIndicator).catch(() => null);
  if (loadingEl) {
    await page.waitForSelector(HINTS_SELECTORS.loadingIndicator, { state: 'hidden', timeout: 10000 }).catch(() => null);
  }

  await page.waitForTimeout(1000);
}

/**
 * Check if we're on a login/auth page
 */
function isAuthPage(url: string): boolean {
  return url.includes('/account/signin') || url.includes('/login') || url.includes('/auth/');
}

/**
 * Process a single hint - review and save it
 */
async function processHint(page: Page, hintIndex: number): Promise<{ processed: boolean; error?: string }> {
  logger.browser('ancestry-hints', `Processing hint ${hintIndex + 1}...`);

  // Find and click the Review button on the hint card
  const hintCards = await page.$$(HINTS_SELECTORS.hintCard);
  if (hintIndex >= hintCards.length) {
    return { processed: false, error: 'Hint card not found' };
  }

  const hintCard = hintCards[hintIndex];

  // Look for Review button within the hint card
  const reviewButton = await hintCard.$('button:has-text("Review"), a:has-text("Review")').catch(() => null);
  if (!reviewButton) {
    logger.warn('ancestry-hints', `No Review button found on hint ${hintIndex + 1}`);
    return { processed: false, error: 'Review button not found' };
  }

  // Click the Review button
  await reviewButton.click();
  await page.waitForTimeout(2000);

  // Wait for the review modal/page to load
  await page.waitForSelector(HINTS_SELECTORS.modalContainer, { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(1500);

  // Look for "Yes" button to save the information
  const yesButton = await page.$(HINTS_SELECTORS.saveYesButton).catch(() => null);
  if (yesButton) {
    const isVisible = await yesButton.isVisible().catch(() => false);
    if (isVisible) {
      await yesButton.click();
      await page.waitForTimeout(1500);
    }
  }

  // Try to check "Add" checkboxes for related people (if any exist)
  // Only check visible checkboxes with specific selectors to avoid scroll loops
  const checkboxes = await page.$$(HINTS_SELECTORS.addRelatedCheckbox);
  if (checkboxes.length > 0 && checkboxes.length < 10) {
    // Only process if we have a reasonable number (avoid infinite lists)
    logger.browser('ancestry-hints', `Found ${checkboxes.length} related person checkboxes`);
    for (const checkbox of checkboxes) {
      const isVisible = await checkbox.isVisible().catch(() => false);
      const box = await checkbox.boundingBox().catch(() => null);
      // Only click if visible and has actual size (not hidden)
      if (isVisible && box && box.width > 0 && box.height > 0) {
        await checkbox.click().catch(() => null);
        await page.waitForTimeout(300);
      }
    }
  } else if (checkboxes.length >= 10) {
    logger.warn('ancestry-hints', `Too many checkboxes (${checkboxes.length}), skipping to avoid loops`);
  }

  // Click "Save to tree" button - try specific selector first, then fallback
  let saveButton = await page.$(HINTS_SELECTORS.saveToTreeButton).catch(() => null);
  if (!saveButton) {
    saveButton = await page.$(HINTS_SELECTORS.saveButtonFallback).catch(() => null);
  }

  if (saveButton) {
    const isVisible = await saveButton.isVisible().catch(() => false);
    if (isVisible) {
      logger.browser('ancestry-hints', `Clicking Save to tree button`);
      await saveButton.click();
      await page.waitForTimeout(2000);

      // Wait for save confirmation or modal to close
      await page.waitForSelector(HINTS_SELECTORS.modalContainer, { state: 'hidden', timeout: 10000 }).catch(() => null);
    } else {
      logger.warn('ancestry-hints', `Save button found but not visible`);
    }
  } else {
    logger.warn('ancestry-hints', `No Save to tree button found`);
  }

  logger.ok('ancestry-hints', `Hint ${hintIndex + 1} processed successfully`);
  return { processed: true };
}

/**
 * Process all free hints for a single person.
 * Returns the result with counts.
 */
async function processPersonHints(
  personId: string,
): Promise<AncestryHintResult> {
  // Get augmentation to find Ancestry URL
  const augmentation = augmentationService.getAugmentation(personId);
  const ancestryPlatform = augmentation?.platforms?.find(p => p.platform === 'ancestry');

  if (!ancestryPlatform?.url) {
    return {
      personId,
      treeId: '',
      hintsFound: 0,
      hintsProcessed: 0,
      hintsSkipped: 0,
      errors: ['Person not linked to Ancestry'],
    };
  }

  // Parse the Ancestry URL to get treeId and personId
  const parsed = augmentationService.parseAncestryUrl(ancestryPlatform.url);
  if (!parsed) {
    return {
      personId,
      treeId: '',
      hintsFound: 0,
      hintsProcessed: 0,
      hintsSkipped: 0,
      errors: ['Invalid Ancestry URL format'],
    };
  }

  const { treeId, ancestryPersonId } = parsed;
  const result: AncestryHintResult = {
    personId,
    treeId,
    hintsFound: 0,
    hintsProcessed: 0,
    hintsSkipped: 0,
    errors: [],
  };

  // Verify browser connection
  const isConnected = await browserService.verifyAndReconnect();
  if (!isConnected) {
    result.errors.push('Browser not connected');
    return result;
  }

  // Check authentication
  const authResult = await providerService.ensureAuthenticated('ancestry');
  if (!authResult.authenticated) {
    result.errors.push(authResult.error || 'Not authenticated with Ancestry');
    return result;
  }

  // Navigate to the hints page with free hints filter
  const hintsUrl = `https://www.ancestry.com/family-tree/person/tree/${treeId}/person/${ancestryPersonId}/hints?usePUBJs=true&Hints.hintStatus=Free`;

  logger.browser('ancestry-hints', `Navigating to hints page: ${hintsUrl}`);

  const page = await browserService.getWorkerPage(hintsUrl);
  await waitForHintsPageLoad(page);

  // Check if redirected to login
  if (isAuthPage(page.url())) {
    result.errors.push('Authentication required - please log in to Ancestry');
    return result;
  }

  // Check for "no hints" indicator first
  const noHintsEl = await page.$(HINTS_SELECTORS.noHintsIndicator).catch(() => null);
  if (noHintsEl) {
    const isVisible = await noHintsEl.isVisible().catch(() => false);
    if (isVisible) {
      logger.skip('ancestry-hints', `No free hints indicator found for person ${personId}`);
      return result;
    }
  }

  // Count hint cards that have a Review button (actual actionable hints)
  const hintCards = await page.$$(HINTS_SELECTORS.hintCard);
  let actualHintCount = 0;
  for (const card of hintCards) {
    const reviewBtn = await card.$('button:has-text("Review"), a:has-text("Review")').catch(() => null);
    if (reviewBtn) {
      const isVisible = await reviewBtn.isVisible().catch(() => false);
      if (isVisible) actualHintCount++;
    }
  }
  result.hintsFound = actualHintCount;

  logger.data('ancestry-hints', `Found ${result.hintsFound} actionable free hints for person ${personId}`);

  if (result.hintsFound === 0) {
    logger.skip('ancestry-hints', `No free hints available for person ${personId}`);
    return result;
  }

  // Process each hint
  const delays = PROVIDER_DEFAULTS.ancestry.rateLimitDefaults;
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 3;

  for (let i = 0; i < result.hintsFound; i++) {
    const hintResult = await processHint(page, 0); // Always process first card since they shift after processing

    if (hintResult.processed) {
      result.hintsProcessed++;
      consecutiveFailures = 0;
    } else {
      result.hintsSkipped++;
      consecutiveFailures++;
      if (hintResult.error) {
        result.errors.push(`Hint ${i + 1}: ${hintResult.error}`);
      }

      // Break out if too many consecutive failures (probably no more hints)
      if (consecutiveFailures >= maxConsecutiveFailures) {
        logger.warn('ancestry-hints', `Stopping after ${maxConsecutiveFailures} consecutive failures`);
        break;
      }
    }

    // Rate limiting between hints
    if (i < result.hintsFound - 1) {
      const delay = delays.minDelayMs + Math.random() * (delays.maxDelayMs - delays.minDelayMs);
      await page.waitForTimeout(delay);

      // Re-navigate to hints page to get fresh list after processing
      await page.goto(hintsUrl, { waitUntil: 'domcontentloaded' });
      await waitForHintsPageLoad(page);

      // Re-check if there are still hints available
      const remainingCards = await page.$$(HINTS_SELECTORS.hintCard);
      let remainingHints = 0;
      for (const card of remainingCards) {
        const reviewBtn = await card.$('button:has-text("Review"), a:has-text("Review")').catch(() => null);
        if (reviewBtn) {
          const isVisible = await reviewBtn.isVisible().catch(() => false);
          if (isVisible) remainingHints++;
        }
      }
      if (remainingHints === 0) {
        logger.data('ancestry-hints', `No more hints remaining after processing ${i + 1}`);
        break;
      }
    }
  }

  logger.done('ancestry-hints', `Processed ${result.hintsProcessed}/${result.hintsFound} hints for person ${personId}`);
  return result;
}

/**
 * Process hints for a person and yield progress events.
 * Suitable for SSE streaming.
 */
async function* processPersonHintsWithProgress(
  personId: string,
): AsyncGenerator<AncestryHintProgress> {
  const operationId = generateOperationId();
  activeOperationId = operationId;
  cancelledOperations.delete(operationId);

  // Get augmentation to find Ancestry URL
  const augmentation = augmentationService.getAugmentation(personId);
  const ancestryPlatform = augmentation?.platforms?.find(p => p.platform === 'ancestry');

  if (!ancestryPlatform?.url) {
    activeOperationId = null;
    yield {
      type: 'error',
      operationId,
      personId,
      treeId: '',
      current: 0,
      total: 0,
      hintsProcessed: 0,
      hintsSkipped: 0,
      errors: 1,
      message: 'Person not linked to Ancestry',
    };
    return;
  }

  // Parse the Ancestry URL
  const parsed = augmentationService.parseAncestryUrl(ancestryPlatform.url);
  if (!parsed) {
    activeOperationId = null;
    yield {
      type: 'error',
      operationId,
      personId,
      treeId: '',
      current: 0,
      total: 0,
      hintsProcessed: 0,
      hintsSkipped: 0,
      errors: 1,
      message: 'Invalid Ancestry URL format',
    };
    return;
  }

  const { treeId, ancestryPersonId } = parsed;

  yield {
    type: 'started',
    operationId,
    personId,
    treeId,
    current: 0,
    total: 0,
    hintsProcessed: 0,
    hintsSkipped: 0,
    errors: 0,
    message: 'Starting Ancestry hints processing...',
  };

  // Verify browser connection
  const isConnected = await browserService.verifyAndReconnect();
  if (!isConnected) {
    activeOperationId = null;
    yield {
      type: 'error',
      operationId,
      personId,
      treeId,
      current: 0,
      total: 0,
      hintsProcessed: 0,
      hintsSkipped: 0,
      errors: 1,
      message: 'Browser not connected',
    };
    return;
  }

  // Check authentication
  const authResult = await providerService.ensureAuthenticated('ancestry');
  if (!authResult.authenticated) {
    activeOperationId = null;
    yield {
      type: 'error',
      operationId,
      personId,
      treeId,
      current: 0,
      total: 0,
      hintsProcessed: 0,
      hintsSkipped: 0,
      errors: 1,
      message: authResult.error || 'Not authenticated with Ancestry',
    };
    return;
  }

  // Navigate to hints page
  const hintsUrl = `https://www.ancestry.com/family-tree/person/tree/${treeId}/person/${ancestryPersonId}/hints?usePUBJs=true&Hints.hintStatus=Free`;

  logger.browser('ancestry-hints', `Navigating to hints page: ${hintsUrl}`);

  const page = await browserService.getWorkerPage(hintsUrl);
  await waitForHintsPageLoad(page);

  // Check for login redirect
  if (isAuthPage(page.url())) {
    activeOperationId = null;
    yield {
      type: 'error',
      operationId,
      personId,
      treeId,
      current: 0,
      total: 0,
      hintsProcessed: 0,
      hintsSkipped: 0,
      errors: 1,
      message: 'Authentication required - please log in to Ancestry',
    };
    return;
  }

  // Check for "no hints" indicator first
  const noHintsEl = await page.$(HINTS_SELECTORS.noHintsIndicator).catch(() => null);
  if (noHintsEl) {
    const isVisible = await noHintsEl.isVisible().catch(() => false);
    if (isVisible) {
      activeOperationId = null;
      yield {
        type: 'completed',
        operationId,
        personId,
        treeId,
        current: 0,
        total: 0,
        hintsProcessed: 0,
        hintsSkipped: 0,
        errors: 0,
        message: 'No free hints available',
      };
      return;
    }
  }

  // Count hint cards that have a Review button (actual actionable hints)
  const hintCards = await page.$$(HINTS_SELECTORS.hintCard);
  let total = 0;
  for (const card of hintCards) {
    const reviewBtn = await card.$('button:has-text("Review"), a:has-text("Review")').catch(() => null);
    if (reviewBtn) {
      const isVisible = await reviewBtn.isVisible().catch(() => false);
      if (isVisible) total++;
    }
  }

  yield {
    type: 'hint_found',
    operationId,
    personId,
    treeId,
    current: 0,
    total,
    hintsProcessed: 0,
    hintsSkipped: 0,
    errors: 0,
    message: `Found ${total} free hints`,
  };

  if (total === 0) {
    activeOperationId = null;
    yield {
      type: 'completed',
      operationId,
      personId,
      treeId,
      current: 0,
      total: 0,
      hintsProcessed: 0,
      hintsSkipped: 0,
      errors: 0,
      message: 'No free hints available',
    };
    return;
  }

  let hintsProcessed = 0;
  let hintsSkipped = 0;
  let errors = 0;
  const delays = PROVIDER_DEFAULTS.ancestry.rateLimitDefaults;
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 3;

  for (let i = 0; i < total; i++) {
    // Check cancellation
    if (cancelledOperations.has(operationId)) {
      activeOperationId = null;
      cancelledOperations.delete(operationId);
      yield {
        type: 'cancelled',
        operationId,
        personId,
        treeId,
        current: i,
        total,
        hintsProcessed,
        hintsSkipped,
        errors,
        message: `Cancelled after processing ${i} of ${total} hints`,
      };
      return;
    }

    yield {
      type: 'progress',
      operationId,
      personId,
      treeId,
      current: i + 1,
      total,
      hintsProcessed,
      hintsSkipped,
      errors,
      currentHint: `Hint ${i + 1}`,
      message: `Processing hint ${i + 1} of ${total}...`,
    };

    const hintResult = await processHint(page, 0);

    if (hintResult.processed) {
      hintsProcessed++;
      consecutiveFailures = 0;
      yield {
        type: 'hint_processed',
        operationId,
        personId,
        treeId,
        current: i + 1,
        total,
        hintsProcessed,
        hintsSkipped,
        errors,
        currentHint: `Hint ${i + 1}`,
        message: `Hint ${i + 1} saved successfully`,
      };
    } else {
      hintsSkipped++;
      errors++;
      consecutiveFailures++;
      logger.warn('ancestry-hints', `Failed to process hint ${i + 1}: ${hintResult.error}`);

      // Break out if too many consecutive failures
      if (consecutiveFailures >= maxConsecutiveFailures) {
        logger.warn('ancestry-hints', `Stopping after ${maxConsecutiveFailures} consecutive failures`);
        break;
      }
    }

    // Rate limiting and re-navigate
    if (i < total - 1) {
      const delay = delays.minDelayMs + Math.random() * (delays.maxDelayMs - delays.minDelayMs);
      await page.waitForTimeout(delay);

      await page.goto(hintsUrl, { waitUntil: 'domcontentloaded' });
      await waitForHintsPageLoad(page);

      // Re-check if there are still hints available
      const remainingCards = await page.$$(HINTS_SELECTORS.hintCard);
      let remainingHints = 0;
      for (const card of remainingCards) {
        const reviewBtn = await card.$('button:has-text("Review"), a:has-text("Review")').catch(() => null);
        if (reviewBtn) {
          const isVisible = await reviewBtn.isVisible().catch(() => false);
          if (isVisible) remainingHints++;
        }
      }
      if (remainingHints === 0) {
        logger.data('ancestry-hints', `No more hints remaining after processing ${i + 1}`);
        break;
      }
    }
  }

  activeOperationId = null;

  yield {
    type: 'completed',
    operationId,
    personId,
    treeId,
    current: total,
    total,
    hintsProcessed,
    hintsSkipped,
    errors,
    message: `Completed: ${hintsProcessed} hints processed, ${hintsSkipped} skipped`,
  };
}

/**
 * Request cancellation of the active operation
 */
function requestCancel(): boolean {
  if (!activeOperationId) return false;
  cancelledOperations.add(activeOperationId);
  logger.warn('ancestry-hints', `Cancellation requested for ${activeOperationId}`);
  return true;
}

/**
 * Check if an operation is currently running
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

export const ancestryHintsService = {
  processPersonHints,
  processPersonHintsWithProgress,
  requestCancel,
  isRunning,
  getActiveOperationId,
};
