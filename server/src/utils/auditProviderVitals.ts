import type { BuiltInProvider } from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';
import { logger } from '../lib/logger.js';
import { getCachedProviderData } from './providerCache.js';
import { cachedProviderVitalValues, type EventSourceValue } from './auditMismatches.js';

const BUILT_IN_PROVIDERS = new Set<BuiltInProvider>([
  'familysearch', 'ancestry', 'wikitree', '23andme',
]);

function isBuiltInProvider(source: string): source is BuiltInProvider {
  return BUILT_IN_PROVIDERS.has(source as BuiltInProvider);
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
      return cache ? cachedProviderVitalValues(cache) : [];
    } catch (error) {
      logger.warn('auditor', `Ignoring unreadable ${link.source} cache for ${personId}: ${String(error)}`);
      return [];
    }
  });
}
