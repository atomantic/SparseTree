import fs from 'fs';
import path from 'path';
import type { SparseTreeNode, SparseTreeResult, FavoriteData, PersonAugmentation } from '@fsf/shared';
import { databaseService } from './database.service.js';
import { favoritesService } from './favorites.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';
import { AUGMENT_DIR, PHOTOS_DIR } from '../utils/paths.js';
import { batchFetchPersons } from '../utils/batchFetchPersons.js';

// Path step with lineage information
interface PathStep {
  personId: string;
  roleFromPrevious?: 'father' | 'mother' | 'unknown';  // How we got here from the previous node
}

/**
 * Get a path from root DOWN to an ancestor (favorite) with lineage info
 * Root is the "self" person (descendant), favorites are ancestors
 * We walk UP from root to find the ancestor, then reverse the path
 */
function getPathToAncestorWithLineage(rootId: string, ancestorId: string, maxDepth = 100): PathStep[] {
  // BFS from root upward to find ancestor
  const visited = new Set<string>([rootId]);
  // Maps child -> { parent, role } used to reach child
  const parentInfo: Map<string, { parentId: string; role: 'father' | 'mother' | 'unknown' }> = new Map();
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === ancestorId) {
      // Reconstruct path from root to ancestor with roles
      const path: PathStep[] = [];
      let node = ancestorId;
      while (parentInfo.has(node)) {
        const info = parentInfo.get(node)!;
        path.push({ personId: node, roleFromPrevious: info.role });
        node = info.parentId;
      }
      path.push({ personId: rootId }); // Root has no roleFromPrevious
      return path.reverse(); // Reverse to get root -> ancestor order
    }

    if (current.depth >= maxDepth) continue;

    // Get parents of current person with role info
    const parents = sqliteService.queryAll<{ parent_id: string; parent_role: string | null }>(
      'SELECT parent_id, parent_role FROM parent_edge WHERE child_id = @current',
      { current: current.id }
    );

    for (const p of parents) {
      if (!visited.has(p.parent_id)) {
        visited.add(p.parent_id);
        const role = p.parent_role === 'father' ? 'father' :
                     p.parent_role === 'mother' ? 'mother' : 'unknown';
        parentInfo.set(p.parent_id, { parentId: current.id, role });
        queue.push({ id: p.parent_id, depth: current.depth + 1 });
      }
    }
  }

  return []; // No path found
}

/**
 * Determine the overall lineage of a path based on the first step from root
 */
function getPathLineage(path: PathStep[]): 'paternal' | 'maternal' | 'unknown' {
  if (path.length < 2) return 'unknown';
  const firstStep = path[1]?.roleFromPrevious;
  if (firstStep === 'father') return 'paternal';
  if (firstStep === 'mother') return 'maternal';
  return 'unknown';
}


/**
 * Get favorite data for a person
 */
function getFavoriteData(personId: string): FavoriteData | null {
  const filePath = path.join(AUGMENT_DIR, `${personId}.json`);
  if (!fs.existsSync(filePath)) return null;
  let data: PersonAugmentation;
  try { data = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
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
          nodeType: 'person',
        },
        totalFavorites: 0,
        maxGeneration: 0,
      };
    }

    // Get ancestor chain for each favorite with lineage info (reverse traversal - fast!)
    const paths: Map<string, PathStep[]> = new Map();
    const pathLineages: Map<string, 'paternal' | 'maternal' | 'unknown'> = new Map();
    const allPersonIds = new Set<string>([canonicalRootId]);

    for (const fav of favoritesInDb) {
      const canonicalFavId = idMappingService.resolveId(fav.personId, 'familysearch') || fav.personId;
      const pathArr = getPathToAncestorWithLineage(canonicalRootId, canonicalFavId);
      if (pathArr.length > 0 && pathArr[0]?.personId === canonicalRootId) {
        paths.set(canonicalFavId, pathArr);
        pathLineages.set(canonicalFavId, getPathLineage(pathArr));
        pathArr.forEach(step => allPersonIds.add(step.personId));
      }
    }

    // Batch fetch all person data we need
    const personData = batchFetchPersons([...allPersonIds]);

    const favoriteIds = new Set(favoritesInDb.map(f =>
      idMappingService.resolveId(f.personId, 'familysearch') || f.personId
    ));

    // Build tree structure from paths with lineage tracking
    interface TreeBuildNode {
      id: string;
      generation: number;
      children: Map<string, TreeBuildNode>;
      lineageFromParent?: 'paternal' | 'maternal' | 'unknown';  // Track lineage from parent
      isJunction?: boolean;
      junctionLineage?: 'paternal' | 'maternal' | 'unknown';
    }

    const fullTree: TreeBuildNode = {
      id: canonicalRootId,
      generation: 0,
      children: new Map(),
    };

    // Build tree with lineage info for each edge
    for (const [, pathArr] of paths) {
      let current = fullTree;
      for (let i = 1; i < pathArr.length; i++) {
        const step = pathArr[i];
        const nodeId = step.personId;
        const lineage = step.roleFromPrevious === 'father' ? 'paternal' :
                       step.roleFromPrevious === 'mother' ? 'maternal' : 'unknown';

        if (!current.children.has(nodeId)) {
          current.children.set(nodeId, {
            id: nodeId,
            generation: i,
            children: new Map(),
            lineageFromParent: lineage,
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

    // Build sparse tree with lineage info on person nodes (no separate junction nodes)
    const buildSparseNode = (node: TreeBuildNode, lastShownGeneration: number): SparseTreeNode | null => {
      const shouldShow = nodesToShow.has(node.id);
      const person = personData.get(node.id);
      const favorite = getFavoriteData(node.id);

      const childResults: SparseTreeNode[] = [];
      for (const [, child] of node.children) {
        const childResult = buildSparseNode(child, shouldShow ? node.generation : lastShownGeneration);
        if (childResult) {
          // Add lineage info to the child based on how it connects to this node
          // Use child.lineageFromParent directly instead of searching the tree (O(1) vs O(n))
          if (child.lineageFromParent) {
            childResult.lineageFromParent = child.lineageFromParent;
          }

          if (Array.isArray(childResult.children) && !nodesToShow.has(childResult.id)) {
            // When collapsing a node, its children should inherit the collapsed node's lineage
            // This preserves the correct badge connection from the visible ancestor
            for (const grandchild of childResult.children) {
              grandchild.lineageFromParent = child.lineageFromParent;
            }
            childResults.push(...childResult.children);
          } else {
            childResults.push(childResult);
          }
        }
      }

      // Determine which lineage badges this node should show (based on its children's lineages)
      let hasPaternal = false;
      let hasMaternal = false;
      for (const child of childResults) {
        if (child.lineageFromParent === 'paternal') hasPaternal = true;
        if (child.lineageFromParent === 'maternal') hasMaternal = true;
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
          nodeType: 'person',
          hasPaternal: hasPaternal || undefined,
          hasMaternal: hasMaternal || undefined,
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
          nodeType: 'person',
          hasPaternal: hasPaternal || undefined,
          hasMaternal: hasMaternal || undefined,
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
        nodeType: 'person',
      },
      totalFavorites: favoritesInDb.length,
      maxGeneration,
    };
  },
};
