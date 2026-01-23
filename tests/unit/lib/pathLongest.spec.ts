/**
 * Unit tests for lib/pathLongest.js
 * Tests longest path algorithm with cycle detection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pathLongest } from '../../../server/src/lib/graph/pathLongest.js';

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

describe('pathLongest', () => {
  describe('basic longest path finding', () => {
    it('finds path in linear tree', () => {
      const graph = createTestGraph([
        { id: 'GF', name: 'Grandfather', children: ['F'] },
        { id: 'F', name: 'Father', children: ['C'] },
        { id: 'C', name: 'Child', children: [] },
      ]);

      const result = pathLongest(graph, 'GF', 'C');
      expect(result).toEqual(['GF', 'F', 'C']);
    });

    it('finds longest path when multiple paths exist', () => {
      // Two paths: A->B->D->E (length 4) and A->C->E (length 3)
      const graph: Graph = {
        'A': { name: 'Root', children: ['B', 'C'] },
        'B': { name: 'B', children: ['D'] },
        'C': { name: 'C', children: ['E'] },
        'D': { name: 'D', children: ['E'] },
        'E': { name: 'Target', children: [] },
      };

      const result = pathLongest(graph, 'A', 'E');
      expect(result).toHaveLength(4);
      expect(result).toEqual(['A', 'B', 'D', 'E']);
    });

    it('handles direct parent-child path', () => {
      const graph = createTestGraph([
        { id: 'P', name: 'Parent', children: ['C'] },
        { id: 'C', name: 'Child', children: [] },
      ]);

      const result = pathLongest(graph, 'P', 'C');
      expect(result).toEqual(['P', 'C']);
    });

    it('returns empty array for disconnected nodes', () => {
      const graph = createTestGraph([
        { id: 'A', name: 'Branch1', children: ['B'] },
        { id: 'B', name: 'B', children: [] },
        { id: 'X', name: 'Branch2', children: ['Y'] },
        { id: 'Y', name: 'Y', children: [] },
      ]);

      const result = pathLongest(graph, 'A', 'Y');
      expect(result).toEqual([]);
    });

    it('finds longest path in wide tree', () => {
      const graph: Graph = {
        'ROOT': { name: 'Root', children: ['A', 'B', 'C'] },
        'A': { name: 'A', children: ['D', 'E'] },
        'B': { name: 'B', children: ['F'] },
        'C': { name: 'C', children: ['G', 'H'] },
        'D': { name: 'D', children: ['TARGET'] },
        'E': { name: 'E', children: [] },
        'F': { name: 'F', children: ['TARGET'] },
        'G': { name: 'G', children: ['I'] },
        'H': { name: 'H', children: [] },
        'I': { name: 'I', children: ['TARGET'] },
        'TARGET': { name: 'Target', children: [] },
      };

      const result = pathLongest(graph, 'ROOT', 'TARGET');
      expect(result).toHaveLength(5);
      expect(result).toEqual(['ROOT', 'C', 'G', 'I', 'TARGET']);
    });

    it('handles deeply nested tree', () => {
      const nodes = [];
      for (let i = 0; i < 20; i++) {
        nodes.push({
          id: `N${i}`,
          name: `Node ${i}`,
          children: i < 19 ? [`N${i + 1}`] : [],
        });
      }
      const graph = createTestGraph(nodes);

      const result = pathLongest(graph, 'N0', 'N19');
      expect(result).toHaveLength(20);
      expect(result[0]).toBe('N0');
      expect(result[19]).toBe('N19');
    });
  });

  describe('cycle detection', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('detects and reports cyclic relationship', () => {
      // Cyclic: A -> B -> C -> A, and C also leads to TARGET
      // The algorithm will explore all paths to find the longest
      const graph: Graph = {
        'A': { name: 'Person A', children: ['B'] },
        'B': { name: 'Person B', children: ['C'] },
        'C': { name: 'Person C', children: ['A', 'TARGET'] }, // Cycle back to A
        'TARGET': { name: 'Target', children: [] },
      };

      // When finding longest path to TARGET, it will explore C -> A which creates a cycle
      const result = pathLongest(graph, 'A', 'TARGET');
      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0];
      expect(errorCall[0]).toContain('TIME TRAVELER');
      // Despite the cycle, it should still find the valid path
      expect(result).toEqual(['A', 'B', 'C', 'TARGET']);
    });

    it('handles self-referencing cycle', () => {
      const graph: Graph = {
        'A': { name: 'Self-ref', children: ['A', 'B'] },
        'B': { name: 'Target', children: [] },
      };

      const result = pathLongest(graph, 'A', 'B');
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(result).toEqual(['A', 'B']);
    });

    it('handles multi-node cycle while still finding path', () => {
      // A -> B -> C -> D (target) and D -> B (cycle)
      const graph: Graph = {
        'A': { name: 'Start', children: ['B'] },
        'B': { name: 'B', children: ['C'] },
        'C': { name: 'C', children: ['D'] },
        'D': { name: 'Target', children: ['B'] },
      };

      const result = pathLongest(graph, 'A', 'D');
      expect(result).toEqual(['A', 'B', 'C', 'D']);
    });
  });

  describe('edge cases', () => {
    it('returns single element when source equals target at start', () => {
      const graph: Graph = { 'A': { name: 'Single', children: [] } };
      const result = pathLongest(graph, 'A', 'A');
      expect(result).toEqual(['A']);
    });

    it('handles complex diamond patterns', () => {
      const graph: Graph = {
        'A': { name: 'A', children: ['B', 'C', 'D'] },
        'B': { name: 'B', children: ['E', 'F'] },
        'C': { name: 'C', children: ['E', 'F', 'G'] },
        'D': { name: 'D', children: ['F', 'G'] },
        'E': { name: 'E', children: ['H'] },
        'F': { name: 'F', children: ['H'] },
        'G': { name: 'G', children: ['H'] },
        'H': { name: 'H', children: [] },
      };

      const result = pathLongest(graph, 'A', 'H');
      expect(result).toHaveLength(4);
      expect(result[0]).toBe('A');
      expect(result[3]).toBe('H');
    });

    it('prefers longer paths over shorter ones', () => {
      // Two paths: A->B (short) and A->C->D->B (long)
      const graph: Graph = {
        'A': { name: 'A', children: ['B', 'C'] },
        'B': { name: 'B', children: [] },
        'C': { name: 'C', children: ['D'] },
        'D': { name: 'D', children: ['B'] },
      };

      const result = pathLongest(graph, 'A', 'B');
      expect(result).toEqual(['A', 'C', 'D', 'B']);
    });
  });
});
