import fs from 'fs';
import path from 'path';
import type { SparseTreeNode, SparseTreeResult, FavoriteData, PersonAugmentation } from '@fsf/shared';
import { databaseService } from './database.service.js';
import { favoritesService } from './favorites.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
const AUGMENT_DIR = path.join(DATA_DIR, 'augment');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

/**
 * Get a path from root DOWN to an ancestor (favorite)
 * Root is the "self" person (descendant), favorites are ancestors
 * We walk UP from root to find the ancestor, then reverse the path
 */
function getPathToAncestor(rootId: string, ancestorId: string, maxDepth = 100): string[] {
  // BFS from root upward to find ancestor
  // We need to search broadly since we don't know which parent line leads to the ancestor
  const visited = new Set<string>([rootId]);
  const parent: Map<string, string> = new Map(); // Maps child -> parent used to reach child
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === ancestorId) {
      // Reconstruct path from root to ancestor
      const path: string[] = [ancestorId];
      let node = ancestorId;
      while (parent.has(node)) {
        node = parent.get(node)!;
        path.push(node);
      }
      return path.reverse(); // Reverse to get root -> ancestor order
    }

    if (current.depth >= maxDepth) continue;

    // Get parents of current person
    const parents = sqliteService.queryAll<{ parent_id: string }>(
      'SELECT parent_id FROM parent_edge WHERE child_id = @current',
      { current: current.id }
    );

    for (const p of parents) {
      if (!visited.has(p.parent_id)) {
        visited.add(p.parent_id);
        parent.set(p.parent_id, current.id);
        queue.push({ id: p.parent_id, depth: current.depth + 1 });
      }
    }
  }

  return []; // No path found
}

/**
 * Batch fetch person data for a list of IDs from SQLite
 */
function batchFetchPersons(personIds: string[]): Map<string, { name: string; lifespan: string }> {
  if (personIds.length === 0) return new Map();

  const placeholders = personIds.map((_, i) => `@id${i}`).join(',');
  const params: Record<string, string> = {};
  personIds.forEach((id, i) => { params[`id${i}`] = id; });

  const rows = sqliteService.queryAll<{
    person_id: string;
    display_name: string;
    birth_year: number | null;
    death_year: number | null;
  }>(
    `SELECT p.person_id, p.display_name,
      (SELECT date_year FROM vital_event WHERE person_id = p.person_id AND event_type = 'birth') as birth_year,
      (SELECT date_year FROM vital_event WHERE person_id = p.person_id AND event_type = 'death') as death_year
     FROM person p
     WHERE p.person_id IN (${placeholders})`,
    params
  );

  const result = new Map<string, { name: string; lifespan: string }>();
  for (const row of rows) {
    const birthStr = row.birth_year ? String(row.birth_year) : '';
    const deathStr = row.death_year ? String(row.death_year) : '';
    const lifespan = birthStr || deathStr ? `${birthStr}-${deathStr}` : '';
    result.set(row.person_id, {
      name: row.display_name,
      lifespan,
    });
  }
  return result;
}

/**
 * Get favorite data for a person
 */
function getFavoriteData(personId: string): FavoriteData | null {
  const filePath = path.join(AUGMENT_DIR, `${personId}.json`);
  if (!fs.existsSync(filePath)) return null;
  const data: PersonAugmentation = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.favorite?.isFavorite ? data.favorite : null;
}

/**
 * Get photo URL for a person
 */
function getPhotoUrl(personId: string): string | undefined {
  const ancestryJpgPath = path.join(PHOTOS_DIR, `${personId}-ancestry.jpg`);
  const ancestryPngPath = path.join(PHOTOS_DIR, `${personId}-ancestry.png`);
  if (fs.existsSync(ancestryJpgPath) || fs.existsSync(ancestryPngPath)) {
    return `/api/augment/${personId}/ancestry-photo`;
  }

  const wikiTreeJpgPath = path.join(PHOTOS_DIR, `${personId}-wikitree.jpg`);
  const wikiTreePngPath = path.join(PHOTOS_DIR, `${personId}-wikitree.png`);
  if (fs.existsSync(wikiTreeJpgPath) || fs.existsSync(wikiTreePngPath)) {
    return `/api/augment/${personId}/wikitree-photo`;
  }

  const wikiJpgPath = path.join(PHOTOS_DIR, `${personId}-wiki.jpg`);
  const wikiPngPath = path.join(PHOTOS_DIR, `${personId}-wiki.png`);
  if (fs.existsSync(wikiJpgPath) || fs.existsSync(wikiPngPath)) {
    return `/api/augment/${personId}/wiki-photo`;
  }

  const jpgPath = path.join(PHOTOS_DIR, `${personId}.jpg`);
  const pngPath = path.join(PHOTOS_DIR, `${personId}.png`);
  if (fs.existsSync(jpgPath) || fs.existsSync(pngPath)) {
    return `/api/browser/photos/${personId}`;
  }

  return undefined;
}

export const sparseTreeService = {
  /**
   * Generate a sparse tree showing only favorites and their paths from root
   * Uses reverse traversal (from each favorite to root) for efficiency
   */
  async getSparseTree(dbId: string): Promise<SparseTreeResult> {
    const dbInfo = await databaseService.getDatabaseInfo(dbId);
    const rootId = dbInfo.rootId;

    // Get all favorites in this database
    const favoritesInDb = await favoritesService.getFavoritesInDatabase(dbId);

    // Resolve rootId to canonical ID for SQLite queries
    const canonicalRootId = idMappingService.resolveId(rootId, 'familysearch') || rootId;

    if (favoritesInDb.length === 0) {
      const rootData = batchFetchPersons([canonicalRootId]).get(canonicalRootId);
      const rootFavorite = getFavoriteData(canonicalRootId);
      return {
        root: {
          id: canonicalRootId,
          name: rootData?.name || rootId,
          lifespan: rootData?.lifespan || '',
          photoUrl: getPhotoUrl(canonicalRootId),
          whyInteresting: rootFavorite?.whyInteresting,
          tags: rootFavorite?.tags,
          generationFromRoot: 0,
          isFavorite: !!rootFavorite,
          children: [],
        },
        totalFavorites: 0,
        maxGeneration: 0,
      };
    }

    // Get ancestor chain for each favorite (reverse traversal - fast!)
    const paths: Map<string, string[]> = new Map();
    const allPersonIds = new Set<string>([canonicalRootId]);

    for (const fav of favoritesInDb) {
      const canonicalFavId = idMappingService.resolveId(fav.personId, 'familysearch') || fav.personId;
      const pathArr = getPathToAncestor(canonicalRootId, canonicalFavId);
      if (pathArr.length > 0 && pathArr[0] === canonicalRootId) {
        paths.set(canonicalFavId, pathArr);
        pathArr.forEach(id => allPersonIds.add(id));
      }
    }

    // Batch fetch all person data we need
    const personData = batchFetchPersons([...allPersonIds]);

    const favoriteIds = new Set(favoritesInDb.map(f =>
      idMappingService.resolveId(f.personId, 'familysearch') || f.personId
    ));

    // Build tree structure from paths
    interface TreeBuildNode {
      id: string;
      generation: number;
      children: Map<string, TreeBuildNode>;
    }

    const fullTree: TreeBuildNode = {
      id: canonicalRootId,
      generation: 0,
      children: new Map(),
    };

    for (const [, pathArr] of paths) {
      let current = fullTree;
      for (let i = 1; i < pathArr.length; i++) {
        const nodeId = pathArr[i];
        if (!current.children.has(nodeId)) {
          current.children.set(nodeId, {
            id: nodeId,
            generation: i,
            children: new Map(),
          });
        }
        current = current.children.get(nodeId)!;
      }
    }

    // Find branch points
    const nodesToShow = new Set<string>([canonicalRootId, ...favoriteIds]);

    const findBranchPoints = (node: TreeBuildNode): boolean => {
      if (favoriteIds.has(node.id)) return true;

      let branchesWithFavorites = 0;
      for (const [, child] of node.children) {
        if (findBranchPoints(child)) {
          branchesWithFavorites++;
        }
      }

      if (branchesWithFavorites >= 2 && !favoriteIds.has(node.id) && node.id !== canonicalRootId) {
        nodesToShow.add(node.id);
      }

      return branchesWithFavorites > 0;
    };

    findBranchPoints(fullTree);

    // Build sparse tree
    const buildSparseNode = (node: TreeBuildNode, lastShownGeneration: number): SparseTreeNode | null => {
      const shouldShow = nodesToShow.has(node.id);
      const person = personData.get(node.id);
      const favorite = getFavoriteData(node.id);

      const childResults: SparseTreeNode[] = [];
      for (const [, child] of node.children) {
        const childResult = buildSparseNode(child, shouldShow ? node.generation : lastShownGeneration);
        if (childResult) {
          if (Array.isArray(childResult.children) && !nodesToShow.has(childResult.id)) {
            childResults.push(...childResult.children);
          } else {
            childResults.push(childResult);
          }
        }
      }

      if (shouldShow) {
        const generationsSkipped = node.generation - lastShownGeneration - 1;
        return {
          id: node.id,
          name: person?.name || node.id,
          lifespan: person?.lifespan || '',
          photoUrl: getPhotoUrl(node.id),
          whyInteresting: favorite?.whyInteresting,
          tags: favorite?.tags,
          generationFromRoot: node.generation,
          generationsSkipped: generationsSkipped > 0 ? generationsSkipped : undefined,
          isFavorite: favoriteIds.has(node.id),
          children: childResults.length > 0 ? childResults : undefined,
        };
      }

      if (childResults.length === 1) {
        return childResults[0];
      }
      if (childResults.length > 1) {
        return {
          id: node.id,
          name: '',
          lifespan: '',
          generationFromRoot: node.generation,
          isFavorite: false,
          children: childResults,
        };
      }
      return null;
    };

    const sparseRoot = buildSparseNode(fullTree, -1);

    let maxGeneration = 0;
    const findMaxGen = (node: SparseTreeNode) => {
      maxGeneration = Math.max(maxGeneration, node.generationFromRoot);
      node.children?.forEach(findMaxGen);
    };
    if (sparseRoot) {
      findMaxGen(sparseRoot);
    }

    return {
      root: sparseRoot || {
        id: canonicalRootId,
        name: personData.get(canonicalRootId)?.name || rootId,
        lifespan: personData.get(canonicalRootId)?.lifespan || '',
        generationFromRoot: 0,
        isFavorite: favoriteIds.has(canonicalRootId),
      },
      totalFavorites: favoritesInDb.length,
      maxGeneration,
    };
  },
};
