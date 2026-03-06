/**
 * Find the longest path between two nodes in a family tree graph using BFS
 * Also detects cyclic relationships (time travelers!)
 */

import type { Graph } from './types.js';
import { logger } from '../logger.js';

export const pathLongest = (
  graph: Graph,
  source: string,
  target: string
): string[] => {
  // Track the best (longest) depth at which we've visited each node
  const depthMap: Record<string, number> = { [source]: 0 };
  // Parent pointers keyed by "node" storing the parent on the longest known path
  const parentOf: Record<string, string | null> = { [source]: null };
  // Track visited nodes on the current BFS path to detect cycles
  // Each queue entry is [node, depth, Set of ancestors on this path]
  const queue: Array<[string, number, Set<string>]> = [[source, 0, new Set([source])]];
  let longestDepth = -1;
  let foundTarget = false;

  while (queue.length) {
    const [node, depth, ancestors] = queue.shift()!;

    if (node === target) {
      if (depth > longestDepth) {
        longestDepth = depth;
        foundTarget = true;
      }
      continue;
    }

    const children = graph[node]?.children || [];
    for (const child of children) {
      if (ancestors.has(child)) {
        logger.error('graph', `TIME TRAVELER! Cyclic relationship: ${child} <-> ${node}`);
        continue;
      }
      if (!depthMap[child]) depthMap[child] = 0;
      // only queue this child if it is a further distance than we have seen already
      if (depthMap[child] < depth + 1) {
        depthMap[child] = depth + 1;
        parentOf[child] = node;
        const childAncestors = new Set(ancestors);
        childAncestors.add(child);
        queue.push([child, depth + 1, childAncestors]);
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
