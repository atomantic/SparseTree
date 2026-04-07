import type { PersonAugmentation, ProviderPersonMapping } from '@fsf/shared';
import { augmentationService } from './augmentation.service.js';
import { databaseService } from './database.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';

/**
 * Register a provider mapping in SQLite if enabled
 */
function registerProviderMappingIfEnabled(
  personId: string,  // FamilySearch ID
  provider: string,
  externalId: string | undefined,
  matchMethod: string = 'manual',
  confidence: number = 1.0
): void {
  if (!databaseService.isSqliteEnabled()) return;

  // Get canonical ID for this person
  const canonicalId = idMappingService.resolveId(personId, 'familysearch');
  if (!canonicalId) return;

  // Register in provider_mapping table
  sqliteService.run(
    `INSERT OR REPLACE INTO provider_mapping (person_id, provider, account_id, match_method, match_confidence)
     VALUES (@personId, @provider, @accountId, @matchMethod, @confidence)`,
    {
      personId: canonicalId,
      provider,
      accountId: externalId ?? null,
      matchMethod,
      confidence,
    }
  );
}

/**
 * Add or update a provider mapping for a person
 */
export function addProviderMapping(personId: string, mapping: Omit<ProviderPersonMapping, 'linkedAt'>): PersonAugmentation {
  const existing = augmentationService.getOrCreate(personId);

  if (!existing.providerMappings) {
    existing.providerMappings = [];
  }

  const fullMapping: ProviderPersonMapping = {
    ...mapping,
    linkedAt: new Date().toISOString(),
  };

  // Check if mapping for this provider already exists
  const existingIdx = existing.providerMappings.findIndex(m => m.providerId === mapping.providerId);
  if (existingIdx >= 0) {
    existing.providerMappings[existingIdx] = fullMapping;
  } else {
    existing.providerMappings.push(fullMapping);
  }

  existing.updatedAt = new Date().toISOString();
  augmentationService.saveAugmentation(existing);

  // Also register in SQLite provider_mapping
  const confidence = mapping.confidence === 'high' ? 1.0 : mapping.confidence === 'low' ? 0.5 : 0.75;
  registerProviderMappingIfEnabled(
    personId,
    mapping.platform,
    mapping.externalId,
    mapping.matchedBy ?? 'manual',
    confidence
  );

  return existing;
}

/**
 * Remove a provider mapping from a person
 */
export function removeProviderMapping(personId: string, providerId: string): PersonAugmentation | null {
  const existing = augmentationService.getAugmentation(personId);
  if (!existing || !existing.providerMappings) return existing;

  const idx = existing.providerMappings.findIndex(m => m.providerId === providerId);
  if (idx < 0) return existing;

  existing.providerMappings.splice(idx, 1);
  existing.updatedAt = new Date().toISOString();
  augmentationService.saveAugmentation(existing);
  return existing;
}

/**
 * Get all provider mappings for a person
 */
export function getProviderMappings(personId: string): ProviderPersonMapping[] {
  const augmentation = augmentationService.getAugmentation(personId);
  return augmentation?.providerMappings || [];
}

/**
 * Check if a person has a mapping to a specific provider
 */
export function hasProviderMapping(personId: string, providerId: string): boolean {
  const augmentation = augmentationService.getAugmentation(personId);
  if (!augmentation?.providerMappings) return false;
  return augmentation.providerMappings.some(m => m.providerId === providerId);
}