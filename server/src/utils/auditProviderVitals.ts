import type { BuiltInProvider } from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';
import { logger } from '../lib/logger.js';
import { json2person } from '../lib/familysearch/index.js';
import { getCachedProviderData } from './providerCache.js';
import { cachedProviderVitalValues, type EventSourceValue } from './auditMismatches.js';

const BUILT_IN_PROVIDERS = new Set<BuiltInProvider>([
  'familysearch', 'ancestry', 'wikitree', '23andme',
]);

function isBuiltInProvider(source: string): source is BuiltInProvider {
  return BUILT_IN_PROVIDERS.has(source as BuiltInProvider);
}

export function providerCacheVitalValues(source: BuiltInProvider, cache: unknown): EventSourceValue[] {
  const record = cache as { scrapedData?: unknown };
  if (record.scrapedData) return cachedProviderVitalValues(cache as Parameters<typeof cachedProviderVitalValues>[0]);
  if (source !== 'familysearch') return [];

  const person = json2person(cache);
  return cachedProviderVitalValues({
    provider: source,
    scrapedData: {
      birth: person?.birth,
      death: person?.death,
    },
  });
}

/** Read provider-cache vitals for the linked external identities of a person. */
export function getCachedProviderVitalValues(personId: string): EventSourceValue[] {
  const links = sqliteService.queryAll<{ source: string; external_id: string }>(
    'SELECT source, external_id FROM external_identity WHERE person_id = @personId',
    { personId },
  );

  return links.flatMap(link => {
    if (!isBuiltInProvider(link.source)) return [];
    try {
      const cache = getCachedProviderData(link.source, link.external_id);
      return cache ? providerCacheVitalValues(link.source, cache) : [];
    } catch (error) {
      logger.warn('auditor', `Ignoring unreadable ${link.source} cache for ${personId}: ${String(error)}`);
      return [];
    }
  });
}
