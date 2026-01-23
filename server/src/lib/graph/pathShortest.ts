/**
 * Find the shortest path between two nodes in a family tree graph using BFS
 */

import type { Graph } from './types.js';

export const pathShortest = (
  graph: Graph,
  source: string,
  target: string
): string[] => {
  const queue: string[] = [source];
  const visited: Record<string, boolean> = { [source]: true };
  const parents: Record<string, string> = {};

  while (queue.length) {
    let id = queue.shift()!;
    const children = graph[id]?.children || [];

    for (let i = 0, len = children.length; i < len; i++) {
      const child = children[i];
      // another parent may have already been traversed to this child
      if (visited[child]) {
        continue;
      }
      visited[child] = true;
      if (child === target) {
        const path: string[] = [child];
        while (id !== source) {
          path.push(id);
          id = parents[id];
        }
        path.push(id);
        path.reverse();
        return path;
      }
      parents[child] = id;
      queue.push(child);
    }
  }
  return [];
};

export default pathShortest;
