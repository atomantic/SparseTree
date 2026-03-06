/**
 * Find the longest path between two nodes in a family tree graph using BFS
 * Also detects cyclic relationships (time travelers!)
 */

import type { Graph } from './types.js';
import { logger } from '../logger.js';

/**
 * Reconstruct the ancestor set for a node by walking the parent chain.
 * Avoids copying Sets at every BFS step (memory leak on deep trees).
 */
function getAncestors(parentOf: Record<string, string | null>, node: string): Set<string> {
  const ancestors = new Set<string>();
  let current: string | null = node;
  while (current !== null) {
    ancestors.add(current);
    current = parentOf[current] ?? null;
  }
  return ancestors;
}

export const pathLongest = (
  graph: Graph,
  source: string,
  target: string
): string[] => {
  // Track the best (longest) depth at which we've visited each node
  const depthMap: Record<string, number> = { [source]: 0 };
  // Parent pointers keyed by "node" storing the parent on the longest known path
  const parentOf: Record<string, string | null> = { [source]: null };
  // Each queue entry is [node, depth] — ancestors reconstructed on demand from parentOf
  const queue: Array<[string, number]> = [[source, 0]];
  let longestDepth = -1;
  let foundTarget = false;

  while (queue.length) {
    const entry = queue.shift();
    if (!entry) break;
    const [node, depth] = entry;

    if (node === target) {
      if (depth > longestDepth) {
        longestDepth = depth;
        foundTarget = true;
      }
      continue;
    }

    const children = graph[node]?.children || [];
    for (const child of children) {
      // Reconstruct ancestors on demand instead of copying Sets per queue entry
      const ancestors = getAncestors(parentOf, node);
      if (ancestors.has(child)) {
        logger.error('graph', `TIME TRAVELER! Cyclic relationship: ${child} <-> ${node}`);
        continue;
      }
      if (!depthMap[child]) depthMap[child] = 0;
      // only queue this child if it is a further distance than we have seen already
      if (depthMap[child] < depth + 1) {
        depthMap[child] = depth + 1;
        parentOf[child] = node;
        queue.push([child, depth + 1]);
      }
    }
  }

  if (!foundTarget) return [];

  // Reconstruct path from parent pointers
  const path: string[] = [];
  let current: string | null = target;
  while (current !== null) {
    path.push(current);
    current = parentOf[current] ?? null;
  }
  path.reverse();
  return path;
};

export default pathLongest;
