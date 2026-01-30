/**
 * Vertical Family View
 *
 * Ancestry.com-style vertical pedigree chart with:
 * - Root person at BOTTOM, ancestors flowing UP
 * - Per-person expansion (explore individual lineages)
 * - Clean SVG connector lines
 * - Zoom/pan support
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import * as d3 from 'd3';
import { Link } from 'react-router-dom';
import type { AncestryTreeResult, AncestryFamilyUnit, ExpandAncestryRequest, AncestryPersonCard } from '@fsf/shared';
import { AvatarPlaceholder } from '../../avatars/AvatarPlaceholder';
import { GENDER_COLORS } from '../utils/lineageColors';

interface VerticalFamilyViewProps {
  data: AncestryTreeResult;
  dbId: string;
  onExpand?: (request: ExpandAncestryRequest, nodeId: string) => Promise<void>;
  expandingNodes?: Set<string>;
}

// Layout constants
const NODE_WIDTH = 140;
const NODE_HEIGHT = 160; // Taller for vertical card layout
const HORIZONTAL_GAP = 24; // Gap between nodes in same generation
const VERTICAL_GAP = 200; // Space between generations (card height + connector space)
// Minimum distance from center for side separation - must be at least half card width + gap
// to prevent paternal grandmother from overlapping with maternal grandfather
const SIDE_MARGIN = (NODE_WIDTH + HORIZONTAL_GAP) / 2;

// Node data for rendering
interface TreeNode {
  id: string;
  person: AncestryPersonCard;
  parentUnits?: AncestryFamilyUnit[];
  generation: number;
  isExpanded: boolean;
  fatherId?: string;
  motherId?: string;
  childId?: string; // The child this node is a parent of
  side: 'root' | 'paternal' | 'maternal'; // Which side of the family tree
}

// Positioned node for layout
interface PositionedNode extends TreeNode {
  x: number;
  y: number;
}

// Connector path data (can be multi-segment)
interface ConnectorPath {
  points: { x: number; y: number }[];
  isCoupleLine?: boolean; // For styling the horizontal bar between parents
}

export function VerticalFamilyView({
  data,
  dbId,
  onExpand,
  expandingNodes = new Set()
}: VerticalFamilyViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [currentZoom, setCurrentZoom] = useState(0.8);
  const [isInitialized, setIsInitialized] = useState(false);

  // Store positioned nodes in state for incremental updates
  const [nodePositions, setNodePositions] = useState<Map<string, PositionedNode>>(() => new Map());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());

  // Build a lookup map for person data from the tree
  const personLookup = useCallback((): Map<string, { person: AncestryPersonCard; parentUnits?: AncestryFamilyUnit[] }> => {
    const lookup = new Map<string, { person: AncestryPersonCard; parentUnits?: AncestryFamilyUnit[] }>();

    const traverse = (person: AncestryPersonCard, parentUnits?: AncestryFamilyUnit[]) => {
      if (lookup.has(person.id)) return;
      lookup.set(person.id, { person, parentUnits });

      const unit = parentUnits?.[0];
      if (unit?.father) traverse(unit.father, unit.fatherParentUnits);
      if (unit?.mother) traverse(unit.mother, unit.motherParentUnits);
    };

    traverse(data.rootPerson, data.parentUnits);
    return lookup;
  }, [data]);

  // Fixed couple spacing - parents are always this distance apart
  const COUPLE_OFFSET = (NODE_WIDTH + HORIZONTAL_GAP) / 2;

  // Recalculate only Y positions based on max generation (keeps rows aligned)
  const recalculateYPositions = useCallback((positions: Map<string, PositionedNode>) => {
    const maxGen = Math.max(...Array.from(positions.values()).map(n => n.generation));
    positions.forEach(n => {
      n.y = (maxGen - n.generation) * VERTICAL_GAP;
    });
  }, []);

  // Initialize the tree with root and first generation
  // X positions are FIXED and never change - only Y positions adjust for row alignment
  useEffect(() => {
    const lookup = personLookup();
    const positions = new Map<string, PositionedNode>();
    const expanded = new Set<string>();

    // Add root at generation 0, x=0
    const rootData = lookup.get(data.rootPerson.id)!;
    positions.set(data.rootPerson.id, {
      id: data.rootPerson.id,
      person: rootData.person,
      parentUnits: rootData.parentUnits,
      generation: 0,
      isExpanded: true,
      x: 0,
      y: 0,
      side: 'root',
    });
    expanded.add(data.rootPerson.id);

    // Helper to check if a position collides with existing nodes at a generation
    const checkCollision = (x: number, gen: number) => {
      const minDistance = NODE_WIDTH + HORIZONTAL_GAP;
      for (const node of positions.values()) {
        if (node.generation === gen && Math.abs(node.x - x) < minDistance) {
          return true;
        }
      }
      return false;
    };

    // Helper to add parents with fixed positioning relative to child
    // Side tracking ensures paternal ancestors stay left, maternal stay right
    // When collision occurs, EXISTING nodes shift outward to make room
    // This keeps new nodes close to their child, maintaining proper ordering
    const addParents = (
      childId: string,
      childX: number,
      generation: number,
      parentUnits: AncestryFamilyUnit[] | undefined,
      autoExpand: boolean,
      side: 'paternal' | 'maternal'
    ) => {
      const unit = parentUnits?.[0];
      if (!unit) return;

      // Calculate couple positions ensuring proper paired placement
      // When one spouse needs clamping, shift the whole couple to maintain spacing
      let fatherX = childX - COUPLE_OFFSET;
      let motherX = childX + COUPLE_OFFSET;

      // Helper to shift existing nodes outward on a side
      const shiftExisting = (gen: number, s: 'paternal' | 'maternal') => {
        const direction = s === 'paternal' ? -1 : 1;
        positions.forEach(node => {
          if (node.generation === gen && node.side === s) {
            node.x += (NODE_WIDTH + HORIZONTAL_GAP) * direction;
          }
        });
      };

      if (side === 'paternal') {
        // Paternal side: both parents should stay at x < 0
        // If mother would cross center, shift whole couple left
        if (motherX > -SIDE_MARGIN) {
          motherX = -SIDE_MARGIN;
          fatherX = motherX - COUPLE_OFFSET * 2; // Maintain proper spacing
        }

        // Find existing paternal children at the same generation level (one below parents)
        // whose parents are already placed at this generation
        const childGen = generation - 1;
        const existingChildrenWithParents = Array.from(positions.values())
          .filter(n => n.generation === childGen && n.side === 'paternal' && n.id !== childId && (n.fatherId || n.motherId));

        // If the new child is MORE outward (more negative x) than ALL existing children with parents,
        // the new couple should shift outward (left). Otherwise, existing nodes shift outward.
        const newChildIsMoreOutward = existingChildrenWithParents.length > 0 &&
          existingChildrenWithParents.every(child => childX < child.x);

        if (newChildIsMoreOutward) {
          // New child is more outward - shift NEW couple outward (left)
          while (checkCollision(fatherX, generation) || checkCollision(motherX, generation)) {
            fatherX -= NODE_WIDTH + HORIZONTAL_GAP;
            motherX -= NODE_WIDTH + HORIZONTAL_GAP;
          }
        } else {
          // New child is closer to center - shift EXISTING nodes outward (left) to make room
          while (checkCollision(fatherX, generation) || checkCollision(motherX, generation)) {
            shiftExisting(generation, 'paternal');
          }
        }
      } else {
        // Maternal side: both parents should stay at x > 0
        // If father would cross center, shift whole couple right
        if (fatherX < SIDE_MARGIN) {
          fatherX = SIDE_MARGIN;
          motherX = fatherX + COUPLE_OFFSET * 2; // Maintain proper spacing
        }
        // If collision, shift new couple right (outward) until clear
        while (checkCollision(fatherX, generation) || checkCollision(motherX, generation)) {
          fatherX += NODE_WIDTH + HORIZONTAL_GAP;
          motherX += NODE_WIDTH + HORIZONTAL_GAP;
        }
      }

      if (unit.father) {
        const fatherData = lookup.get(unit.father.id);
        positions.set(unit.father.id, {
          id: unit.father.id,
          person: unit.father,
          parentUnits: fatherData?.parentUnits,
          generation,
          isExpanded: autoExpand,
          childId,
          x: fatherX,
          y: 0,
          side,
        });
        if (autoExpand) expanded.add(unit.father.id);
      }

      if (unit.mother) {
        const motherData = lookup.get(unit.mother.id);
        positions.set(unit.mother.id, {
          id: unit.mother.id,
          person: unit.mother,
          parentUnits: motherData?.parentUnits,
          generation,
          isExpanded: autoExpand,
          childId,
          x: motherX,
          y: 0,
          side,
        });
        if (autoExpand) expanded.add(unit.mother.id);
      }
    };

    // Add root's parents at generation 1
    const rootUnit = data.parentUnits?.[0];
    if (rootUnit) {
      // Father at gen 1, left side (paternal)
      if (rootUnit.father) {
        const fatherData = lookup.get(rootUnit.father.id);
        const fatherX = -COUPLE_OFFSET;
        positions.set(rootUnit.father.id, {
          id: rootUnit.father.id,
          person: rootUnit.father,
          parentUnits: fatherData?.parentUnits,
          generation: 1,
          isExpanded: true,
          childId: data.rootPerson.id,
          x: fatherX,
          y: 0,
          side: 'paternal',
        });
        expanded.add(rootUnit.father.id);

        // Add father's parents at generation 2 (paternal side)
        addParents(rootUnit.father.id, fatherX, 2, rootUnit.fatherParentUnits, false, 'paternal');
      }

      // Mother at gen 1, right side (maternal)
      if (rootUnit.mother) {
        const motherData = lookup.get(rootUnit.mother.id);
        const motherX = COUPLE_OFFSET;
        positions.set(rootUnit.mother.id, {
          id: rootUnit.mother.id,
          person: rootUnit.mother,
          parentUnits: motherData?.parentUnits,
          generation: 1,
          isExpanded: true,
          childId: data.rootPerson.id,
          x: motherX,
          y: 0,
          side: 'maternal',
        });
        expanded.add(rootUnit.mother.id);

        // Add mother's parents at generation 2 (maternal side)
        addParents(rootUnit.mother.id, motherX, 2, rootUnit.motherParentUnits, false, 'maternal');
      }
    }

    // Calculate Y positions only (X positions are already set)
    recalculateYPositions(positions);

    // Update father/mother IDs based on expanded state
    positions.forEach(node => {
      if (expanded.has(node.id)) {
        const unit = node.parentUnits?.[0];
        if (unit?.father && positions.has(unit.father.id)) node.fatherId = unit.father.id;
        if (unit?.mother && positions.has(unit.mother.id)) node.motherId = unit.mother.id;
      }
    });

    setNodePositions(positions);
    setExpandedNodes(expanded);
  }, [data.rootPerson.id, recalculateYPositions, personLookup]); // Only run on initial load or root change

  // Sync parentUnits when new data arrives (e.g., after loading ancestors from API)
  useEffect(() => {
    const lookup = personLookup();
    setNodePositions(prev => {
      let changed = false;
      const positions = new Map(prev);
      positions.forEach((node, id) => {
        const freshData = lookup.get(id);
        if (freshData && freshData.parentUnits !== node.parentUnits) {
          node.parentUnits = freshData.parentUnits;
          changed = true;
        }
      });
      return changed ? positions : prev;
    });
  }, [data, personLookup]);

  // Helper to check if a position collides with existing nodes at a generation
  const hasCollision = useCallback((positions: Map<string, PositionedNode>, x: number, generation: number, excludeIds: string[] = []) => {
    const minDistance = NODE_WIDTH + HORIZONTAL_GAP; // Minimum distance between card centers
    for (const node of positions.values()) {
      if (node.generation === generation && !excludeIds.includes(node.id)) {
        if (Math.abs(node.x - x) < minDistance) {
          return true;
        }
      }
    }
    return false;
  }, []);

  // Helper to shift existing nodes outward on a side to make room for new nodes
  // On paternal side (x < 0), outward means more negative (left)
  // On maternal side (x > 0), outward means more positive (right)
  const shiftExistingNodesOutward = useCallback((
    positions: Map<string, PositionedNode>,
    generation: number,
    side: 'paternal' | 'maternal',
    shiftAmount: number
  ) => {
    const direction = side === 'paternal' ? -1 : 1;
    positions.forEach(node => {
      if (node.generation === generation && node.side === side) {
        node.x += shiftAmount * direction;
      }
    });
  }, []);

  // Expand a node: add parents with FIXED X positions relative to child
  // Only Y positions are recalculated - descendants never move horizontally
  // Side tracking ensures paternal ancestors stay left, maternal stay right
  // When new parents collide with existing ones, EXISTING ones shift outward
  // This ensures the ordering: ancestors of fathers go outward, ancestors of mothers stay inward
  const expandNode = useCallback((nodeId: string) => {
    const lookup = personLookup();

    setNodePositions(prev => {
      const positions = new Map(prev);
      const node = positions.get(nodeId);
      if (!node) return prev;

      const unit = node.parentUnits?.[0];
      if (!unit || (!unit.father && !unit.mother)) return prev;

      const newGen = node.generation + 1;

      // Determine side: inherit from node, or assign based on position relative to root
      // Root's direct children get paternal/maternal, others inherit their child's side
      const side: 'paternal' | 'maternal' = node.side === 'root'
        ? 'paternal' // This shouldn't happen since root expands both at init
        : node.side;

      // Calculate couple positions ensuring proper paired placement
      // When one spouse needs clamping, shift the whole couple to maintain spacing
      let fatherX = node.x - COUPLE_OFFSET;
      let motherX = node.x + COUPLE_OFFSET;

      if (side === 'paternal') {
        // Paternal side: both parents should stay at x < 0
        // If mother would cross center, shift whole couple left
        if (motherX > -SIDE_MARGIN) {
          motherX = -SIDE_MARGIN;
          fatherX = motherX - COUPLE_OFFSET * 2; // Maintain proper spacing
        }

        // Find the most inward (closest to center) existing paternal child whose parents are at this generation
        // We need to check children (generation - 1 from parents = node.generation) to see who else has parents there
        const existingChildrenWithParents = Array.from(positions.values())
          .filter(n => n.generation === node.generation && n.side === 'paternal' && n.id !== nodeId && (n.fatherId || n.motherId));

        // If the new child is MORE outward (more negative x) than ALL existing children with parents,
        // the new couple should shift outward (left). Otherwise, existing nodes shift outward.
        const newChildIsMoreOutward = existingChildrenWithParents.length > 0 &&
          existingChildrenWithParents.every(child => node.x < child.x);

        if (newChildIsMoreOutward) {
          // New child is more outward - shift NEW couple outward (left)
          while (hasCollision(positions, fatherX, newGen) || hasCollision(positions, motherX, newGen)) {
            fatherX -= NODE_WIDTH + HORIZONTAL_GAP;
            motherX -= NODE_WIDTH + HORIZONTAL_GAP;
          }
        } else {
          // New child is closer to center - shift EXISTING nodes outward (left) to make room
          while (hasCollision(positions, fatherX, newGen) || hasCollision(positions, motherX, newGen)) {
            shiftExistingNodesOutward(positions, newGen, 'paternal', NODE_WIDTH + HORIZONTAL_GAP);
          }
        }
      } else {
        // Maternal side: both parents should stay at x > 0
        // If father would cross center, shift whole couple right
        if (fatherX < SIDE_MARGIN) {
          fatherX = SIDE_MARGIN;
          motherX = fatherX + COUPLE_OFFSET * 2; // Maintain proper spacing
        }
        // If collision, shift new couple right (outward) until clear
        while (hasCollision(positions, fatherX, newGen) || hasCollision(positions, motherX, newGen)) {
          fatherX += NODE_WIDTH + HORIZONTAL_GAP;
          motherX += NODE_WIDTH + HORIZONTAL_GAP;
        }
      }

      if (unit.father) {
        const fatherData = lookup.get(unit.father.id);
        positions.set(unit.father.id, {
          id: unit.father.id,
          person: unit.father,
          parentUnits: fatherData?.parentUnits,
          generation: newGen,
          isExpanded: false,
          childId: nodeId,
          x: fatherX,
          y: 0,
          side,
        });
        node.fatherId = unit.father.id;
      }

      if (unit.mother) {
        const motherData = lookup.get(unit.mother.id);
        positions.set(unit.mother.id, {
          id: unit.mother.id,
          person: unit.mother,
          parentUnits: motherData?.parentUnits,
          generation: newGen,
          isExpanded: false,
          childId: nodeId,
          x: motherX,
          y: 0,
          side,
        });
        node.motherId = unit.mother.id;
      }

      node.isExpanded = true;

      // Only recalculate Y positions (X positions are fixed)
      recalculateYPositions(positions);

      return positions;
    });

    setExpandedNodes(prev => new Set(prev).add(nodeId));
  }, [personLookup, recalculateYPositions, hasCollision, shiftExistingNodesOutward]);

  // Collapse a node: remove parents and recalculate Y positions only
  const collapseNode = useCallback((nodeId: string) => {
    setNodePositions(prev => {
      const positions = new Map(prev);
      const node = positions.get(nodeId);
      if (!node) return prev;

      // Recursively remove all ancestors of this node by following childId links
      const removeAncestors = (id: string) => {
        const parents = Array.from(positions.values()).filter(n => n.childId === id);
        for (const parent of parents) {
          removeAncestors(parent.id);
          positions.delete(parent.id);
        }
      };

      removeAncestors(nodeId);
      node.fatherId = undefined;
      node.motherId = undefined;
      node.isExpanded = false;

      // Only recalculate Y positions (X positions stay fixed)
      recalculateYPositions(positions);

      return positions;
    });

    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, [recalculateYPositions]);

  // Toggle expansion for a person
  const handleToggleExpand = useCallback((personId: string) => {
    if (expandedNodes.has(personId)) {
      collapseNode(personId);
    } else {
      expandNode(personId);
    }
  }, [expandedNodes, expandNode, collapseNode]);

  // Handle loading more ancestors from API
  const handleLoadAncestors = useCallback(async (personId: string, isFather: boolean) => {
    if (!onExpand) return;
    const request: ExpandAncestryRequest = isFather
      ? { fatherId: personId }
      : { motherId: personId };
    await onExpand(request, `expand_${personId}`);
    // Auto-expand after loading - need to re-init to pick up new data
    // The data prop will change, triggering useEffect
  }, [onExpand]);


  // Generate connector paths between children and parents
  // The horizontal bend (midY) is stacked based on generation AND horizontal position
  // to avoid overlapping lines when siblings both have parents expanded
  const generateConnectors = useCallback((nodes: PositionedNode[]): ConnectorPath[] => {
    const nodeMap = new Map<string, PositionedNode>();
    nodes.forEach(n => nodeMap.set(n.id, n));

    // Find max generation to calculate track offsets
    const maxGen = Math.max(...nodes.map(n => n.generation), 0);

    // Group nodes with parents by generation to assign sub-tracks
    const nodesWithParentsByGen = new Map<number, PositionedNode[]>();
    nodes.forEach(node => {
      if (node.fatherId || node.motherId) {
        const gen = node.generation;
        if (!nodesWithParentsByGen.has(gen)) {
          nodesWithParentsByGen.set(gen, []);
        }
        nodesWithParentsByGen.get(gen)!.push(node);
      }
    });
    // Sort each generation's nodes by x position (left to right)
    nodesWithParentsByGen.forEach(genNodes => {
      genNodes.sort((a, b) => a.x - b.x);
    });

    const paths: ConnectorPath[] = [];

    nodes.forEach(node => {
      if (!node.fatherId && !node.motherId) return;

      const father = node.fatherId ? nodeMap.get(node.fatherId) : undefined;
      const mother = node.motherId ? nodeMap.get(node.motherId) : undefined;

      const childTopY = node.y;
      const parentY = node.y - VERTICAL_GAP;
      const parentBottomY = parentY + NODE_HEIGHT;
      // Couple bar at the name/date area of parent cards (about 80% down)
      const coupleBarY = parentY + NODE_HEIGHT * 0.8;

      // Calculate the vertical space available for horizontal line tracks
      const trackSpace = childTopY - parentBottomY;
      const trackPadding = 10; // Minimum padding from parent/child
      const usableSpace = trackSpace - trackPadding * 2;

      // Stack horizontal lines based on generation AND position within generation
      // This ensures siblings at the same generation have different track heights
      const numGenerationTracks = Math.max(maxGen, 1);
      const genNodes = nodesWithParentsByGen.get(node.generation) || [node];
      const numSubTracks = genNodes.length;
      const subTrackIndex = genNodes.indexOf(node);

      // Divide space: first by generation, then subdivide by position within generation
      const genTrackHeight = usableSpace / numGenerationTracks;
      const trackIndex = Math.min(node.generation, numGenerationTracks - 1);
      const genTrackStart = childTopY - trackPadding - (trackIndex * genTrackHeight);
      const genTrackEnd = genTrackStart - genTrackHeight;

      // Within this generation's track, offset based on position (left nodes higher, right nodes lower)
      const subTrackSpace = genTrackHeight * 0.8; // Use 80% of track for sub-positioning
      const subTrackOffset = numSubTracks > 1
        ? (subTrackIndex / (numSubTracks - 1)) * subTrackSpace
        : subTrackSpace / 2;
      const midY = genTrackEnd + (genTrackHeight - subTrackSpace) / 2 + subTrackOffset;

      if (father && mother) {
        const coupleBarCenterX = (father.x + mother.x) / 2;

        paths.push({
          points: [
            { x: node.x, y: childTopY },
            { x: node.x, y: midY },
            { x: coupleBarCenterX, y: midY },
            { x: coupleBarCenterX, y: coupleBarY }
          ]
        });

        // Short horizontal segments from couple center to each parent card edge
        const fatherRightEdge = father.x + NODE_WIDTH / 2;
        const motherLeftEdge = mother.x - NODE_WIDTH / 2;
        paths.push({
          points: [{ x: fatherRightEdge, y: coupleBarY }, { x: motherLeftEdge, y: coupleBarY }],
          isCoupleLine: true
        });
      } else {
        // Single parent - simple L-shaped connector
        const parent = father || mother!;
        paths.push({
          points: [
            { x: node.x, y: childTopY },
            { x: node.x, y: midY },
            { x: parent.x, y: midY },
            { x: parent.x, y: parentBottomY }
          ]
        });
      }
    });

    return paths;
  }, []);

  // Get positioned nodes from state
  const positionedNodes = Array.from(nodePositions.values());
  const connectorPaths = generateConnectors(positionedNodes);

  // Calculate bounds
  const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  positionedNodes.forEach(node => {
    bounds.minX = Math.min(bounds.minX, node.x - NODE_WIDTH / 2);
    bounds.maxX = Math.max(bounds.maxX, node.x + NODE_WIDTH / 2);
    bounds.minY = Math.min(bounds.minY, node.y);
    bounds.maxY = Math.max(bounds.maxY, node.y + NODE_HEIGHT);
  });

  // Add padding to bounds
  const padding = 100;
  const contentWidth = bounds.maxX - bounds.minX + padding * 2;
  const contentHeight = bounds.maxY - bounds.minY + padding * 2;
  const offsetX = -bounds.minX + padding;
  const offsetY = -bounds.minY + padding;

  // Setup D3 zoom (only once)
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const containerSelection = d3.select(container);
    const contentSelection = d3.select(content);

    const zoom = d3.zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.2, 2])
      .on('zoom', (event) => {
        const { x, y, k } = event.transform;
        contentSelection.style('transform', `translate(${x}px, ${y}px) scale(${k})`);
        contentSelection.style('transform-origin', '0 0');
        setCurrentZoom(k);
      });

    containerSelection.call(zoom);
    zoomRef.current = zoom;

    return () => {
      containerSelection.on('.zoom', null);
    };
  }, []);

  // Initial centering (only once when first loaded)
  useEffect(() => {
    if (isInitialized || !containerRef.current || !zoomRef.current || nodePositions.size === 0) return;

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();

    // Calculate bounds at initialization time
    const nodes = Array.from(nodePositions.values());
    const initBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    nodes.forEach(node => {
      initBounds.minX = Math.min(initBounds.minX, node.x - NODE_WIDTH / 2);
      initBounds.maxX = Math.max(initBounds.maxX, node.x + NODE_WIDTH / 2);
      initBounds.minY = Math.min(initBounds.minY, node.y);
      initBounds.maxY = Math.max(initBounds.maxY, node.y + NODE_HEIGHT);
    });
    const initWidth = initBounds.maxX - initBounds.minX + 200;
    const initHeight = initBounds.maxY - initBounds.minY + 200;

    const scaleX = (containerRect.width - 40) / initWidth;
    const scaleY = (containerRect.height - 40) / initHeight;
    const scale = Math.min(scaleX, scaleY, 1);
    const finalScale = Math.max(0.3, Math.min(scale, 0.9));

    const scaledWidth = initWidth * finalScale;
    const scaledHeight = initHeight * finalScale;
    const x = (containerRect.width - scaledWidth) / 2;
    const y = containerRect.height - scaledHeight - 20;

    const containerSelection = d3.select(container);
    containerSelection
      .transition()
      .duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(x, y).scale(finalScale));

    setIsInitialized(true);
  }, [isInitialized, nodePositions.size]); // Only run once when nodes are first loaded

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    const container = containerRef.current;
    if (!container || !zoomRef.current) return;
    d3.select(container).transition().duration(200).call(zoomRef.current.scaleBy, 1.3);
  }, []);

  const handleZoomOut = useCallback(() => {
    const container = containerRef.current;
    if (!container || !zoomRef.current) return;
    d3.select(container).transition().duration(200).call(zoomRef.current.scaleBy, 0.7);
  }, []);

  // Find parent pairs for couple collapse buttons
  const parentPairs = positionedNodes
    .filter(n => n.fatherId && n.motherId)
    .map(child => {
      const father = nodePositions.get(child.fatherId!);
      const mother = nodePositions.get(child.motherId!);
      if (!father || !mother) return null;
      return { childId: child.id, father, mother };
    })
    .filter(Boolean) as { childId: string; father: PositionedNode; mother: PositionedNode }[];

  // Person card component
  const PersonCard = ({ node, isRoot = false }: { node: PositionedNode; isRoot?: boolean }) => {
    const { person, parentUnits } = node;
    const genderColors = GENDER_COLORS[person.gender || 'unknown'];

    // Check if parents are actually DISPLAYED in the tree (not just in data)
    const hasDisplayedParents = !!(node.fatherId || node.motherId);
    const hasBothDisplayedParents = !!(node.fatherId && node.motherId);

    // Check if parent data exists (for showing expand when collapsed)
    const hasParentData = parentUnits && parentUnits.length > 0 && (parentUnits[0].father || parentUnits[0].mother);
    const hasBothParentData = parentUnits?.[0]?.father && parentUnits?.[0]?.mother;

    // Can load more from API (no parent data yet but hasMoreAncestors flag)
    const canLoadFromApi = person.hasMoreAncestors && !hasParentData && onExpand;

    // Can expand to show already-loaded parents
    const canExpandLoaded = hasParentData && !hasDisplayedParents;

    const isExpanding = expandingNodes.has(`expand_${person.id}`);

    // Show individual expand button if:
    // 1. Can load from API (no data yet)
    // 2. Can expand single parent (data exists, not displayed, only one parent)
    // 3. Can expand couple (data exists, not displayed) - but couple button handles when displayed
    const showExpandButton = canLoadFromApi || (canExpandLoaded && !hasBothParentData) || (canExpandLoaded && !hasBothDisplayedParents && hasBothParentData);

    // For root, card is wider so we need to adjust centering
    const cardWidth = isRoot ? NODE_WIDTH + 40 : NODE_WIDTH;

    return (
      <div
        className="absolute"
        style={{
          left: node.x + offsetX - cardWidth / 2,
          top: node.y + offsetY,
          width: cardWidth,
        }}
      >
        <div className="relative flex flex-col items-center" style={{ width: cardWidth }}>
          {/* Expand/Collapse button (above card) - for single parent or loading */}
          {showExpandButton && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (canExpandLoaded) {
                  handleToggleExpand(person.id);
                } else if (canLoadFromApi) {
                  handleLoadAncestors(person.id, true);
                }
              }}
              disabled={isExpanding}
              className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 w-6 h-6 rounded-full bg-app-card border border-app-border flex items-center justify-center hover:bg-app-hover shadow-sm cursor-pointer disabled:opacity-50"
              title={hasDisplayedParents ? "Hide ancestors" : (hasParentData ? "Show ancestors" : "Load ancestors")}
            >
              {isExpanding ? (
                <div className="w-3 h-3 border-2 border-app-text-muted border-t-transparent rounded-full animate-spin" />
              ) : hasDisplayedParents ? (
                <ChevronDown className="w-4 h-4 text-app-text-secondary" />
              ) : (
                <ChevronUp className="w-4 h-4 text-app-text-secondary" />
              )}
            </button>
          )}

          {/* Person card - vertical layout with photo on top, gender bar at bottom */}
          <Link
            to={`/person/${dbId}/${person.id}`}
            data-person-id={person.id}
            className={`flex flex-col rounded-lg shadow-md hover:shadow-lg transition-all overflow-hidden border`}
            style={{
              width: cardWidth,
              height: isRoot ? NODE_HEIGHT + 20 : NODE_HEIGHT,
              borderColor: 'var(--color-app-border)',
              backgroundColor: 'var(--color-app-card)',
            }}
          >
            {/* Photo area - takes ~65% of card height */}
            <div
              className="w-full flex items-center justify-center overflow-hidden"
              style={{
                backgroundColor: genderColors.bg,
                height: isRoot ? '65%' : '60%',
              }}
            >
              {person.photoUrl ? (
                <img
                  src={person.photoUrl}
                  alt={person.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <AvatarPlaceholder gender={person.gender} className={isRoot ? 'w-16 h-16' : 'w-14 h-14'} />
              )}
            </div>

            {/* Info area */}
            <div className="flex-1 flex flex-col items-center justify-center px-2 py-1 text-center">
              <div className={`font-semibold text-app-text leading-tight ${isRoot ? 'text-sm' : 'text-xs'}`} style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {person.name}
              </div>
              <div className={`text-app-text-muted ${isRoot ? 'text-xs' : 'text-[10px]'}`}>
                {person.lifespan}
              </div>
            </div>

            {/* Gender color bar at bottom */}
            <div
              className="w-full h-1 flex-shrink-0"
              style={{ backgroundColor: genderColors.border }}
            />
          </Link>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-app-bg">
      {/* Controls */}
      <div className="px-4 py-2 bg-app-card border-b border-app-border flex items-center justify-between">
        <div className="text-sm text-app-text-muted">
          {data.rootPerson.name} &mdash; Vertical Family View
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={handleZoomOut}
              className="p-1 rounded hover:bg-app-hover"
              title="Zoom out"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <span className="text-sm text-app-text-muted min-w-[3rem] text-center">
              {Math.round(currentZoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-1 rounded hover:bg-app-hover"
              title="Zoom in"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-tree-bg cursor-grab active:cursor-grabbing"
      >
        <div
          ref={contentRef}
          className="relative"
          style={{
            width: contentWidth,
            height: contentHeight,
          }}
        >
          {/* SVG for connector lines */}
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{ width: contentWidth, height: contentHeight }}
          >
            <g transform={`translate(${offsetX}, ${offsetY})`}>
              {connectorPaths.map((path, i) => (
                <polyline
                  key={i}
                  points={path.points.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="var(--color-tree-line)"
                  strokeWidth={path.isCoupleLine ? 3 : 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </g>
          </svg>

          {/* Person nodes */}
          {positionedNodes.map((node) => (
            <PersonCard
              key={node.person.id}
              node={node}
              isRoot={node.generation === 0}
            />
          ))}

          {/* Couple collapse buttons (above child node, centered between parents) */}
          {parentPairs.map(({ childId }) => {
            const child = nodePositions.get(childId);
            if (!child) return null;
            const buttonY = child.y; // Halfway into the child card
            const isExpanded = child.isExpanded;

            return (
              <button
                key={`couple-${childId}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleExpand(childId);
                }}
                className="absolute z-20 w-6 h-6 rounded-full bg-app-card border border-app-border flex items-center justify-center hover:bg-app-hover shadow-sm cursor-pointer"
                style={{
                  left: child.x + offsetX - 12,
                  top: buttonY + offsetY - 12,
                }}
                title={isExpanded ? "Hide ancestors" : "Show ancestors"}
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-app-text-secondary" />
                ) : (
                  <ChevronUp className="w-4 h-4 text-app-text-secondary" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-app-border bg-app-card text-xs text-app-text-muted flex items-center gap-4">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border-2" style={{ borderColor: GENDER_COLORS.male.border, backgroundColor: GENDER_COLORS.male.bg }}></span> Male
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border-2" style={{ borderColor: GENDER_COLORS.female.border, backgroundColor: GENDER_COLORS.female.bg }}></span> Female
        </span>
        <span>|</span>
        <span>Scroll to zoom | Drag to pan | Click ▲ to expand ancestors</span>
      </div>
    </div>
  );
}
