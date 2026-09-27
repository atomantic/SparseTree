import { databaseService } from './database.service.js';
import type { PersonAugmentation, ProviderPersonMapping } from '@fsf/shared';
import { augmentationService } from './augmentation.service.js';
import { postgresService } from '../db/postgres.service.js';
import { idMappingService } from './id-mapping.service.js';

/**
 * Register a provider mapping in PostgreSQL if enabled
 */
async function registerProviderMappingIfEnabled(
  personId: string,  // FamilySearch ID
  provider: string,
  externalId: string | undefined,
  matchMethod: string = 'manual',
  confidence: number = 1.0
): Promise<void> {
  if (!(await databaseService.isPostgresEnabled())) return;

  // Get canonical ID for this person
  const canonicalId = await idMappingService.resolveId(personId, 'familysearch');
  if (!canonicalId) return;

  // Register in provider_mapping table
  await postgresService.run(
    `INSERT INTO provider_mapping (person_id, provider, account_id, match_method, match_confidence)
     VALUES (@personId, @provider, @accountId, @matchMethod, @confidence)
     ON CONFLICT (person_id, provider) DO UPDATE SET account_id = EXCLUDED.account_id,
       match_method = EXCLUDED.match_method, match_confidence = EXCLUDED.match_confidence`,
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
export async function addProviderMapping(personId: string, mapping: Omit<ProviderPersonMapping, 'linkedAt'>): Promise<PersonAugmentation> {
  const existing = await augmentationService.getOrCreate(personId);

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

  // Also register in PostgreSQL provider_mapping
  const confidence = mapping.confidence === 'high' ? 1.0 : mapping.confidence === 'low' ? 0.5 : 0.75;
  await registerProviderMappingIfEnabled(
    personId,
    mapping.platform,
    mapping.externalId,
    mapping.matchedBy ?? 'manual',
    confidence
  );
  augmentationService.saveAugmentation(existing);

  return existing;
}

/**
 * Remove a provider mapping from a person
 */
export async function removeProviderMapping(personId: string, providerId: string): Promise<PersonAugmentation | null> {
  const existing = await augmentationService.getAugmentation(personId);
  if (!existing || !existing.providerMappings) return existing;

  const idx = existing.providerMappings.findIndex(m => m.providerId === providerId);
  if (idx < 0) return existing;

  if (await databaseService.isPostgresEnabled()) {
    const canonicalId = await idMappingService.resolveId(personId, 'familysearch');
    if (canonicalId) {
      await postgresService.run('DELETE FROM provider_mapping WHERE person_id = @personId AND provider = @provider',
        { personId: canonicalId, provider: existing.providerMappings[idx].platform });
    }
  }
  existing.providerMappings.splice(idx, 1);
  existing.updatedAt = new Date().toISOString();
  augmentationService.saveAugmentation(existing);
  return existing;
}

/**
 * Get all provider mappings for a person
 */
export async function getProviderMappings(personId: string): Promise<ProviderPersonMapping[]> {
  const augmentation = await augmentationService.getAugmentation(personId);
  return augmentation?.providerMappings || [];
}

/**
 * Check if a person has a mapping to a specific provider
 */
export async function hasProviderMapping(personId: string, providerId: string): Promise<boolean> {
  const augmentation = await augmentationService.getAugmentation(personId);
  if (!augmentation?.providerMappings) return false;
  return augmentation.providerMappings.some(m => m.providerId === providerId);
}
