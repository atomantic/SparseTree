/**
 * Unit tests for lib/pathRandom.js
 * Tests random path algorithm for finding random lineage paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pathRandom } from '../../../server/src/lib/graph/pathRandom.js';

// Type for graph structure
type Graph = Record<string, { name: string; children: string[] }>;

// Helper to create test graph
const createTestGraph = (nodes: Array<{ id: string; name: string; children: string[] }>): Graph => {
  const graph: Graph = {};
  for (const node of nodes) {
    graph[node.id] = { name: node.name, children: node.children };
  }
  return graph;
};

describe('pathRandom', () => {
  describe('basic path finding', () => {
    it('finds path in linear tree (only one path exists)', async () => {
      const graph = createTestGraph([
        { id: 'A', name: 'Root', children: ['B'] },
        { id: 'B', name: 'Middle', children: ['C'] },
        { id: 'C', name: 'Target', children: [] },
      ]);

      const result = await pathRandom(graph, 'A', 'C');
      expect(result).toEqual(['A', 'B', 'C']);
    });

    it('finds direct parent-child path', async () => {
      const graph = createTestGraph([
        { id: 'P', name: 'Parent', children: ['C'] },
        { id: 'C', name: 'Child', children: [] },
      ]);

      const result = await pathRandom(graph, 'P', 'C');
      expect(result).toEqual(['P', 'C']);
    });

    it('finds valid path among multiple options', async () => {
      // Diamond shape with multiple paths
      const graph: Graph = {
        'A': { name: 'Root', children: ['B', 'C', 'D'] },
        'B': { name: 'B', children: ['E'] },
        'C': { name: 'C', children: ['E'] },
        'D': { name: 'D', children: ['E'] },
        'E': { name: 'Target', children: [] },
      };

      const result = await pathRandom(graph, 'A', 'E');
      expect(result).toBeDefined();
      expect(result!.length).toBe(3);
      expect(result![0]).toBe('A');
      expect(result![2]).toBe('E');
    });
  });

  describe('error handling', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('logs error for missing person in graph', async () => {
      // Target is C, but B (which is in path to C) is not defined in graph
      const graph = createTestGraph([
        { id: 'A', name: 'Root', children: ['B'] },
        // 'B' is not defined - will cause error when trying to traverse through it
      ]);

      // Target is something beyond B, so B must be looked up in graph
      const result = await pathRandom(graph, 'A', 'C');
      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0];
      expect(errorCall[1]).toContain('no person found');
    });

    it('logs error when path dead-ends before target', async () => {
      const graph = createTestGraph([
        { id: 'A', name: 'Root', children: ['B'] },
        { id: 'B', name: 'Dead End', children: [] },
        { id: 'C', name: 'Target', children: [] },
      ]);

      const result = await pathRandom(graph, 'A', 'C');
      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0];
      expect(errorCall[0]).toContain('no children');
    });

    it('handles empty children array', async () => {
      const graph: Graph = {
        'A': { name: 'Root', children: [] },
        'B': { name: 'Target', children: [] },
      };

      const result = await pathRandom(graph, 'A', 'B');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('always includes source and target in path', async () => {
      const graph: Graph = {
        'A': { name: 'A', children: ['B', 'C'] },
        'B': { name: 'B', children: ['D'] },
        'C': { name: 'C', children: ['D'] },
        'D': { name: 'D', children: [] },
      };

      for (let i = 0; i < 10; i++) {
        const result = await pathRandom(graph, 'A', 'D');
        expect(result).toBeDefined();
        expect(result![0]).toBe('A');
        expect(result![result!.length - 1]).toBe('D');
      }
    });

    it('returns valid path structure', async () => {
      const graph: Graph = createTestGraph([
        { id: 'ROOT', name: 'Root', children: ['L1A', 'L1B'] },
        { id: 'L1A', name: 'L1A', children: ['L2'] },
        { id: 'L1B', name: 'L1B', children: ['L2'] },
        { id: 'L2', name: 'L2', children: ['TARGET'] },
        { id: 'TARGET', name: 'Target', children: [] },
      ]);

      const result = await pathRandom(graph, 'ROOT', 'TARGET');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result!.length).toBeGreaterThanOrEqual(3);
      expect(result!.length).toBeLessThanOrEqual(4);
    });

    it('handles single-path deeply nested tree', async () => {
      const nodes = [];
      for (let i = 0; i < 10; i++) {
        nodes.push({
          id: `N${i}`,
          name: `Node ${i}`,
          children: i < 9 ? [`N${i + 1}`] : [],
        });
      }
      const graph = createTestGraph(nodes);

      const result = await pathRandom(graph, 'N0', 'N9');

      expect(result).toBeDefined();
      expect(result).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        expect(result![i]).toBe(`N${i}`);
      }
    });

    it('produces async result', async () => {
      const graph: Graph = createTestGraph([
        { id: 'A', name: 'A', children: ['B'] },
        { id: 'B', name: 'B', children: [] },
      ]);

      const resultPromise = pathRandom(graph, 'A', 'B');
      expect(resultPromise).toBeInstanceOf(Promise);

      const result = await resultPromise;
      expect(result).toEqual(['A', 'B']);
    });

    it('can select different paths when run multiple times', async () => {
      const graph: Graph = {
        'A': { name: 'A', children: ['B1', 'B2', 'B3', 'B4', 'B5'] },
        'B1': { name: 'B1', children: ['C'] },
        'B2': { name: 'B2', children: ['C'] },
        'B3': { name: 'B3', children: ['C'] },
        'B4': { name: 'B4', children: ['C'] },
        'B5': { name: 'B5', children: ['C'] },
        'C': { name: 'C', children: [] },
      };

      // Run multiple times to verify random selection works
      const middleNodes = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const result = await pathRandom(graph, 'A', 'C');
        if (result && result.length === 3) {
          middleNodes.add(result[1]);
        }
      }

      // Should have selected multiple different B nodes over 50 iterations
      expect(middleNodes.size).toBeGreaterThan(1);
    });
  });
});
