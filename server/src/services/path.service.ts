import type { PathResult, PersonWithId } from '@fsf/shared';
import { databaseService } from './database.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import { idMappingService } from './id-mapping.service.js';

// Import existing path algorithms for fallback
const loadPathAlgorithms = async () => {
  const [shortest, longest, random] = await Promise.all([
    // @ts-expect-error - Legacy JS module without type declarations
    import('../../../lib/pathShortest.js'),
    // @ts-expect-error - Legacy JS module without type declarations
    import('../../../lib/pathLongest.js'),
    // @ts-expect-error - Legacy JS module without type declarations
    import('../../../lib/pathRandom.js'),
  ]);
  return {
    shortest: shortest.pathShortest,
    longest: longest.pathLongest,
    random: random.pathRandom,
  };
};

/**
 * Find shortest path using SQLite recursive CTE (BFS)
 */
function findShortestPathSqlite(
  sourceId: string,
  targetId: string
): string[] | null {
  // Recursive CTE to find path through parent_edge
  const result = sqliteService.queryAll<{
    path: string;
    depth: number;
  }>(
    `WITH RECURSIVE ancestry_path AS (
      -- Base case: start from source
      SELECT
        child_id as current_id,
        parent_id as next_id,
        parent_id || '' as path,
        1 as depth
      FROM parent_edge
      WHERE child_id = @sourceId

      UNION ALL

      -- Recursive case: follow parent edges
      SELECT
        pe.child_id,
        pe.parent_id,
        ap.path || ',' || pe.parent_id,
        ap.depth + 1
      FROM ancestry_path ap
      JOIN parent_edge pe ON pe.child_id = ap.next_id
      WHERE ap.depth < 100  -- Prevent infinite loops
      AND ap.path NOT LIKE '%' || pe.parent_id || '%'  -- Cycle detection
    )
    SELECT path, depth
    FROM ancestry_path
    WHERE next_id = @targetId
    ORDER BY depth ASC
    LIMIT 1`,
    { sourceId, targetId }
  );

  if (result.length === 0) return null;

  // Parse path and prepend source
  const pathIds = [sourceId, ...result[0].path.split(',')];
  return pathIds;
}

/**
 * Find all paths and return the longest one using SQLite
 */
function findLongestPathSqlite(
  sourceId: string,
  targetId: string
): string[] | null {
  // Get all paths up to a reasonable depth
  const result = sqliteService.queryAll<{
    path: string;
    depth: number;
  }>(
    `WITH RECURSIVE ancestry_path AS (
      SELECT
        child_id as current_id,
        parent_id as next_id,
        parent_id || '' as path,
        1 as depth
      FROM parent_edge
      WHERE child_id = @sourceId

      UNION ALL

      SELECT
        pe.child_id,
        pe.parent_id,
        ap.path || ',' || pe.parent_id,
        ap.depth + 1
      FROM ancestry_path ap
      JOIN parent_edge pe ON pe.child_id = ap.next_id
      WHERE ap.depth < 100
      AND ap.path NOT LIKE '%' || pe.parent_id || '%'
    )
    SELECT path, depth
    FROM ancestry_path
    WHERE next_id = @targetId
    ORDER BY depth DESC
    LIMIT 1`,
    { sourceId, targetId }
  );

  if (result.length === 0) return null;

  const pathIds = [sourceId, ...result[0].path.split(',')];
  return pathIds;
}

/**
 * Find a random path using SQLite (random selection at each branch)
 */
function findRandomPathSqlite(
  sourceId: string,
  targetId: string
): string[] | null {
  // Get all paths and pick one randomly
  const result = sqliteService.queryAll<{
    path: string;
  }>(
    `WITH RECURSIVE ancestry_path AS (
      SELECT
        child_id as current_id,
        parent_id as next_id,
        parent_id || '' as path,
        1 as depth
      FROM parent_edge
      WHERE child_id = @sourceId

      UNION ALL

      SELECT
        pe.child_id,
        pe.parent_id,
        ap.path || ',' || pe.parent_id,
        ap.depth + 1
      FROM ancestry_path ap
      JOIN parent_edge pe ON pe.child_id = ap.next_id
      WHERE ap.depth < 100
      AND ap.path NOT LIKE '%' || pe.parent_id || '%'
    )
    SELECT path
    FROM ancestry_path
    WHERE next_id = @targetId`,
    { sourceId, targetId }
  );

  if (result.length === 0) return null;

  // Pick a random path
  const randomIndex = Math.floor(Math.random() * result.length);
  const pathIds = [sourceId, ...result[randomIndex].path.split(',')];
  return pathIds;
}

/**
 * Convert path of canonical IDs to PersonWithId array
 */
async function buildPathResult(
  dbId: string,
  pathCanonicalIds: string[],
  method: 'shortest' | 'longest' | 'random'
): Promise<PathResult> {
  const path: PersonWithId[] = [];

  for (const canonicalId of pathCanonicalIds) {
    const person = await databaseService.getPerson(dbId, canonicalId);
    if (person) {
      path.push(person);
    }
  }

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
    // Try SQLite first
    if (databaseService.isSqliteEnabled()) {
      // Resolve FamilySearch IDs to canonical ULIDs
      const sourceCanonical = idMappingService.resolveId(source, 'familysearch');
      const targetCanonical = idMappingService.resolveId(target, 'familysearch');

      if (sourceCanonical && targetCanonical) {
        let pathIds: string[] | null = null;

        switch (method) {
          case 'shortest':
            pathIds = findShortestPathSqlite(sourceCanonical, targetCanonical);
            break;
          case 'longest':
            pathIds = findLongestPathSqlite(sourceCanonical, targetCanonical);
            break;
          case 'random':
            pathIds = findRandomPathSqlite(sourceCanonical, targetCanonical);
            break;
        }

        if (pathIds && pathIds.length > 0) {
          return buildPathResult(dbId, pathIds, method);
        }

        // Path not found via parents, check if target is actually reachable
        // This might happen if the path goes through children or in other directions
      }
    }

    // Fall back to in-memory algorithm
    const db = await databaseService.getDatabase(dbId);

    if (!db[source]) {
      throw new Error(`Source person ${source} not found in database`);
    }
    if (!db[target]) {
      throw new Error(`Target person ${target} not found in database`);
    }

    const algorithms = await loadPathAlgorithms();
    const pathFn = algorithms[method];

    if (!pathFn) {
      throw new Error(`Unknown path method: ${method}`);
    }

    const pathIds: string[] = await pathFn(db, source, target);

    const path: PersonWithId[] = pathIds.map((id) => ({
      id,
      ...db[id],
    }));

    return {
      path,
      length: path.length - 1,
      method,
    };
  },

  /**
   * Find all ancestors of a person up to a certain depth
   */
  async findAncestors(
    dbId: string,
    personId: string,
    maxDepth: number = 10
  ): Promise<{ id: string; depth: number }[]> {
    if (databaseService.isSqliteEnabled()) {
      const canonicalId = idMappingService.resolveId(personId, 'familysearch');

      if (canonicalId) {
        const results = sqliteService.queryAll<{
          person_id: string;
          depth: number;
        }>(
          `WITH RECURSIVE ancestors AS (
            SELECT parent_id as person_id, 1 as depth
            FROM parent_edge
            WHERE child_id = @personId

            UNION ALL

            SELECT pe.parent_id, a.depth + 1
            FROM ancestors a
            JOIN parent_edge pe ON pe.child_id = a.person_id
            WHERE a.depth < @maxDepth
          )
          SELECT DISTINCT person_id, MIN(depth) as depth
          FROM ancestors
          GROUP BY person_id
          ORDER BY depth`,
          { personId: canonicalId, maxDepth }
        );

        // Return canonical IDs for URL routing
        return results.map(({ person_id, depth }) => ({
          id: person_id,
          depth,
        }));
      }
    }

    // Fallback: BFS through the database
    const db = await databaseService.getDatabase(dbId);
    const ancestors: { id: string; depth: number }[] = [];
    const visited = new Set<string>();
    const queue: { id: string; depth: number }[] = [];

    // Start with direct parents
    const person = db[personId];
    if (!person) return [];

    for (const parentId of person.parents) {
      if (parentId && db[parentId]) {
        queue.push({ id: parentId, depth: 1 });
      }
    }

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);
      ancestors.push({ id, depth });

      const ancestor = db[id];
      if (ancestor) {
        for (const parentId of ancestor.parents) {
          if (parentId && db[parentId] && !visited.has(parentId)) {
            queue.push({ id: parentId, depth: depth + 1 });
          }
        }
      }
    }

    return ancestors;
  },

  /**
   * Find all descendants of a person up to a certain depth
   */
  async findDescendants(
    dbId: string,
    personId: string,
    maxDepth: number = 10
  ): Promise<{ id: string; depth: number }[]> {
    if (databaseService.isSqliteEnabled()) {
      const canonicalId = idMappingService.resolveId(personId, 'familysearch');

      if (canonicalId) {
        const results = sqliteService.queryAll<{
          person_id: string;
          depth: number;
        }>(
          `WITH RECURSIVE descendants AS (
            SELECT child_id as person_id, 1 as depth
            FROM parent_edge
            WHERE parent_id = @personId

            UNION ALL

            SELECT pe.child_id, d.depth + 1
            FROM descendants d
            JOIN parent_edge pe ON pe.parent_id = d.person_id
            WHERE d.depth < @maxDepth
          )
          SELECT DISTINCT person_id, MIN(depth) as depth
          FROM descendants
          GROUP BY person_id
          ORDER BY depth`,
          { personId: canonicalId, maxDepth }
        );

        // Return canonical IDs for URL routing
        return results.map(({ person_id, depth }) => ({
          id: person_id,
          depth,
        }));
      }
    }

    // Fallback: BFS through the database
    const db = await databaseService.getDatabase(dbId);
    const descendants: { id: string; depth: number }[] = [];
    const visited = new Set<string>();
    const queue: { id: string; depth: number }[] = [];

    const person = db[personId];
    if (!person) return [];

    for (const childId of person.children) {
      if (childId && db[childId]) {
        queue.push({ id: childId, depth: 1 });
      }
    }

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);
      descendants.push({ id, depth });

      const descendant = db[id];
      if (descendant) {
        for (const childId of descendant.children) {
          if (childId && db[childId] && !visited.has(childId)) {
            queue.push({ id: childId, depth: depth + 1 });
          }
        }
      }
    }

    return descendants;
  },
};
