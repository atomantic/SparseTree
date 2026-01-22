import fs from 'fs';
import path from 'path';
import type { SparseTreeNode, SparseTreeResult, Database, FavoriteData, PersonAugmentation } from '@fsf/shared';
import { databaseService } from './database.service.js';
import { favoritesService } from './favorites.service.js';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
const AUGMENT_DIR = path.join(DATA_DIR, 'augment');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

/**
 * BFS to find shortest path from source to target through parents (ancestors)
 * This traverses upward from the root person to their ancestors
 */
function findShortestPath(db: Database, source: string, target: string): string[] {
  const queue = [source];
  const visited: Record<string, boolean> = { [source]: true };
  const cameFrom: Record<string, string> = {};

  while (queue.length > 0) {
    const id = queue.shift()!;
    const person = db[id];
    if (!person) continue;

    // Traverse parents to find ancestors
    const parentIds = person.parents || [];
    for (const parentId of parentIds) {
      if (!parentId || visited[parentId]) continue;
      visited[parentId] = true;

      if (parentId === target) {
        const pathArr = [parentId];
        let current = id;
        while (current !== source) {
          pathArr.push(current);
          current = cameFrom[current];
        }
        pathArr.push(source);
        pathArr.reverse();
        return pathArr;
      }

      cameFrom[parentId] = id;
      queue.push(parentId);
    }
  }

  return [];
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
 * Priority: Ancestry > WikiTree > Wikipedia > FamilySearch scraped
 */
function getPhotoUrl(personId: string): string | undefined {
  // Check for Ancestry photo (highest priority)
  const ancestryJpgPath = path.join(PHOTOS_DIR, `${personId}-ancestry.jpg`);
  const ancestryPngPath = path.join(PHOTOS_DIR, `${personId}-ancestry.png`);
  if (fs.existsSync(ancestryJpgPath) || fs.existsSync(ancestryPngPath)) {
    return `/api/augment/${personId}/ancestry-photo`;
  }

  // Check for WikiTree photo
  const wikiTreeJpgPath = path.join(PHOTOS_DIR, `${personId}-wikitree.jpg`);
  const wikiTreePngPath = path.join(PHOTOS_DIR, `${personId}-wikitree.png`);
  if (fs.existsSync(wikiTreeJpgPath) || fs.existsSync(wikiTreePngPath)) {
    return `/api/augment/${personId}/wikitree-photo`;
  }

  // Check for Wikipedia photo
  const wikiJpgPath = path.join(PHOTOS_DIR, `${personId}-wiki.jpg`);
  const wikiPngPath = path.join(PHOTOS_DIR, `${personId}-wiki.png`);
  if (fs.existsSync(wikiJpgPath) || fs.existsSync(wikiPngPath)) {
    return `/api/augment/${personId}/wiki-photo`;
  }

  // Check for scraped FamilySearch photo
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
   */
  async getSparseTree(dbId: string): Promise<SparseTreeResult> {
    const dbInfo = await databaseService.getDatabaseInfo(dbId);
    const db = await databaseService.getDatabase(dbId);
    const rootId = dbInfo.rootId;

    // Get all favorites in this database
    const favoritesInDb = await favoritesService.getFavoritesInDatabase(dbId);

    if (favoritesInDb.length === 0) {
      // Return just root with no children
      const rootPerson = db[rootId];
      const rootFavorite = getFavoriteData(rootId);
      return {
        root: {
          id: rootId,
          name: rootPerson?.name || rootId,
          lifespan: rootPerson?.lifespan || '',
          photoUrl: getPhotoUrl(rootId),
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

    // Find shortest path from root to each favorite
    const paths: Map<string, string[]> = new Map();
    for (const fav of favoritesInDb) {
      const pathArr = findShortestPath(db, rootId, fav.personId);
      if (pathArr.length > 0) {
        paths.set(fav.personId, pathArr);
      }
    }

    const favoriteIds = new Set(favoritesInDb.map(f => f.personId));

    // Build a full tree structure from all paths
    interface TreeBuildNode {
      id: string;
      generation: number;
      children: Map<string, TreeBuildNode>;
    }

    const fullTree: TreeBuildNode = {
      id: rootId,
      generation: 0,
      children: new Map(),
    };

    // Add all paths to tree
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

    // Find nodes that should be shown: favorites, root, and branch points (non-favorites with 2+ children leading to favorites)
    const nodesToShow = new Set<string>([rootId, ...favoriteIds]);

    const findBranchPoints = (node: TreeBuildNode): boolean => {
      // Returns true if this node has any favorite descendants
      if (favoriteIds.has(node.id)) return true;

      let branchesWithFavorites = 0;
      for (const [, child] of node.children) {
        if (findBranchPoints(child)) {
          branchesWithFavorites++;
        }
      }

      // If this non-favorite node has 2+ branches leading to favorites, it's a branch point
      if (branchesWithFavorites >= 2 && !favoriteIds.has(node.id) && node.id !== rootId) {
        nodesToShow.add(node.id);
      }

      return branchesWithFavorites > 0;
    };

    findBranchPoints(fullTree);

    // Build sparse tree showing only selected nodes
    const buildSparseNode = (node: TreeBuildNode, lastShownGeneration: number): SparseTreeNode | null => {
      const shouldShow = nodesToShow.has(node.id);
      const person = db[node.id];
      const favorite = getFavoriteData(node.id);

      // Recursively build children
      const childResults: SparseTreeNode[] = [];
      for (const [, child] of node.children) {
        const childResult = buildSparseNode(child, shouldShow ? node.generation : lastShownGeneration);
        if (childResult) {
          // If child is a "pass-through" (not shown), merge its children up
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

      // Not shown - pass children through
      if (childResults.length === 1) {
        return childResults[0];
      }
      if (childResults.length > 1) {
        // Return a placeholder to pass multiple children up
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

    // Calculate max generation
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
        id: rootId,
        name: db[rootId]?.name || rootId,
        lifespan: db[rootId]?.lifespan || '',
        generationFromRoot: 0,
        isFavorite: favoriteIds.has(rootId),
      },
      totalFavorites: favoritesInDb.length,
      maxGeneration,
    };
  },
};
