import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { personService } from '../services/person.service.js';
import { idMappingService } from '../services/id-mapping.service.js';
import { browserService } from '../services/browser.service.js';
import { checkForRedirect } from '../services/familysearch-redirect.service.js';
import { localOverrideService } from '../services/local-override.service.js';
import { familySearchRefreshService } from '../services/familysearch-refresh.service.js';
import { augmentationService } from '../services/augmentation.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { databaseService } from '../services/database.service.js';
import { logger } from '../lib/logger.js';
import type { BuiltInProvider } from '@fsf/shared';
import { PHOTOS_DIR, PROVIDER_CACHE_DIR } from '../utils/paths.js';
import { resolveCanonicalOrFail } from '../utils/resolveCanonical.js';
import { sanitizeFtsQuery, isCanonicalId } from '../utils/validation.js';

const VALID_RELATIONSHIP_TYPES = ['father', 'mother', 'spouse', 'child'] as const;

export const personRoutes = Router();

// GET /api/persons/:dbId - List persons in database
personRoutes.get('/:dbId', async (req, res, next) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const result = await personService.listPersons(req.params.dbId, page, limit).catch(next);
  if (result) res.json({ success: true, data: result });
});

// GET /api/persons/:dbId/quick-search?q=name
// Must be registered before /:dbId/:personId to avoid route conflict
personRoutes.get('/:dbId/quick-search', async (req, res, next) => {
  const q = (req.query.q as string || '').trim();
  if (!q || q.length < 2) {
    return res.json({ success: true, data: [] });
  }

  if (!databaseService.isSqliteEnabled()) {
    return res.json({ success: true, data: [] });
  }

  const { dbId } = req.params;
  const sanitized = sanitizeFtsQuery(q);
  if (!sanitized) return res.json({ success: true, data: [] });
  const ftsQuery = `"${sanitized}"*`;

  const results = sqliteService.queryAll<{
    person_id: string;
    display_name: string;
    gender: string;
    birth_name: string | null;
    birth_year: number | null;
  }>(
    `SELECT p.person_id, p.display_name, p.gender, p.birth_name, ve.birth_year
     FROM person p
     JOIN database_membership dm ON p.person_id = dm.person_id
     LEFT JOIN (
       SELECT person_id, MIN(date_year) AS birth_year
       FROM vital_event
       WHERE event_type = 'birth'
       GROUP BY person_id
     ) ve ON ve.person_id = p.person_id
     WHERE dm.db_id = @dbId
       AND p.person_id IN (SELECT person_id FROM person_fts WHERE person_fts MATCH @q)
     LIMIT 20`,
    { dbId, q: ftsQuery }
  );

  const data = results.map(r => ({
    personId: r.person_id,
    displayName: r.display_name,
    gender: r.gender,
    birthName: r.birth_name,
    birthYear: r.birth_year ?? null,
  }));

  res.json({ success: true, data });
});

// GET /api/persons/:dbId/:personId - Get single person
personRoutes.get('/:dbId/:personId', async (req, res, next) => {
  // Services handle ID resolution internally (accepts both canonical ULID and external IDs)
  const result = await personService.getPerson(req.params.dbId, req.params.personId).catch(next);
  if (result) {
    res.json({ success: true, data: result });
  }
});

// GET /api/persons/:dbId/:personId/tree - Get tree data for D3
personRoutes.get('/:dbId/:personId/tree', async (req, res, next) => {
  const depth = parseInt(req.query.depth as string) || 5;
  const direction = (req.query.direction as string) || 'ancestors';
  const result = await personService.getPersonTree(
    req.params.dbId,
    req.params.personId,
    depth,
    direction as 'ancestors' | 'descendants'
  ).catch(next);
  if (result) res.json({ success: true, data: result });
});

// GET /api/persons/:dbId/:personId/identities - Get all external IDs for a person
personRoutes.get('/:dbId/:personId/identities', async (req, res, next) => {
  // Resolve to canonical ID (services accept both formats)
  const canonical = idMappingService.resolveId(req.params.personId, 'familysearch') || req.params.personId;

  const externalIds = idMappingService.getExternalIds(canonical);
  if (externalIds.size === 0) {
    return res.status(404).json({
      success: false,
      error: 'Person not found in canonical database'
    });
  }

  const identities = Array.from(externalIds.entries()).map(([source, externalId]) => ({
    source,
    externalId,
    url: getProviderUrl(source, externalId),
  }));

  res.json({
    success: true,
    data: {
      canonicalId: canonical,
      identities,
    }
  });
});

// POST /api/persons/:dbId/:personId/link - Link external ID to person
personRoutes.post('/:dbId/:personId/link', async (req, res, next) => {
  const { source, externalId, url, confidence } = req.body;

  if (!source || !externalId) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: source, externalId'
    });
  }

  const canonical = resolveCanonicalOrFail(req.params.personId, res);
  if (!canonical) return;

  idMappingService.registerExternalId(canonical, source, externalId, { url, confidence });

  res.json({
    success: true,
    data: {
      canonicalId: canonical,
      source,
      externalId,
    }
  });
});

// POST /api/persons/:dbId/:personId/sync - Sync person data from FamilySearch
// Uses API-based refresh (no browser navigation) to check for merges/redirects and update ID mappings
personRoutes.post('/:dbId/:personId/sync', async (req, res, next) => {
  const { dbId, personId } = req.params;

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  // Get the FamilySearch ID for this person
  const fsId = idMappingService.getExternalId(canonical, 'familysearch');
  if (!fsId) {
    return res.status(400).json({
      success: false,
      error: 'Person has no linked FamilySearch ID'
    });
  }

  // Use API-based refresh service (extracts token from browser cookies, no page navigation)
  const result = await familySearchRefreshService.refreshPerson(dbId, personId).catch(err => ({
    success: false as const,
    error: err.message as string,
  }));

  if (!result.success) {
    // Check for specific auth errors
    const errorMsg = result.error || 'Failed to refresh from FamilySearch';
    if (errorMsg.includes('authentication') || errorMsg.includes('Not authenticated')) {
      return res.status(401).json({
        success: false,
        error: 'Not logged in to FamilySearch. Please log in via the browser.'
      });
    }
    return res.status(500).json({
      success: false,
      error: errorMsg
    });
  }

  // Return result with redirect info
  res.json({
    success: true,
    data: {
      canonicalId: canonical,
      originalFsId: result.originalFsId || fsId,
      currentFsId: result.currentFsId || fsId,
      wasRedirected: result.wasRedirected || false,
      isDeleted: false, // API doesn't return deleted records
      newFsId: result.newFsId,
      survivingPersonName: result.person?.name,
    }
  });
});

/**
 * Get profile URL for a provider
 */
function getProviderUrl(source: string, externalId: string): string | undefined {
  const urls: Record<string, (id: string) => string> = {
    familysearch: (id) => `https://www.familysearch.org/tree/person/details/${id}`,
    ancestry: (id) => `https://www.ancestry.com/family-tree/person/${id}`,
    wikitree: (id) => `https://www.wikitree.com/wiki/${id}`,
    geni: (id) => `https://www.geni.com/people/${id}`,
    findagrave: (id) => `https://www.findagrave.com/memorial/${id}`,
  };
  return urls[source]?.(externalId);
}

// =============================================================================
// LOCAL OVERRIDE ENDPOINTS
// =============================================================================

// GET /api/persons/:dbId/:personId/overrides - Get all overrides for a person
personRoutes.get('/:dbId/:personId/overrides', async (req, res, next) => {
  const { personId } = req.params;

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  const overrides = localOverrideService.getAllOverridesForPerson(canonical);

  res.json({
    success: true,
    data: overrides
  });
});

// PUT /api/persons/:dbId/:personId/override - Set or update an override
personRoutes.put('/:dbId/:personId/override', async (req, res, next) => {
  const { personId } = req.params;
  const { entityType, entityId, fieldName, value, originalValue, reason, source } = req.body;

  if (!entityType || !fieldName) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: entityType, fieldName'
    });
  }

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  // Determine the entity ID based on entity type
  let resolvedEntityId = entityId;

  if (entityType === 'person') {
    resolvedEntityId = canonical;
  } else if (entityType === 'vital_event' && !entityId) {
    // For vital events, we need to look up or create the event
    // The fieldName might be like "birth_date" or "birth_place"
    const eventType = fieldName.split('_')[0]; // birth, death, burial
    if (['birth', 'death', 'burial'].includes(eventType)) {
      resolvedEntityId = localOverrideService.ensureVitalEvent(canonical, eventType).toString();
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid field name for vital_event. Expected birth_, death_, or burial_ prefix'
      });
    }
  }

  if (!resolvedEntityId) {
    return res.status(400).json({
      success: false,
      error: 'Could not resolve entity ID'
    });
  }

  const override = localOverrideService.setOverride(
    entityType,
    resolvedEntityId,
    fieldName,
    value,
    originalValue,
    { reason, source }
  );

  res.json({
    success: true,
    data: override
  });
});

// DELETE /api/persons/:dbId/:personId/override - Remove an override (revert to original)
personRoutes.delete('/:dbId/:personId/override', async (req, res, next) => {
  const { personId } = req.params;
  const { entityType, entityId, fieldName } = req.body;

  if (!entityType || !fieldName) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: entityType, fieldName'
    });
  }

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  // Determine the entity ID based on entity type
  let resolvedEntityId = entityId;

  if (entityType === 'person') {
    resolvedEntityId = canonical;
  } else if (entityType === 'vital_event' && !entityId) {
    const eventType = fieldName.split('_')[0];
    if (['birth', 'death', 'burial'].includes(eventType)) {
      const eventId = localOverrideService.getVitalEventId(canonical, eventType);
      if (eventId !== null) {
        resolvedEntityId = eventId.toString();
      }
    }
  }

  if (!resolvedEntityId) {
    return res.status(400).json({
      success: false,
      error: 'Could not resolve entity ID'
    });
  }

  const removed = localOverrideService.removeOverride(entityType, resolvedEntityId, fieldName);

  res.json({
    success: true,
    data: { removed }
  });
});

// POST /api/persons/:dbId/:personId/claim - Add a new claim (occupation, alias, etc.)
personRoutes.post('/:dbId/:personId/claim', async (req, res, next) => {
  const { personId } = req.params;
  const { predicate, value } = req.body;

  if (!predicate || !value) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: predicate, value'
    });
  }

  if (!['occupation', 'alias', 'religion'].includes(predicate)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid predicate. Must be one of: occupation, alias, religion'
    });
  }

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  const claim = localOverrideService.addClaim(canonical, predicate, value);

  res.json({
    success: true,
    data: claim
  });
});

// PUT /api/persons/:dbId/:personId/claim/:claimId - Update a claim
personRoutes.put('/:dbId/:personId/claim/:claimId', async (req, res, next) => {
  const { personId, claimId } = req.params;
  const { value } = req.body;

  if (!value) {
    return res.status(400).json({
      success: false,
      error: 'Missing required field: value'
    });
  }

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  // Verify the claim belongs to this person
  const existingClaim = localOverrideService.getClaim(claimId);
  if (!existingClaim || existingClaim.personId !== canonical) {
    return res.status(404).json({
      success: false,
      error: 'Claim not found or does not belong to this person'
    });
  }

  const updated = localOverrideService.updateClaim(claimId, value);

  res.json({
    success: true,
    data: { updated }
  });
});

// DELETE /api/persons/:dbId/:personId/claim/:claimId - Delete a claim
personRoutes.delete('/:dbId/:personId/claim/:claimId', async (req, res, next) => {
  const { personId, claimId } = req.params;

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  // Verify the claim belongs to this person
  const existingClaim = localOverrideService.getClaim(claimId);
  if (!existingClaim || existingClaim.personId !== canonical) {
    return res.status(404).json({
      success: false,
      error: 'Claim not found or does not belong to this person'
    });
  }

  const deleted = localOverrideService.deleteClaim(claimId);

  res.json({
    success: true,
    data: { deleted }
  });
});

// GET /api/persons/:dbId/:personId/claims - Get all claims for a person with override data
personRoutes.get('/:dbId/:personId/claims', async (req, res, next) => {
  const { personId } = req.params;
  const predicate = req.query.predicate as string | undefined;

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  const claims = localOverrideService.getClaimsForPerson(canonical, predicate);

  res.json({
    success: true,
    data: claims
  });
});

// =============================================================================
// PROVIDER DATA "USE" ENDPOINTS
// These endpoints allow users to explicitly apply data from provider cache
// =============================================================================

/**
 * Get the photo suffix for a provider (e.g., '-ancestry', '-wikitree', '-familysearch')
 * All providers now use consistent suffixed naming.
 */
function getPhotoSuffix(provider: BuiltInProvider): string {
  switch (provider) {
    case 'ancestry': return '-ancestry';
    case 'wikitree': return '-wikitree';
    case 'familysearch': return '-familysearch';
    default: return `-${provider}`;
  }
}

/**
 * Get cached provider data from file system
 */
function getCachedProviderData(provider: BuiltInProvider, externalId: string): { scrapedData: { photoUrl?: string; fatherExternalId?: string; fatherName?: string; fatherUrl?: string; motherExternalId?: string; motherName?: string; motherUrl?: string } } | null {
  const cacheDir = path.join(PROVIDER_CACHE_DIR, provider);
  const cachePath = path.join(cacheDir, `${externalId}.json`);

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try { return JSON.parse(fs.readFileSync(cachePath, 'utf-8')); } catch { return null; }
}

// POST /api/persons/:dbId/:personId/use-photo/:provider
// Sets the provider's cached photo as the primary photo
personRoutes.post('/:dbId/:personId/use-photo/:provider', async (req, res, next) => {
  const { personId, provider } = req.params;

  // Validate provider
  if (!['familysearch', 'ancestry', 'wikitree', '23andme'].includes(provider)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid provider'
    });
  }

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  // Find the provider photo
  const suffix = getPhotoSuffix(provider as BuiltInProvider);
  const jpgPath = path.join(PHOTOS_DIR, `${canonical}${suffix}.jpg`);
  const pngPath = path.join(PHOTOS_DIR, `${canonical}${suffix}.png`);
  const sourcePath = fs.existsSync(jpgPath) ? jpgPath : fs.existsSync(pngPath) ? pngPath : null;

  if (!sourcePath) {
    return res.status(404).json({
      success: false,
      error: `No photo found for provider ${provider}. Download data from the provider first.`
    });
  }

  // Determine extension and destination path (primary photo has no suffix)
  const ext = sourcePath.endsWith('.png') ? 'png' : 'jpg';
  const destPath = path.join(PHOTOS_DIR, `${canonical}.${ext}`);

  // Copy the provider photo to the primary location
  fs.copyFileSync(sourcePath, destPath);
  logger.done('use-photo', `Set ${provider} photo as primary for ${canonical}`);

  // Update augmentation to mark this provider's photo as primary
  const aug = augmentationService.getAugmentation(canonical);
  if (aug) {
    // Set all photos to non-primary first
    aug.photos.forEach(p => { p.isPrimary = false; });
    // Mark the provider's photo as primary
    const providerPhoto = aug.photos.find(p => p.source === provider);
    if (providerPhoto) {
      providerPhoto.isPrimary = true;
    }
    augmentationService.saveAugmentation(aug);
  }

  res.json({
    success: true,
    data: {
      photoPath: destPath,
      provider,
      message: `${provider} photo set as primary`
    }
  });
});

// POST /api/persons/:dbId/:personId/use-parent
// Creates parent_edge from provider cache data
// Body: { parentType: 'father' | 'mother', provider: string }
personRoutes.post('/:dbId/:personId/use-parent', async (req, res, next) => {
  const { personId } = req.params;
  const { parentType, provider } = req.body;

  // Validate inputs
  if (!parentType || !['father', 'mother'].includes(parentType)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid parentType. Must be "father" or "mother"'
    });
  }

  if (!provider || !['familysearch', 'ancestry', 'wikitree', '23andme'].includes(provider)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid provider'
    });
  }

  const childCanonicalId = resolveCanonicalOrFail(personId, res);
  if (!childCanonicalId) return;

  // Get the external ID for this person and provider
  const externalId = idMappingService.getExternalId(childCanonicalId, provider as BuiltInProvider);
  if (!externalId) {
    return res.status(400).json({
      success: false,
      error: `Person has no ${provider} link`
    });
  }

  // Get cached provider data
  const cache = getCachedProviderData(provider as BuiltInProvider, externalId);
  if (!cache?.scrapedData) {
    return res.status(404).json({
      success: false,
      error: `No cached data found for ${provider}. Download data from the provider first.`
    });
  }

  // Get parent info from cache
  const parentExternalId = parentType === 'father' ? cache.scrapedData.fatherExternalId : cache.scrapedData.motherExternalId;
  const parentName = parentType === 'father' ? cache.scrapedData.fatherName : cache.scrapedData.motherName;
  const parentUrl = parentType === 'father' ? cache.scrapedData.fatherUrl : cache.scrapedData.motherUrl;

  if (!parentExternalId) {
    return res.status(404).json({
      success: false,
      error: `No ${parentType} found in ${provider} data`
    });
  }

  // Check if we already have a canonical ID for this parent
  let parentCanonicalId = idMappingService.getCanonicalId(provider as BuiltInProvider, parentExternalId);

  if (!parentCanonicalId) {
    // Create a new person record for this parent
    parentCanonicalId = idMappingService.createPerson(
      parentName || `Unknown ${parentType}`,
      provider as BuiltInProvider,
      parentExternalId,
      {
        gender: parentType === 'father' ? 'male' : 'female',
        url: parentUrl,
      }
    );
    logger.done('use-parent', `Created new person for ${parentType}: ${parentName || 'Unknown'} (${parentCanonicalId})`);
  } else {
    // Person exists, just ensure the external ID is registered
    idMappingService.registerExternalId(parentCanonicalId, provider as BuiltInProvider, parentExternalId, {
      url: parentUrl,
    });
    logger.data('use-parent', `Found existing person for ${parentType}: ${parentCanonicalId}`);
  }

  // Create parent_edge linking child to parent (if it doesn't exist)
  if (databaseService.isSqliteEnabled()) {
    sqliteService.run(
      `INSERT OR IGNORE INTO parent_edge (child_id, parent_id, parent_role, source)
       VALUES (@childId, @parentId, @parentRole, @source)`,
      {
        childId: childCanonicalId,
        parentId: parentCanonicalId,
        parentRole: parentType,
        source: provider,
      }
    );
    logger.done('use-parent', `Linked ${parentType} edge: ${childCanonicalId} -> ${parentCanonicalId}`);
  }

  // Also add platform reference for the parent in augmentation data
  if (parentUrl) {
    augmentationService.addPlatform(parentCanonicalId, provider as BuiltInProvider, parentUrl, parentExternalId);
  }

  res.json({
    success: true,
    data: {
      childId: childCanonicalId,
      parentId: parentCanonicalId,
      parentType,
      parentName: parentName || `Unknown ${parentType}`,
      provider,
      message: `${parentType} link created from ${provider} data`
    }
  });
});

// PUT /api/persons/:dbId/:personId/use-field
// Apply a specific field value from provider as a local override
// Body: { fieldName: string, provider: string, value: string }
personRoutes.put('/:dbId/:personId/use-field', async (req, res, next) => {
  const { personId } = req.params;
  const { fieldName, provider, value } = req.body;

  if (!fieldName || !provider || value === undefined) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: fieldName, provider, value'
    });
  }

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  // Map field names to entity types and internal field names
  // Note: internalField must match what applyLocalOverrides checks in multi-platform-comparison.service.ts
  const fieldMapping: Record<string, { entityType: string; internalField: string }> = {
    name: { entityType: 'person', internalField: 'name' },
    gender: { entityType: 'person', internalField: 'gender' },
    birthDate: { entityType: 'vital_event', internalField: 'date' },
    birthPlace: { entityType: 'vital_event', internalField: 'place' },
    deathDate: { entityType: 'vital_event', internalField: 'date' },
    deathPlace: { entityType: 'vital_event', internalField: 'place' },
  };

  const mapping = fieldMapping[fieldName];
  if (!mapping) {
    return res.status(400).json({
      success: false,
      error: `Unsupported field: ${fieldName}. Use use-parent endpoint for parent fields.`
    });
  }

  // Determine entity ID
  let entityId = canonical;
  if (mapping.entityType === 'vital_event') {
    const eventType = fieldName.startsWith('birth') ? 'birth' : 'death';
    entityId = localOverrideService.ensureVitalEvent(canonical, eventType).toString();
  }

  // Create the override
  const override = localOverrideService.setOverride(
    mapping.entityType,
    entityId,
    mapping.internalField,
    value,
    null, // originalValue - could fetch from DB if needed
    { source: provider, reason: `Applied from ${provider}` }
  );

  logger.done('use-field', `Applied ${fieldName}=${value} from ${provider} for ${canonical}`);

  res.json({
    success: true,
    data: override
  });
});

/**
 * Check whether a person belongs to a given database.
 * Shared by link-relationship and unlink-relationship to prevent cross-database modifications.
 */
function isPersonInDatabase(personId: string, dbId: string): boolean {
  return !!sqliteService.queryOne<{ person_id: string }>(
    'SELECT person_id FROM database_membership WHERE db_id = @dbId AND person_id = @personId',
    { dbId, personId }
  );
}

// POST /api/persons/:dbId/:personId/link-relationship
// Link an existing person or create a new stub as parent/spouse/child
// Body: { relationshipType: 'father'|'mother'|'spouse'|'child', targetId?: string, newPerson?: { name: string, gender?: string } }
personRoutes.post('/:dbId/:personId/link-relationship', async (req, res, next) => {
  const { dbId, personId } = req.params;
  const { relationshipType, targetId, newPerson } = req.body;

  if (!relationshipType || !VALID_RELATIONSHIP_TYPES.includes(relationshipType)) {
    return res.status(400).json({ success: false, error: `Invalid relationshipType. Must be one of: ${VALID_RELATIONSHIP_TYPES.join(', ')}` });
  }

  if (!targetId && !newPerson?.name) {
    return res.status(400).json({ success: false, error: 'Provide either targetId (existing person) or newPerson.name (to create a stub)' });
  }

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  if (!databaseService.isSqliteEnabled()) {
    return res.status(400).json({ success: false, error: 'SQLite must be enabled for relationship linking' });
  }

  // Verify the source person belongs to this database
  if (!isPersonInDatabase(canonical, dbId)) {
    return res.status(403).json({ success: false, error: 'Person does not belong to the specified database' });
  }

  // Validate targetId format and existence + duplicate checks BEFORE any writes,
  // so 4xx responses don't leave behind orphaned stubs.
  let createdNew = false;
  let resolvedTargetId: string;
  let stubGender: 'male' | 'female' | 'unknown' = 'unknown';

  if (targetId) {
    if (!isCanonicalId(targetId)) {
      return res.status(400).json({ success: false, error: 'Invalid targetId format' });
    }
    if (targetId === canonical) {
      return res.status(400).json({ success: false, error: 'Cannot link a person to themselves' });
    }
    const existing = sqliteService.queryOne<{ person_id: string }>(
      'SELECT person_id FROM person WHERE person_id = @id',
      { id: targetId }
    );
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Target person not found' });
    }
    resolvedTargetId = targetId;

    // Pre-check duplicate edges. Stubs can never collide so this only applies here.
    const dupError = checkDuplicateEdge(canonical, resolvedTargetId, relationshipType);
    if (dupError) {
      return res.status(409).json({ success: false, error: dupError });
    }
  } else {
    // Validate and coerce gender to the DB CHECK constraint values
    const requestedGender = typeof newPerson.gender === 'string' ? newPerson.gender.toLowerCase() : '';
    stubGender =
      requestedGender === 'male' || requestedGender === 'female' || requestedGender === 'unknown'
        ? requestedGender
        : relationshipType === 'father'
          ? 'male'
          : relationshipType === 'mother'
            ? 'female'
            : 'unknown';
    createdNew = true;
    resolvedTargetId = ''; // assigned inside the transaction below
  }

  // For child links, look up parent role from current person's gender (read-only)
  let childParentRole = 'parent';
  if (relationshipType === 'child') {
    const row = sqliteService.queryOne<{ gender: string }>(
      'SELECT gender FROM person WHERE person_id = @id',
      { id: canonical }
    );
    childParentRole = row?.gender === 'female' ? 'mother' : row?.gender === 'male' ? 'father' : 'parent';
  }

  // Single transaction wraps stub creation + membership + edge insertion so a
  // failure anywhere rolls back all writes (no orphaned stubs or memberships).
  sqliteService.transaction(() => {
    if (createdNew) {
      resolvedTargetId = idMappingService.createPersonStub(newPerson.name, { gender: stubGender });
    }

    sqliteService.run(
      'INSERT OR IGNORE INTO database_membership (db_id, person_id) VALUES (@dbId, @personId)',
      { dbId, personId: resolvedTargetId }
    );

    if (relationshipType === 'father' || relationshipType === 'mother') {
      sqliteService.run(
        `INSERT INTO parent_edge (child_id, parent_id, parent_role, source, confidence)
         VALUES (@childId, @parentId, @role, 'manual', 1.0)`,
        { childId: canonical, parentId: resolvedTargetId, role: relationshipType }
      );
    } else if (relationshipType === 'spouse') {
      // Normalize ordering (smaller ID first) to prevent duplicate pairs
      const [p1, p2] = canonical < resolvedTargetId ? [canonical, resolvedTargetId] : [resolvedTargetId, canonical];
      sqliteService.run(
        `INSERT INTO spouse_edge (person1_id, person2_id, source, confidence)
         VALUES (@p1, @p2, 'manual', 1.0)`,
        { p1, p2 }
      );
    } else if (relationshipType === 'child') {
      sqliteService.run(
        `INSERT INTO parent_edge (child_id, parent_id, parent_role, source, confidence)
         VALUES (@childId, @parentId, @role, 'manual', 1.0)`,
        { childId: resolvedTargetId, parentId: canonical, role: childParentRole }
      );
    }
  });

  if (createdNew) {
    logger.done('link-relationship', `Created person stub: ${newPerson.name} (${resolvedTargetId})`);
  }
  logger.done('link-relationship', `Linked ${relationshipType}: ${canonical} ↔ ${resolvedTargetId}`);

  res.json({
    success: true,
    data: {
      personId: canonical,
      targetId: resolvedTargetId,
      relationshipType,
      createdNew,
    }
  });
});

/**
 * Pre-check whether a relationship edge already exists between two persons.
 * Returns an error message if a duplicate exists, otherwise null.
 */
function checkDuplicateEdge(
  canonicalId: string,
  targetId: string,
  relationshipType: string
): string | null {
  if (relationshipType === 'father' || relationshipType === 'mother') {
    const existing = sqliteService.queryOne<{ id: number }>(
      'SELECT id FROM parent_edge WHERE child_id = @childId AND parent_id = @parentId',
      { childId: canonicalId, parentId: targetId }
    );
    return existing ? 'This parent relationship already exists' : null;
  }
  if (relationshipType === 'spouse') {
    const [p1, p2] = canonicalId < targetId ? [canonicalId, targetId] : [targetId, canonicalId];
    const existing = sqliteService.queryOne<{ id: number }>(
      'SELECT id FROM spouse_edge WHERE person1_id = @p1 AND person2_id = @p2',
      { p1, p2 }
    );
    return existing ? 'This spouse relationship already exists' : null;
  }
  if (relationshipType === 'child') {
    const existing = sqliteService.queryOne<{ id: number }>(
      'SELECT id FROM parent_edge WHERE child_id = @childId AND parent_id = @parentId',
      { childId: targetId, parentId: canonicalId }
    );
    return existing ? 'This child relationship already exists' : null;
  }
  return null;
}

// DELETE /api/persons/:dbId/:personId/unlink-relationship
// Remove a relationship between two people
// Body: { relationshipType: 'father'|'mother'|'spouse'|'child', targetId: string }
personRoutes.delete('/:dbId/:personId/unlink-relationship', async (req, res, next) => {
  const { dbId, personId } = req.params;
  const { relationshipType, targetId } = req.body;

  if (!relationshipType || !VALID_RELATIONSHIP_TYPES.includes(relationshipType) || !targetId) {
    return res.status(400).json({ success: false, error: 'relationshipType and targetId are required' });
  }

  if (!isCanonicalId(targetId)) {
    return res.status(400).json({ success: false, error: 'Invalid targetId format' });
  }

  const canonical = resolveCanonicalOrFail(personId, res);
  if (!canonical) return;

  if (!databaseService.isSqliteEnabled()) {
    return res.status(400).json({ success: false, error: 'SQLite must be enabled' });
  }

  // Verify both persons belong to this database before modifying edges.
  // The membership pre-checks below are sufficient to scope deletes — no
  // redundant EXISTS guards needed in the DELETE statements themselves.
  if (!isPersonInDatabase(canonical, dbId)) {
    return res.status(403).json({ success: false, error: 'Person does not belong to the specified database' });
  }
  if (!isPersonInDatabase(targetId, dbId)) {
    return res.status(403).json({ success: false, error: 'Target person does not belong to the specified database' });
  }

  let deleted = false;

  if (relationshipType === 'father' || relationshipType === 'mother') {
    const result = sqliteService.run(
      'DELETE FROM parent_edge WHERE child_id = @childId AND parent_id = @parentId',
      { childId: canonical, parentId: targetId }
    );
    deleted = result.changes > 0;
  } else if (relationshipType === 'spouse') {
    const result = sqliteService.run(
      `DELETE FROM spouse_edge
       WHERE (person1_id = @a AND person2_id = @b) OR (person1_id = @b AND person2_id = @a)`,
      { a: canonical, b: targetId }
    );
    deleted = result.changes > 0;
  } else if (relationshipType === 'child') {
    const result = sqliteService.run(
      'DELETE FROM parent_edge WHERE child_id = @childId AND parent_id = @parentId',
      { childId: targetId, parentId: canonical }
    );
    deleted = result.changes > 0;
  }

  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Relationship not found' });
  }

  logger.done('unlink-relationship', `Unlinked ${relationshipType}: ${canonical} ↔ ${targetId}`);

  res.json({ success: true, data: { personId: canonical, targetId, relationshipType } });
});

