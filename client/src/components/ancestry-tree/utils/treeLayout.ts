/**
 * Tree Layout Utilities
 *
 * Functions for calculating node positions in various tree visualizations.
 * Supports horizontal pedigree, vertical family view, and fan chart layouts.
 */

import type { AncestryPersonCard, AncestryFamilyUnit, AncestryTreeResult } from '@fsf/shared';

// Node dimensions
export const NODE_DIMENSIONS = {
  width: 220,
  height: 80,
  gap: {
    horizontal: 48,  // Gap between columns in horizontal view
    vertical: 32,    // Gap between rows in vertical view
  },
  padding: 24,
};

// Position in 2D space
export interface Position {
  x: number;
  y: number;
}

// Tree node with position data
export interface PositionedNode {
  id: string;
  person: AncestryPersonCard;
  position: Position;
  generation: number;
  ahnentafel: number;  // Position in pedigree numbering
  lineage: 'paternal' | 'maternal' | 'self';
  hasMoreAncestors: boolean;
  parentUnit?: AncestryFamilyUnit;
}

// Connector line between nodes
export interface ConnectorLine {
  from: Position;
  to: Position;
  type: 'horizontal' | 'vertical' | 'elbow';
}

/**
 * Build a flat list of positioned nodes from ancestry tree data
 */
export function buildPositionedNodes(data: AncestryTreeResult): PositionedNode[] {
  const nodes: PositionedNode[] = [];

  // Add root person at position 0,0
  nodes.push({
    id: data.rootPerson.id,
    person: data.rootPerson,
    position: { x: 0, y: 0 },
    generation: 0,
    ahnentafel: 1,
    lineage: 'self',
    hasMoreAncestors: !!data.parentUnits?.length,
  });

  // Recursively process parent units
  function processUnit(
    unit: AncestryFamilyUnit,
    parentAhnentafel: number,
    generation: number
  ): void {
    // Father is at 2*parent, mother at 2*parent+1
    if (unit.father) {
      const fatherAhn = parentAhnentafel * 2;
      nodes.push({
        id: unit.father.id,
        person: unit.father,
        position: { x: 0, y: 0 }, // Will be calculated later
        generation,
        ahnentafel: fatherAhn,
        lineage: generation === 1 ? 'paternal' : getLineageFromParent(fatherAhn),
        hasMoreAncestors: unit.father.hasMoreAncestors,
        parentUnit: unit.fatherParentUnits?.[0],
      });

      // Process father's parents
      if (unit.fatherParentUnits) {
        for (const parentUnit of unit.fatherParentUnits) {
          processUnit(parentUnit, fatherAhn, generation + 1);
        }
      }
    }

    if (unit.mother) {
      const motherAhn = parentAhnentafel * 2 + 1;
      nodes.push({
        id: unit.mother.id,
        person: unit.mother,
        position: { x: 0, y: 0 }, // Will be calculated later
        generation,
        ahnentafel: motherAhn,
        lineage: generation === 1 ? 'maternal' : getLineageFromParent(motherAhn),
        hasMoreAncestors: unit.mother.hasMoreAncestors,
        parentUnit: unit.motherParentUnits?.[0],
      });

      // Process mother's parents
      if (unit.motherParentUnits) {
        for (const parentUnit of unit.motherParentUnits) {
          processUnit(parentUnit, motherAhn, generation + 1);
        }
      }
    }
  }

  // Process root's parent units
  if (data.parentUnits) {
    for (const unit of data.parentUnits) {
      processUnit(unit, 1, 1);
    }
  }

  return nodes;
}

/**
 * Calculate positions for horizontal pedigree layout (root left, ancestors right)
 */
export function calculateHorizontalPedigreeLayout(
  nodes: PositionedNode[],
  _containerWidth: number,
  containerHeight: number,
  maxGenerations: number = 5
): PositionedNode[] {
  const { width, height, gap } = NODE_DIMENSIONS;

  // Group nodes by generation
  const byGeneration = new Map<number, PositionedNode[]>();
  for (const node of nodes) {
    if (node.generation > maxGenerations) continue;
    const gen = byGeneration.get(node.generation) || [];
    gen.push(node);
    byGeneration.set(node.generation, gen);
  }

  // Calculate x position for each generation column
  const columnX = (gen: number) => gen * (width + gap.horizontal);

  // Calculate y positions within each generation
  for (let gen = maxGenerations; gen >= 0; gen--) {
    const genNodes = byGeneration.get(gen) || [];
    if (genNodes.length === 0) continue;

    if (gen === maxGenerations) {
      // Leaf generation: space evenly
      const totalHeight = genNodes.length * height + (genNodes.length - 1) * gap.vertical;
      const startY = (containerHeight - totalHeight) / 2;

      genNodes.forEach((node, i) => {
        node.position = {
          x: columnX(gen),
          y: startY + i * (height + gap.vertical),
        };
      });
    } else {
      // Non-leaf generation: position based on children's positions
      for (const node of genNodes) {
        const childAhnentafels = [node.ahnentafel * 2, node.ahnentafel * 2 + 1];
        const childNodes = nodes.filter(n => childAhnentafels.includes(n.ahnentafel));

        if (childNodes.length > 0 && childNodes.every(c => c.position.x !== 0 || c.position.y !== 0)) {
          // Center between children
          const avgY = childNodes.reduce((sum, c) => sum + c.position.y, 0) / childNodes.length;
          node.position = {
            x: columnX(gen),
            y: avgY,
          };
        } else {
          // No positioned children, use default
          const genIndex = genNodes.indexOf(node);
          const totalHeight = genNodes.length * height + (genNodes.length - 1) * gap.vertical;
          const startY = (containerHeight - totalHeight) / 2;
          node.position = {
            x: columnX(gen),
            y: startY + genIndex * (height + gap.vertical),
          };
        }
      }
    }
  }

  return nodes.filter(n => n.generation <= maxGenerations);
}

/**
 * Calculate positions for vertical family view (ancestors top, root middle, children bottom)
 */
export function calculateVerticalFamilyLayout(
  nodes: PositionedNode[],
  containerWidth: number,
  _containerHeight: number,
  maxGenerations: number = 4
): PositionedNode[] {
  const { width, height, gap } = NODE_DIMENSIONS;

  // Group nodes by generation
  const byGeneration = new Map<number, PositionedNode[]>();
  for (const node of nodes) {
    if (node.generation > maxGenerations) continue;
    const gen = byGeneration.get(node.generation) || [];
    gen.push(node);
    byGeneration.set(node.generation, gen);
  }

  // Calculate y position for each generation row (ancestors at top)
  const rowY = (gen: number) => gen * (height + gap.vertical);

  // Calculate x positions within each generation
  for (let gen = 0; gen <= maxGenerations; gen++) {
    const genNodes = byGeneration.get(gen) || [];
    if (genNodes.length === 0) continue;

    // Sort by ahnentafel to maintain order
    genNodes.sort((a, b) => a.ahnentafel - b.ahnentafel);

    const totalWidth = genNodes.length * width + (genNodes.length - 1) * gap.horizontal;
    const startX = (containerWidth - totalWidth) / 2;

    genNodes.forEach((node, i) => {
      node.position = {
        x: startX + i * (width + gap.horizontal),
        y: rowY(gen),
      };
    });
  }

  return nodes.filter(n => n.generation <= maxGenerations);
}

/**
 * Calculate connector lines between nodes
 */
export function calculateConnectors(
  nodes: PositionedNode[],
  direction: 'horizontal' | 'vertical' = 'horizontal'
): ConnectorLine[] {
  const lines: ConnectorLine[] = [];
  const { width, height } = NODE_DIMENSIONS;

  for (const node of nodes) {
    if (node.ahnentafel === 1) continue; // Skip root

    // Find parent node
    const parentAhn = Math.floor(node.ahnentafel / 2);
    const parent = nodes.find(n => n.ahnentafel === parentAhn);
    if (!parent) continue;

    if (direction === 'horizontal') {
      // Draw from left edge of node to right edge of parent
      lines.push({
        from: { x: parent.position.x + width, y: parent.position.y + height / 2 },
        to: { x: node.position.x, y: node.position.y + height / 2 },
        type: 'elbow',
      });
    } else {
      // Draw from top edge of node to bottom edge of parent
      lines.push({
        from: { x: parent.position.x + width / 2, y: parent.position.y + height },
        to: { x: node.position.x + width / 2, y: node.position.y },
        type: 'elbow',
      });
    }
  }

  return lines;
}

/**
 * Get lineage from parent ahnentafel number
 */
function getLineageFromParent(ahnentafel: number): 'paternal' | 'maternal' {
  let n = ahnentafel;
  while (n > 3) {
    n = Math.floor(n / 2);
  }
  return n === 2 ? 'paternal' : 'maternal';
}

/**
 * Calculate total tree dimensions based on nodes
 */
export function calculateTreeDimensions(nodes: PositionedNode[]): { width: number; height: number } {
  const { width, height, padding } = NODE_DIMENSIONS;

  let maxX = 0;
  let maxY = 0;
  let minX = Infinity;
  let minY = Infinity;

  for (const node of nodes) {
    maxX = Math.max(maxX, node.position.x + width);
    maxY = Math.max(maxY, node.position.y + height);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
  }

  return {
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * Center the tree within a container
 */
export function centerTree(
  nodes: PositionedNode[],
  containerWidth: number,
  containerHeight: number
): { x: number; y: number; scale: number } {
  const dimensions = calculateTreeDimensions(nodes);

  // Calculate scale to fit
  const scaleX = containerWidth / dimensions.width;
  const scaleY = containerHeight / dimensions.height;
  const scale = Math.min(scaleX, scaleY, 1); // Don't scale up

  // Calculate offset to center
  const scaledWidth = dimensions.width * scale;
  const scaledHeight = dimensions.height * scale;

  return {
    x: (containerWidth - scaledWidth) / 2,
    y: (containerHeight - scaledHeight) / 2,
    scale,
  };
}
