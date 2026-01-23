#!/usr/bin/env npx tsx

/**
 * Mock Selector Validation Script
 *
 * Validates that mock provider selectors still match the real provider websites.
 * Run periodically to detect when providers update their DOM structure.
 *
 * Usage:
 *   npx tsx scripts/validate-mock-selectors.ts
 *   npx tsx scripts/validate-mock-selectors.ts --provider=wikitree
 *   npx tsx scripts/validate-mock-selectors.ts --dry-run
 */

import { chromium, Browser, Page } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCKS_DIR = join(__dirname, '..', 'tests', '__mocks__', 'providers');

interface SelectorConfig {
  selector: string;
  required: boolean;
  type: 'text' | 'attribute:src' | 'presence' | 'input' | 'button';
  context?: string;
}

interface SelectorsFile {
  version: string;
  lastValidated: string;
  provider: string;
  selectors: Record<string, SelectorConfig>;
}

interface ValidationResult {
  provider: string;
  url: string;
  selector: string;
  name: string;
  required: boolean;
  found: boolean;
  error?: string;
}

// Public pages that can be validated without login
const VALIDATION_URLS: Record<string, string[]> = {
  wikitree: [
    'https://www.wikitree.com/wiki/Churchill-2',  // Winston Churchill
    'https://www.wikitree.com/wiki/Washington-1', // George Washington
  ],
  // FamilySearch, Ancestry, and 23andMe require login - skip in automated validation
};

/**
 * Load selector configuration for a provider
 */
function loadSelectors(provider: string): SelectorsFile | null {
  const path = join(MOCKS_DIR, provider, 'selectors.json');
  if (!existsSync(path)) {
    console.log(`No selectors.json found for ${provider}`);
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Validate selectors against a real page
 */
async function validateSelectors(
  page: Page,
  url: string,
  selectors: SelectorsFile
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000); // Wait for dynamic content

  for (const [name, config] of Object.entries(selectors.selectors)) {
    // Skip login-context selectors
    if (config.context === 'login') {
      continue;
    }

    const result: ValidationResult = {
      provider: selectors.provider,
      url,
      selector: config.selector,
      name,
      required: config.required,
      found: false,
    };

    // Test each selector in the comma-separated list
    const selectorParts = config.selector.split(',').map(s => s.trim());
    for (const selector of selectorParts) {
      const element = await page.$(selector).catch(() => null);
      if (element) {
        result.found = true;
        break;
      }
    }

    if (!result.found && config.required) {
      result.error = `Required selector not found: ${name}`;
    }

    results.push(result);
  }

  return results;
}

/**
 * Update the lastValidated timestamp in selectors file
 */
function updateValidatedTimestamp(provider: string): void {
  const path = join(MOCKS_DIR, provider, 'selectors.json');
  const config = JSON.parse(readFileSync(path, 'utf-8'));
  config.lastValidated = new Date().toISOString().split('T')[0];
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Print validation report
 */
function printReport(results: ValidationResult[]): void {
  console.log('\n=== Mock Selector Validation Report ===\n');

  const byProvider = new Map<string, ValidationResult[]>();
  for (const r of results) {
    const existing = byProvider.get(r.provider) || [];
    existing.push(r);
    byProvider.set(r.provider, existing);
  }

  let hasErrors = false;

  for (const [provider, providerResults] of byProvider) {
    console.log(`Provider: ${provider}`);
    console.log('-'.repeat(40));

    const passed = providerResults.filter(r => r.found);
    const failed = providerResults.filter(r => !r.found);
    const requiredFailed = failed.filter(r => r.required);

    console.log(`  Total selectors: ${providerResults.length}`);
    console.log(`  Passed: ${passed.length}`);
    console.log(`  Failed: ${failed.length} (${requiredFailed.length} required)`);

    if (failed.length > 0) {
      console.log('\n  Failed selectors:');
      for (const r of failed) {
        const marker = r.required ? '❌ [REQUIRED]' : '⚠️  [optional]';
        console.log(`    ${marker} ${r.name}`);
        console.log(`       Selector: ${r.selector.substring(0, 60)}${r.selector.length > 60 ? '...' : ''}`);
      }
    }

    if (requiredFailed.length > 0) {
      hasErrors = true;
    }

    console.log('');
  }

  if (hasErrors) {
    console.log('⚠️  Some required selectors failed validation!');
    console.log('   The mock templates may need updating to match provider changes.');
  } else {
    console.log('✅ All required selectors passed validation.');
  }
}

/**
 * Main validation function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const specificProvider = args.find(a => a.startsWith('--provider='))?.split('=')[1];

  console.log('SparseTree Mock Selector Validator');
  console.log('==================================\n');

  if (dryRun) {
    console.log('Running in dry-run mode (no timestamps will be updated)\n');
  }

  // Determine which providers to validate
  const providersToValidate = specificProvider
    ? [specificProvider]
    : Object.keys(VALIDATION_URLS);

  if (providersToValidate.length === 0) {
    console.log('No providers configured for validation.');
    console.log('Only WikiTree is currently supported for automated validation');
    console.log('(FamilySearch, Ancestry, and 23andMe require authentication)');
    return;
  }

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    const allResults: ValidationResult[] = [];

    for (const provider of providersToValidate) {
      const urls = VALIDATION_URLS[provider];
      if (!urls || urls.length === 0) {
        console.log(`Skipping ${provider} - no public validation URLs configured`);
        continue;
      }

      const selectors = loadSelectors(provider);
      if (!selectors) {
        continue;
      }

      console.log(`Validating ${provider}...`);

      for (const url of urls) {
        console.log(`  Testing: ${url}`);
        const results = await validateSelectors(page, url, selectors);
        allResults.push(...results);
      }

      // Update timestamp if not dry-run and all passed
      const providerResults = allResults.filter(r => r.provider === provider);
      const failed = providerResults.filter(r => !r.found && r.required);

      if (!dryRun && failed.length === 0) {
        updateValidatedTimestamp(provider);
        console.log(`  Updated lastValidated timestamp`);
      }
    }

    printReport(allResults);

    // Exit with error code if required selectors failed
    const hasErrors = allResults.some(r => !r.found && r.required);
    process.exit(hasErrors ? 1 : 0);

  } catch (error) {
    console.error('Validation failed:', error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
