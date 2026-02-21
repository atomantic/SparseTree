import type { PathResult, PersonWithId } from '@fsf/shared';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';
import { batchFetchPersons } from '../utils/batchFetchPersons.js';

/**
 * Build ancestry map for a person using iterative BFS
 * Returns map of ancestor_id -> { parent: who_led_here, depth }
 */
function buildAncestryMap(
  startId: string,
  maxDepth = 100
): Map<string, { parent: string; depth: number }> {
  const ancestors = new Map<string, { parent: string; depth: number }>();
  ancestors.set(startId, { parent: '', depth: 0 });

  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    const parents = sqliteService.queryAll<{ parent_id: string }>(
      'SELECT parent_id FROM parent_edge WHERE child_id = @id',
      { id: current.id }
    );

    for (const p of parents) {
      if (!ancestors.has(p.parent_id)) {
        ancestors.set(p.parent_id, { parent: current.id, depth: current.depth + 1 });
        queue.push({ id: p.parent_id, depth: current.depth + 1 });
      }
    }
  }

  return ancestors;
}

/**
 * Find path between two people by finding common ancestors
 * Returns the shortest path through their genealogical connection
 */
function findPathViaCommonAncestor(
  sourceId: string,
  targetId: string,
  preferLongest = false
): string[] | null {
  // Build ancestry maps for both people
  const sourceAncestors = buildAncestryMap(sourceId);
  const targetAncestors = buildAncestryMap(targetId);

  // Find common ancestors
  const commonAncestors: Array<{ id: string; totalDepth: number }> = [];
  for (const [ancestorId, sourceInfo] of sourceAncestors) {
    if (targetAncestors.has(ancestorId)) {
      const targetInfo = targetAncestors.get(ancestorId)!;
      commonAncestors.push({
        id: ancestorId,
        totalDepth: sourceInfo.depth + targetInfo.depth,
      });
    }
  }

  if (commonAncestors.length === 0) return null;

  // Sort by total path length
  commonAncestors.sort((a, b) =>
    preferLongest ? b.totalDepth - a.totalDepth : a.totalDepth - b.totalDepth
  );

  const chosenAncestor = commonAncestors[0].id;

  // Build path from source to common ancestor
  const pathToAncestor: string[] = [];
  let current = chosenAncestor;
  while (current !== sourceId) {
    pathToAncestor.unshift(current);
    const info = sourceAncestors.get(current);
    if (!info || !info.parent) break;
    current = info.parent;
  }
  pathToAncestor.unshift(sourceId);

  // Build path from common ancestor to target
  const pathFromAncestor: string[] = [];
  current = chosenAncestor;
  while (current !== targetId) {
    const info = targetAncestors.get(current);
    if (!info || !info.parent) break;
    current = info.parent;
    pathFromAncestor.push(current);
  }

  // Combine paths (common ancestor appears once)
  return [...pathToAncestor, ...pathFromAncestor];
}

/**
 * Find a random path between two people
 */
function findRandomPath(sourceId: string, targetId: string): string[] | null {
  const sourceAncestors = buildAncestryMap(sourceId);
  const targetAncestors = buildAncestryMap(targetId);

  // Find all common ancestors
  const commonAncestors: string[] = [];
  for (const ancestorId of sourceAncestors.keys()) {
    if (targetAncestors.has(ancestorId)) {
      commonAncestors.push(ancestorId);
    }
  }

  if (commonAncestors.length === 0) return null;

  // Pick a random common ancestor
  const chosenAncestor = commonAncestors[Math.floor(Math.random() * commonAncestors.length)];

  const MAX_ITERATIONS = 10000;

  // Build path from source to common ancestor
  const pathToAncestor: string[] = [];
  let current = chosenAncestor;
  const visitedUp = new Set<string>();
  let iterations = 0;
  while (current !== sourceId && iterations < MAX_ITERATIONS) {
    if (visitedUp.has(current)) break;
    visitedUp.add(current);
    pathToAncestor.unshift(current);
    const info = sourceAncestors.get(current);
    if (!info || !info.parent) break;
    current = info.parent;
    iterations++;
  }
  pathToAncestor.unshift(sourceId);

  // Build path from common ancestor to target
  const pathFromAncestor: string[] = [];
  current = chosenAncestor;
  const visitedDown = new Set<string>();
  iterations = 0;
  visitedDown.add(current);
  while (current !== targetId && iterations < MAX_ITERATIONS) {
    const info = targetAncestors.get(current);
    if (!info || !info.parent) break;
    if (visitedDown.has(info.parent)) break;
    visitedDown.add(info.parent);
    current = info.parent;
    pathFromAncestor.push(current);
    iterations++;
  }

  return [...pathToAncestor, ...pathFromAncestor];
}


/**
 * Convert path of canonical IDs to PersonWithId array
 */
function buildPathResult(
  pathCanonicalIds: string[],
  method: 'shortest' | 'longest' | 'random'
): PathResult {
  const personData = batchFetchPersons(pathCanonicalIds);

  const path: PersonWithId[] = pathCanonicalIds.map(id => {
    const data = personData.get(id);
    return {
      id,
      name: data?.name || id,
      lifespan: data?.lifespan || '',
      living: false,
      parents: [],
      children: [],
    };
  });

  return {
    path,
    length: path.length - 1,
    method,
  };
}

export const pathService = {
  async findPath(
    dbId: string,
    source: string,
    target: string,
    method: 'shortest' | 'longest' | 'random'
  ): Promise<PathResult> {
    // Resolve IDs to canonical ULIDs
    const sourceCanonical = idMappingService.resolveId(source, 'familysearch') || source;
    const targetCanonical = idMappingService.resolveId(target, 'familysearch') || target;

    // Check if source and target exist
    const sourceExists = sqliteService.queryOne<{ person_id: string }>(
      'SELECT person_id FROM person WHERE person_id = @id',
      { id: sourceCanonical }
    );
    const targetExists = sqliteService.queryOne<{ person_id: string }>(
      'SELECT person_id FROM person WHERE person_id = @id',
      { id: targetCanonical }
    );

    if (!sourceExists) {
      throw new Error(`Source person ${source} not found in database`);
    }
    if (!targetExists) {
      throw new Error(`Target person ${target} not found in database`);
    }

    let pathIds: string[] | null = null;

    switch (method) {
      case 'shortest':
        pathIds = findPathViaCommonAncestor(sourceCanonical, targetCanonical, false);
        break;
      case 'longest':
        pathIds = findPathViaCommonAncestor(sourceCanonical, targetCanonical, true);
        break;
      case 'random':
        pathIds = findRandomPath(sourceCanonical, targetCanonical);
        break;
    }

    if (!pathIds || pathIds.length === 0) {
      return { path: [], length: 0, method };
    }

    return buildPathResult(pathIds, method);
  },

  /**
   * Find all ancestors of a person up to a certain depth
   */
  async findAncestors(
    _dbId: string,
    personId: string,
    maxDepth: number = 10
  ): Promise<{ id: string; depth: number }[]> {
    const canonicalId = idMappingService.resolveId(personId, 'familysearch') || personId;

    // Use iterative BFS for ancestors
    const ancestors: { id: string; depth: number }[] = [];
    const visited = new Set<string>([canonicalId]);
    const queue: Array<{ id: string; depth: number }> = [{ id: canonicalId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      const parents = sqliteService.queryAll<{ parent_id: string }>(
        'SELECT parent_id FROM parent_edge WHERE child_id = @id',
        { id: current.id }
      );

      for (const p of parents) {
        if (!visited.has(p.parent_id)) {
          visited.add(p.parent_id);
          ancestors.push({ id: p.parent_id, depth: current.depth + 1 });
          queue.push({ id: p.parent_id, depth: current.depth + 1 });
        }
      }
    }

    return ancestors;
  },

  /**
   * Find all descendants of a person up to a certain depth
   */
  async findDescendants(
    _dbId: string,
    personId: string,
    maxDepth: number = 10
  ): Promise<{ id: string; depth: number }[]> {
    const canonicalId = idMappingService.resolveId(personId, 'familysearch') || personId;

    // Use iterative BFS for descendants
    const descendants: { id: string; depth: number }[] = [];
    const visited = new Set<string>([canonicalId]);
    const queue: Array<{ id: string; depth: number }> = [{ id: canonicalId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      const children = sqliteService.queryAll<{ child_id: string }>(
        'SELECT child_id FROM parent_edge WHERE parent_id = @id',
        { id: current.id }
      );

      for (const c of children) {
        if (!visited.has(c.child_id)) {
          visited.add(c.child_id);
          descendants.push({ id: c.child_id, depth: current.depth + 1 });
          queue.push({ id: c.child_id, depth: current.depth + 1 });
        }
      }
    }

    return descendants;
  },
};
