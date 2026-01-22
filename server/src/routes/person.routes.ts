import { Router } from 'express';
import { personService } from '../services/person.service.js';
import { toExternalId, toCanonicalId } from '../middleware/id-resolver.js';
import { idMappingService } from '../services/id-mapping.service.js';

export const personRoutes = Router();

// GET /api/persons/:dbId - List persons in database
personRoutes.get('/:dbId', async (req, res, next) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const result = await personService.listPersons(req.params.dbId, page, limit).catch(next);
  if (result) res.json({ success: true, data: result });
});

// GET /api/persons/:dbId/:personId - Get single person
// Accepts both ULID and FamilySearch ID
personRoutes.get('/:dbId/:personId', async (req, res, next) => {
  // Resolve ID to external form for JSON db lookup
  const externalId = toExternalId(req.params.personId);
  const result = await personService.getPerson(req.params.dbId, externalId).catch(next);
  if (result) {
    // Add canonical ID if available
    const canonical = toCanonicalId(req.params.personId);
    res.json({
      success: true,
      data: { ...result, canonicalId: canonical }
    });
  }
});

// GET /api/persons/:dbId/:personId/tree - Get tree data for D3
// Accepts both ULID and FamilySearch ID
personRoutes.get('/:dbId/:personId/tree', async (req, res, next) => {
  const depth = parseInt(req.query.depth as string) || 5;
  const direction = (req.query.direction as string) || 'ancestors';
  // Resolve ID to external form for JSON db lookup
  const externalId = toExternalId(req.params.personId);
  const result = await personService.getPersonTree(
    req.params.dbId,
    externalId,
    depth,
    direction as 'ancestors' | 'descendants'
  ).catch(next);
  if (result) res.json({ success: true, data: result });
});

// GET /api/persons/:dbId/:personId/identities - Get all external IDs for a person
personRoutes.get('/:dbId/:personId/identities', async (req, res, next) => {
  const canonical = toCanonicalId(req.params.personId);
  if (!canonical) {
    return res.status(404).json({
      success: false,
      error: 'Person not found in canonical database'
    });
  }

  const externalIds = idMappingService.getExternalIds(canonical);
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

  const canonical = toCanonicalId(req.params.personId);
  if (!canonical) {
    return res.status(404).json({
      success: false,
      error: 'Person not found in canonical database'
    });
  }

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
