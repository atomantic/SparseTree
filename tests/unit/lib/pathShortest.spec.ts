/**
 * Unit tests for lib/pathShortest.js
 * Tests shortest path algorithm for finding lineage between two people
 */

import { describe, it, expect } from 'vitest';
import { pathShortest } from '../../../server/src/lib/graph/pathShortest.js';

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

describe('pathShortest', () => {
  describe('basic path finding', () => {
    it('finds direct parent-child path', () => {
      const graph = createTestGraph([
        { id: 'A', name: 'Parent', children: ['B'] },
        { id: 'B', name: 'Child', children: [] },
      ]);

      const result = pathShortest(graph, 'A', 'B');
      expect(result).toEqual(['A', 'B']);
    });

    it('finds path across multiple generations', () => {
      const graph = createTestGraph([
        { id: 'GF', name: 'Grandfather', children: ['F'] },
        { id: 'F', name: 'Father', children: ['C'] },
        { id: 'C', name: 'Child', children: [] },
      ]);

      const result = pathShortest(graph, 'GF', 'C');
      expect(result).toEqual(['GF', 'F', 'C']);
    });

    it('finds shortest path when multiple paths exist', () => {
      // Diamond shape: A -> B -> D and A -> C -> D
      const graph: Graph = {
        'A': { name: 'Root', children: ['B', 'C'] },
        'B': { name: 'Left', children: ['D'] },
        'C': { name: 'Right', children: ['D'] },
        'D': { name: 'Target', children: [] },
      };

      const result = pathShortest(graph, 'A', 'D');
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('A');
      expect(result[2]).toBe('D');
      expect(['B', 'C']).toContain(result[1]);
    });
  });

  describe('edge cases', () => {
    it('returns empty array when source equals target', () => {
      const graph = createTestGraph([
        { id: 'A', name: 'Single', children: [] },
      ]);

      const result = pathShortest(graph, 'A', 'A');
      expect(result).toEqual([]);
    });

    it('returns empty array for disconnected nodes', () => {
      const graph = createTestGraph([
        { id: 'A', name: 'Branch1-Root', children: ['B'] },
        { id: 'B', name: 'Branch1-Child', children: [] },
        { id: 'X', name: 'Branch2-Root', children: ['Y'] },
        { id: 'Y', name: 'Branch2-Child', children: [] },
      ]);

      const result = pathShortest(graph, 'A', 'Y');
      expect(result).toEqual([]);
    });

    it('handles wide tree correctly', () => {
      const graph = createTestGraph([
        { id: 'P', name: 'Parent', children: ['C1', 'C2', 'C3', 'C4', 'C5'] },
        { id: 'C1', name: 'Child 1', children: [] },
        { id: 'C2', name: 'Child 2', children: [] },
        { id: 'C3', name: 'Child 3', children: ['GC'] },
        { id: 'C4', name: 'Child 4', children: [] },
        { id: 'C5', name: 'Child 5', children: [] },
        { id: 'GC', name: 'Grandchild', children: [] },
      ]);

      const result = pathShortest(graph, 'P', 'GC');
      expect(result).toEqual(['P', 'C3', 'GC']);
    });

    it('handles deep tree correctly', () => {
      const nodes = [];
      for (let i = 0; i < 10; i++) {
        nodes.push({
          id: `N${i}`,
          name: `Node ${i}`,
          children: i < 9 ? [`N${i + 1}`] : [],
        });
      }
      const graph = createTestGraph(nodes);

      const result = pathShortest(graph, 'N0', 'N9');
      expect(result).toHaveLength(10);
      expect(result[0]).toBe('N0');
      expect(result[9]).toBe('N9');
    });

    it('avoids revisiting already visited nodes', () => {
      // Complex tree with shared descendants
      const graph: Graph = {
        'A': { name: 'Root', children: ['B', 'C', 'D'] },
        'B': { name: 'B', children: ['E'] },
        'C': { name: 'C', children: ['E', 'F'] },
        'D': { name: 'D', children: ['G'] },
        'E': { name: 'E', children: ['H'] },
        'F': { name: 'F', children: ['H'] },
        'G': { name: 'G', children: ['H'] },
        'H': { name: 'H', children: [] },
      };

      const result = pathShortest(graph, 'A', 'H');
      expect(result).toHaveLength(4);
      expect(result[0]).toBe('A');
      expect(result[3]).toBe('H');
    });

    it('returns consistent results on repeated calls', () => {
      const graph: Graph = {
        'A': { name: 'Root', children: ['B', 'C'] },
        'B': { name: 'B', children: ['D'] },
        'C': { name: 'C', children: ['D'] },
        'D': { name: 'Target', children: [] },
      };

      const result1 = pathShortest(graph, 'A', 'D');
      const result2 = pathShortest(graph, 'A', 'D');
      const result3 = pathShortest(graph, 'A', 'D');

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });

    it('handles very wide tree efficiently', () => {
      const graph: Graph = { 'ROOT': { name: 'Root', children: [] } };

      // Create 100 children
      for (let i = 0; i < 100; i++) {
        const childId = `C${i}`;
        graph['ROOT'].children.push(childId);
        graph[childId] = { name: `Child ${i}`, children: ['TARGET'] };
      }
      graph['TARGET'] = { name: 'Target', children: [] };

      const result = pathShortest(graph, 'ROOT', 'TARGET');
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('ROOT');
      expect(result[2]).toBe('TARGET');
    });
  });
});
