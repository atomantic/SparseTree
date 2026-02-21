import type { Response } from 'express';
import { idMappingService } from '../services/id-mapping.service.js';
import { isCanonicalId } from './validation.js';

/**
 * Resolve a personId (which may be an external ID) to a canonical ULID.
 * If the result is not a valid canonical ID, sends a 404 response and returns null.
 * The caller should return early when null is returned.
 */
export function resolveCanonicalOrFail(personId: string, res: Response): string | null {
  const canonical = idMappingService.resolveId(personId, 'familysearch') || personId;

  if (!isCanonicalId(canonical)) {
    res.status(404).json({
      success: false,
      error: 'Person not found in canonical database',
    });
    return null;
  }

  return canonical;
}
