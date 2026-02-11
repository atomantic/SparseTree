/**
 * Map Data Service
 *
 * Assembles map visualization data by joining person/tree data
 * with geocoded coordinates from the place_geocode cache.
 */

import type { AncestryFamilyUnit, MapCoords, MapPerson, MapData } from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';
import { geocodeService } from './geocode.service.js';
import { ancestryTreeService } from './ancestry-tree.service.js';
import { sparseTreeService } from './sparse-tree.service.js';
import { logger } from '../lib/logger.js';

export type { MapCoords, MapPerson, MapData } from '@fsf/shared';

/**
 * Get person data with places from SQLite for a list of person IDs
 */
function getPersonsWithPlaces(personIds: string[]): Map<string, {
  name: string;
  gender: string;
  birthPlace: string | null;
  birthYear: number | null;
  deathPlace: string | null;
  deathYear: number | null;
  photoUrl: string | null;
}> {
  const result = new Map();
  if (personIds.length === 0) return result;

  const CHUNK = 500;
  for (let i = 0; i < personIds.length; i += CHUNK) {
    const chunk = personIds.slice(i, i + CHUNK);
    const placeholders = chunk.map((_, j) => `@id${j}`).join(',');
    const params: Record<string, string> = {};
    chunk.forEach((id, j) => { params[`id${j}`] = id; });

    const rows = sqliteService.queryAll<{
      person_id: string;
      display_name: string;
      gender: string | null;
      birth_place: string | null;
      birth_year: number | null;
      death_place: string | null;
      death_year: number | null;
    }>(
      `SELECT p.person_id, p.display_name, p.gender,
        vb.place AS birth_place, vb.date_year AS birth_year,
        vd.place AS death_place, vd.date_year AS death_year
       FROM person p
       LEFT JOIN vital_event vb ON vb.person_id = p.person_id AND vb.event_type = 'birth'
       LEFT JOIN vital_event vd ON vd.person_id = p.person_id AND vd.event_type = 'death'
       WHERE p.person_id IN (${placeholders})
       GROUP BY p.person_id`,
      params
    );

    for (const row of rows) {
      result.set(row.person_id, {
        name: row.display_name,
        gender: row.gender || 'unknown',
        birthPlace: row.birth_place,
        birthYear: row.birth_year,
        deathPlace: row.death_place,
        deathYear: row.death_year,
        photoUrl: null, // Photos resolved separately if needed
      });
    }
  }

  return result;
}

/**
 * Flatten an ancestry tree into a list of person IDs with generation/lineage info.
 * parentId stores the connected person for migration line drawing.
 * NOTE: In ancestry trees (walking upward), parentId points to the descendant/child.
 * In sparse trees (walking downward), parentId points to the ancestor/parent.
 * buildMigrationLines normalizes direction using generation numbers.
 */
function flattenAncestryTree(
  units: AncestryFamilyUnit[] | undefined,
  generation: number,
  lineage: 'paternal' | 'maternal' | 'self',
  descendantId: string | undefined,
  result: Array<{ id: string; generation: number; lineage: 'paternal' | 'maternal' | 'self'; parentId?: string }>
): void {
  if (!units) return;

  for (const unit of units) {
    if (unit.father) {
      result.push({ id: unit.father.id, generation, lineage: lineage === 'self' ? 'paternal' : lineage, parentId: descendantId });
      flattenAncestryTree(unit.fatherParentUnits, generation + 1, lineage === 'self' ? 'paternal' : lineage, unit.father.id, result);
    }
    if (unit.mother) {
      result.push({ id: unit.mother.id, generation, lineage: lineage === 'self' ? 'maternal' : lineage, parentId: descendantId });
      flattenAncestryTree(unit.motherParentUnits, generation + 1, lineage === 'self' ? 'maternal' : lineage, unit.mother.id, result);
    }
  }
}

/**
 * Join person data with geocoded coordinates.
 * Only includes persons with at least one geocoded coordinate.
 * Ungeocoded tracks places that are pending or errored (excludes not_found).
 */
function buildMapPersons(
  personEntries: Array<{ id: string; generation: number; lineage: 'paternal' | 'maternal' | 'self'; parentId?: string; isFavorite?: boolean }>,
  personsData: Map<string, { name: string; gender: string; birthPlace: string | null; birthYear: number | null; deathPlace: string | null; deathYear: number | null; photoUrl: string | null }>,
  coordsMap: Map<string, { lat: number; lng: number; displayName: string }>,
  notFoundPlaces: Set<string>
): { persons: MapPerson[]; ungeocoded: Set<string> } {
  const persons: MapPerson[] = [];
  const ungeocoded = new Set<string>();

  for (const entry of personEntries) {
    const data = personsData.get(entry.id);
    if (!data) continue;

    const birthNorm = data.birthPlace ? geocodeService.normalizePlaceText(data.birthPlace) : null;
    const deathNorm = data.deathPlace ? geocodeService.normalizePlaceText(data.deathPlace) : null;

    const birthCoords = birthNorm ? coordsMap.get(birthNorm) : undefined;
    const deathCoords = deathNorm ? coordsMap.get(deathNorm) : undefined;

    // Track ungeocoded places (pending/error only, not not_found)
    if (data.birthPlace && !birthCoords && birthNorm && !notFoundPlaces.has(birthNorm)) {
      ungeocoded.add(data.birthPlace);
    }
    if (data.deathPlace && !deathCoords && deathNorm && !notFoundPlaces.has(deathNorm)) {
      ungeocoded.add(data.deathPlace);
    }

    // Only include persons with at least one geocoded place
    if (!birthCoords && !deathCoords) continue;

    const lifespan = [
      data.birthYear ? String(data.birthYear) : '',
      data.deathYear ? String(data.deathYear) : ''
    ].filter(Boolean).join('-') || '';

    persons.push({
      id: entry.id,
      name: data.name,
      lifespan,
      gender: data.gender as 'male' | 'female' | 'unknown',
      generation: entry.generation,
      lineage: entry.lineage,
      birthPlace: data.birthPlace || undefined,
      birthCoords: birthCoords ? { lat: birthCoords.lat, lng: birthCoords.lng } : undefined,
      birthYear: data.birthYear || undefined,
      deathPlace: data.deathPlace || undefined,
      deathCoords: deathCoords ? { lat: deathCoords.lat, lng: deathCoords.lng } : undefined,
      deathYear: data.deathYear || undefined,
      isFavorite: entry.isFavorite,
      parentId: entry.parentId,
    });
  }

  return { persons, ungeocoded };
}

export const mapService = {
  /**
   * Get map data for an ancestry tree view
   */
  async getAncestryMapData(dbId: string, personId: string, depth = 8): Promise<MapData> {
    logger.time('map', 'getAncestryMapData');

    // Load ancestry tree
    const tree = await ancestryTreeService.getAncestryTree(dbId, personId, depth);
    if (!tree) {
      return { persons: [], ungeocoded: [], geocodeStats: geocodeService.getGeocodeStats() };
    }

    // Flatten tree to list with generation/lineage
    const entries: Array<{ id: string; generation: number; lineage: 'paternal' | 'maternal' | 'self'; parentId?: string }> = [
      { id: tree.rootPerson.id, generation: 0, lineage: 'self' }
    ];
    flattenAncestryTree(tree.parentUnits, 1, 'self', tree.rootPerson.id, entries);

    // Get unique person IDs
    const personIds = [...new Set(entries.map(e => e.id))];

    // Fetch person data with places
    const personsData = getPersonsWithPlaces(personIds);

    // Get all resolved coordinates and not_found places for filtering
    const coordsMap = geocodeService.getResolvedCoords();
    const notFoundPlaces = geocodeService.getNotFoundPlaces();

    // Build map persons
    const { persons, ungeocoded } = buildMapPersons(entries, personsData, coordsMap, notFoundPlaces);

    logger.timeEnd('map', 'getAncestryMapData');

    return {
      persons,
      ungeocoded: [...ungeocoded],
      geocodeStats: geocodeService.getGeocodeStats(),
    };
  },

  /**
   * Get map data for sparse tree (favorites only)
   */
  async getSparseTreeMapData(dbId: string): Promise<MapData> {
    logger.time('map', 'getSparseTreeMapData');

    const sparseTree = await sparseTreeService.getSparseTree(dbId);

    // Flatten sparse tree nodes
    const entries: Array<{ id: string; generation: number; lineage: 'paternal' | 'maternal' | 'self'; parentId?: string; isFavorite?: boolean }> = [];

    const flattenSparseNode = (
      node: typeof sparseTree.root,
      parentId?: string
    ) => {
      const lineage: 'paternal' | 'maternal' | 'self' =
        node.lineageFromParent === 'paternal' ? 'paternal' :
        node.lineageFromParent === 'maternal' ? 'maternal' :
        'self';

      entries.push({
        id: node.id,
        generation: node.generationFromRoot,
        lineage,
        parentId,
        isFavorite: node.isFavorite,
      });

      if (node.children) {
        for (const child of node.children) {
          flattenSparseNode(child, node.id);
        }
      }
    };

    flattenSparseNode(sparseTree.root);

    // Get unique person IDs
    const personIds = [...new Set(entries.map(e => e.id))];

    // Fetch person data with places
    const personsData = getPersonsWithPlaces(personIds);

    // Get all resolved coordinates and not_found places for filtering
    const coordsMap = geocodeService.getResolvedCoords();
    const notFoundPlaces = geocodeService.getNotFoundPlaces();

    // Build map persons
    const { persons, ungeocoded } = buildMapPersons(entries, personsData, coordsMap, notFoundPlaces);

    logger.timeEnd('map', 'getSparseTreeMapData');

    return {
      persons,
      ungeocoded: [...ungeocoded],
      geocodeStats: geocodeService.getGeocodeStats(),
    };
  },

  /**
   * Collect all unique places from a database that need geocoding
   */
  getUngeocodedPlaces(dbId: string): string[] {
    // Get database info to find the canonical ID
    const dbInfo = sqliteService.queryOne<{ db_id: string }>(
      'SELECT db_id FROM database_info WHERE db_id = @dbId',
      { dbId }
    );
    const resolvedDbId = dbInfo?.db_id || dbId;

    // Get all unique places from persons in this database
    const rows = sqliteService.queryAll<{ place: string }>(
      `SELECT DISTINCT ve.place FROM vital_event ve
       JOIN database_membership dm ON dm.person_id = ve.person_id
       WHERE dm.db_id = @dbId AND ve.place IS NOT NULL AND ve.place != ''`,
      { dbId: resolvedDbId }
    );

    const allPlaces = rows.map(r => r.place);

    // Filter to only ungeocoded places
    const coordsMap = geocodeService.getResolvedCoords();
    return allPlaces.filter(place => {
      const normalized = geocodeService.normalizePlaceText(place);
      if (coordsMap.has(normalized)) return false;
      // Also check if marked as not_found
      const cached = geocodeService.lookupPlace(normalized);
      return !cached || cached.geocode_status === 'pending' || cached.geocode_status === 'error';
    });
  },
};
