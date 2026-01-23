import { Router } from 'express';
import { personService } from '../services/person.service.js';
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

  // Resolve to canonical ID
  const canonical = idMappingService.resolveId(req.params.personId, 'familysearch') || req.params.personId;

  // Verify it's a valid canonical ID (26-char ULID)
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(canonical)) {
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
