/**
 * Find the longest path between two nodes in a family tree graph using BFS
 * Also detects cyclic relationships (time travelers!)
 */

import type { Graph } from './types.js';

export const pathLongest = (
  graph: Graph,
  source: string,
  target: string
): string[] => {
  let longest: string[] = [];
  const queue: string[][] = [[source]];
  const depthMap: Record<string, number> = {
    [source]: 0,
  };

  while (queue.length) {
    const path = queue.shift()!;
    const node = path[path.length - 1];

    if (node === target) {
      if (path.length > longest.length) {
        longest = path;
      }
    } else {
      const children = graph[node]?.children || [];
      children.forEach((child) => {
        if (!depthMap[child]) depthMap[child] = 0;
        if (path.includes(child)) {
          console.error(
            `TIME TRAVELER! Cyclic relationship detected between ${child} and ${node}. Please fix this in the source database.`,
            path.slice(path.indexOf(child)).join(' -> ')
          );
          return;
        }
        // only queue this child if it is a further distance than we have seen already
        // for this child relationship to the source
        if (depthMap[child] < path.length) {
          queue.push([...path, child]);
          depthMap[child] = path.length;
        }
      });
    }
  }

  return longest;
};

export default pathLongest;
