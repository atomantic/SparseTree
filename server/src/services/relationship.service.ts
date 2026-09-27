import { postgresService, type createPostgresService } from '../db/postgres.service.js';
import { createIdMappingService } from './id-mapping.service.js';

interface ProviderParent {
  externalId: string;
  name?: string;
  role: 'father' | 'mother';
  url?: string;
}

/** Imported parents, their identities, and the family edges commit together. */
export function createRelationshipService(store: ReturnType<typeof createPostgresService> = postgresService) {
  const identities = createIdMappingService(store);
  const linkProviderParents = (childId: string, source: string, parents: ProviderParent[]) =>
    store.transaction(async tx => {
      const linked: Array<ProviderParent & { personId: string }> = [];
      // All callers acquire shared external identities in a stable order.
      for (const parent of [...parents].sort((a, b) => a.externalId.localeCompare(b.externalId))) {
        const personId = await identities.getOrCreateCanonicalId(source, parent.externalId,
          parent.name || `Unknown ${parent.role}`, {
            gender: parent.role === 'father' ? 'male' : 'female', url: parent.url,
          }, tx);
        await identities.registerExternalId(personId, source, parent.externalId, { url: parent.url }, tx);
        await tx.run(
          `INSERT INTO parent_edge (child_id, parent_id, parent_role, source)
           VALUES (@childId, @personId, @role, @source) ON CONFLICT (child_id, parent_id) DO NOTHING`,
          { childId, personId, role: parent.role, source },
        );
        linked.push({ ...parent, personId });
      }
      return linked;
    });
  return { linkProviderParents };
}

export const relationshipService = createRelationshipService();
