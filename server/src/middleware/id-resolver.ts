/**
 * ID Resolution Middleware
 *
 * Resolves person IDs that could be either:
 * - Canonical ULIDs (26 chars alphanumeric)
 * - External provider IDs (e.g., FamilySearch "KWZJ-VKB")
 *
 * Returns both forms for flexible use.
 */

import { Request, Response, NextFunction } from 'express';
import { idMappingService } from '../services/id-mapping.service.js';

export interface ResolvedId {
  canonical: string | undefined;  // ULID if found
  external: string;               // Original ID (FS ID or other)
  source: string;                 // Provider source if determined
}

/**
 * Check if an ID looks like a ULID (26 alphanumeric chars, Crockford base32)
 */
function isUlid(id: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id);
}

/**
 * Resolve an ID to both canonical and external forms
 */
export function resolvePersonId(id: string, preferredSource = 'familysearch'): ResolvedId {
  if (isUlid(id)) {
    // It's a ULID - look up external ID
    const externalIds = idMappingService.getExternalIds(id);
    const externalId = externalIds.get(preferredSource) || externalIds.values().next().value;
    const source = externalIds.has(preferredSource) ? preferredSource : (externalIds.keys().next().value || preferredSource);

    return {
      canonical: id,
      external: externalId || id,  // Fall back to ULID if no external ID
      source,
    };
  }

  // It's an external ID - look up canonical
  const canonical = idMappingService.resolveId(id, preferredSource);

  return {
    canonical,
    external: id,
    source: preferredSource,
  };
}

/**
 * Middleware to resolve :personId parameter
 *
 * Adds `req.resolvedPersonId` with both canonical and external IDs
 *
 * Usage in routes:
 * ```typescript
 * router.get('/:dbId/:personId', resolveIdMiddleware, (req, res) => {
 *   const { canonical, external } = req.resolvedPersonId!;
 *   // Use external for JSON db lookup (current)
 *   // Use canonical for SQLite lookup (future)
 * });
 * ```
 */
export function resolveIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const personId = req.params.personId;
  if (personId) {
    (req as Request & { resolvedPersonId?: ResolvedId }).resolvedPersonId = resolvePersonId(personId);
  }
  next();
}

/**
 * Get external (FamilySearch) ID for JSON db lookups
 *
 * Helper for current JSON-based services during migration.
 * Once SQLite becomes primary, use canonical IDs directly.
 */
export function toExternalId(id: string, source = 'familysearch'): string {
  return resolvePersonId(id, source).external;
}

/**
 * Get canonical ULID for SQLite lookups
 *
 * Returns undefined if ID not found in SQLite.
 */
export function toCanonicalId(id: string, source = 'familysearch'): string | undefined {
  return resolvePersonId(id, source).canonical;
}
