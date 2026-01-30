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

  // Initialize the tree with root and first generation
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
      y: 0, // Will be adjusted based on maxGen
    });
    expanded.add(data.rootPerson.id);

    // Add root's parents at generation 1
    const rootUnit = data.parentUnits?.[0];
    if (rootUnit) {
      if (rootUnit.father) {
        const fatherData = lookup.get(rootUnit.father.id);
        positions.set(rootUnit.father.id, {
          id: rootUnit.father.id,
          person: rootUnit.father,
          parentUnits: fatherData?.parentUnits,
          generation: 1,
          isExpanded: true,
          childId: data.rootPerson.id,
          x: -(NODE_WIDTH + HORIZONTAL_GAP) / 2,
          y: 0,
        });
        expanded.add(rootUnit.father.id);

        // Add father's parents at generation 2 (auto-expand first 2 gens)
        const fatherUnit = rootUnit.fatherParentUnits?.[0];
        if (fatherUnit) {
          if (fatherUnit.father) {
            const gfData = lookup.get(fatherUnit.father.id);
            positions.set(fatherUnit.father.id, {
              id: fatherUnit.father.id,
              person: fatherUnit.father,
              parentUnits: gfData?.parentUnits,
              generation: 2,
              isExpanded: false,
              childId: rootUnit.father.id,
              x: -(NODE_WIDTH + HORIZONTAL_GAP) - (NODE_WIDTH + HORIZONTAL_GAP) / 2,
              y: 0,
            });
          }
          if (fatherUnit.mother) {
            const gmData = lookup.get(fatherUnit.mother.id);
            positions.set(fatherUnit.mother.id, {
              id: fatherUnit.mother.id,
              person: fatherUnit.mother,
              parentUnits: gmData?.parentUnits,
              generation: 2,
              isExpanded: false,
              childId: rootUnit.father.id,
              x: -(NODE_WIDTH + HORIZONTAL_GAP) + (NODE_WIDTH + HORIZONTAL_GAP) / 2,
              y: 0,
            });
          }
        }
      }

      if (rootUnit.mother) {
        const motherData = lookup.get(rootUnit.mother.id);
        positions.set(rootUnit.mother.id, {
          id: rootUnit.mother.id,
          person: rootUnit.mother,
          parentUnits: motherData?.parentUnits,
          generation: 1,
          isExpanded: true,
          childId: data.rootPerson.id,
          x: (NODE_WIDTH + HORIZONTAL_GAP) / 2,
          y: 0,
        });
        expanded.add(rootUnit.mother.id);

        // Add mother's parents at generation 2
        const motherUnit = rootUnit.motherParentUnits?.[0];
        if (motherUnit) {
          if (motherUnit.father) {
            const gfData = lookup.get(motherUnit.father.id);
            positions.set(motherUnit.father.id, {
              id: motherUnit.father.id,
              person: motherUnit.father,
              parentUnits: gfData?.parentUnits,
              generation: 2,
              isExpanded: false,
              childId: rootUnit.mother.id,
              x: (NODE_WIDTH + HORIZONTAL_GAP) - (NODE_WIDTH + HORIZONTAL_GAP) / 2,
              y: 0,
            });
          }
          if (motherUnit.mother) {
            const gmData = lookup.get(motherUnit.mother.id);
            positions.set(motherUnit.mother.id, {
              id: gmData?.person.id || motherUnit.mother.id,
              person: motherUnit.mother,
              parentUnits: gmData?.parentUnits,
              generation: 2,
              isExpanded: false,
              childId: rootUnit.mother.id,
              x: (NODE_WIDTH + HORIZONTAL_GAP) + (NODE_WIDTH + HORIZONTAL_GAP) / 2,
              y: 0,
            });
          }
        }
      }
    }

    // Calculate Y positions based on max generation
    const maxGen = Math.max(...Array.from(positions.values()).map(n => n.generation));
    positions.forEach(node => {
      node.y = (maxGen - node.generation) * VERTICAL_GAP;
    });

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
  }, [data.rootPerson.id]); // Only run on initial load or root change

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

  // Expand a node: add parents and shift siblings to make room
  const expandNode = useCallback((nodeId: string) => {
    const lookup = personLookup();

    setNodePositions(prev => {
      const positions = new Map(prev);
      const node = positions.get(nodeId);
      if (!node) return prev;

      const unit = node.parentUnits?.[0];
      if (!unit || (!unit.father && !unit.mother)) return prev;

      const newGen = node.generation + 1;
      const parentSpacing = (NODE_WIDTH + HORIZONTAL_GAP) / 2;

      // Calculate width needed by new parents
      const neededWidth = (unit.father && unit.mother)
        ? NODE_WIDTH * 2 + HORIZONTAL_GAP
        : NODE_WIDTH;

      // Find all nodes at node's generation that are siblings (different parent)
      const nodeGenNodes = Array.from(positions.values())
        .filter(n => n.generation === node.generation && n.id !== nodeId);

      const shiftAmount = neededWidth / 2;

      // Recursive function to shift a node and all its ancestors
      const shiftBranch = (id: string, dx: number, visited = new Set<string>()) => {
        if (visited.has(id)) return;
        visited.add(id);
        const n = positions.get(id);
        if (!n) return;
        n.x += dx;
        if (n.fatherId) shiftBranch(n.fatherId, dx, visited);
        if (n.motherId) shiftBranch(n.motherId, dx, visited);
      };

      nodeGenNodes.forEach(sibling => {
        if (sibling.x < node.x) {
          shiftBranch(sibling.id, -shiftAmount);
        } else if (sibling.x > node.x) {
          shiftBranch(sibling.id, shiftAmount);
        }
      });

      // Add parent nodes (Y will be calculated based on generation at the end)
      if (unit.father) {
        const fatherData = lookup.get(unit.father.id);
        positions.set(unit.father.id, {
          id: unit.father.id,
          person: unit.father,
          parentUnits: fatherData?.parentUnits,
          generation: newGen,
          isExpanded: false,
          childId: nodeId,
          x: unit.mother ? node.x - parentSpacing : node.x,
          y: 0, // Will be recalculated
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
          x: unit.father ? node.x + parentSpacing : node.x,
          y: 0, // Will be recalculated
        });
        node.motherId = unit.mother.id;
      }

      node.isExpanded = true;

      // Recalculate ALL Y positions based on generation to keep same-gen nodes aligned
      const maxGen = Math.max(...Array.from(positions.values()).map(n => n.generation));
      positions.forEach(n => {
        n.y = (maxGen - n.generation) * VERTICAL_GAP;
      });

      return positions;
    });

    setExpandedNodes(prev => new Set(prev).add(nodeId));
  }, [personLookup]);

  // Collapse a node: remove parents and shift siblings back
  const collapseNode = useCallback((nodeId: string) => {
    setNodePositions(prev => {
      const positions = new Map(prev);
      const node = positions.get(nodeId);
      if (!node) return prev;

      // Recursively remove all ancestors of this node
      const removeAncestors = (id: string) => {
        const n = positions.get(id);
        if (!n) return;
        if (n.fatherId) {
          removeAncestors(n.fatherId);
          positions.delete(n.fatherId);
        }
        if (n.motherId) {
          removeAncestors(n.motherId);
          positions.delete(n.motherId);
        }
      };

      // Calculate how much space to reclaim
      const hadBothParents = node.fatherId && node.motherId;
      const reclaimWidth = hadBothParents
        ? (NODE_WIDTH * 2 + HORIZONTAL_GAP) / 2
        : NODE_WIDTH / 2;

      removeAncestors(nodeId);
      node.fatherId = undefined;
      node.motherId = undefined;
      node.isExpanded = false;

      // Shift siblings back to reclaim space
      const nodeGenNodes = Array.from(positions.values())
        .filter(n => n.generation === node.generation && n.id !== nodeId);

      const shiftBranch = (id: string, dx: number, visited = new Set<string>()) => {
        if (visited.has(id)) return;
        visited.add(id);
        const n = positions.get(id);
        if (!n) return;
        n.x += dx;
        if (n.fatherId) shiftBranch(n.fatherId, dx, visited);
        if (n.motherId) shiftBranch(n.motherId, dx, visited);
      };

      nodeGenNodes.forEach(sibling => {
        if (sibling.x < node.x) {
          shiftBranch(sibling.id, reclaimWidth);
        } else if (sibling.x > node.x) {
          shiftBranch(sibling.id, -reclaimWidth);
        }
      });

      // Recalculate ALL Y positions based on generation to keep same-gen nodes aligned
      const maxGenAfter = Math.max(...Array.from(positions.values()).map(n => n.generation));
      positions.forEach(n => {
        n.y = (maxGenAfter - n.generation) * VERTICAL_GAP;
      });

      return positions;
    });

    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);

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
  const generateConnectors = useCallback((nodes: PositionedNode[]): ConnectorPath[] => {
    const nodeMap = new Map<string, PositionedNode>();
    nodes.forEach(n => nodeMap.set(n.id, n));

    const paths: ConnectorPath[] = [];

    nodes.forEach(node => {
      if (!node.fatherId && !node.motherId) return;

      const father = node.fatherId ? nodeMap.get(node.fatherId) : undefined;
      const mother = node.motherId ? nodeMap.get(node.motherId) : undefined;

      const childTopY = node.y;
      const parentY = node.y - VERTICAL_GAP;
      // Couple bar at the name/date area of parent cards (about 80% down)
      const coupleBarY = parentY + NODE_HEIGHT * 0.8;

      if (father && mother) {
        const coupleBarCenterX = (father.x + mother.x) / 2;

        // Vertical line from child up to midpoint, then horizontal to couple center, then up
        const midY = (childTopY + coupleBarY) / 2;
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
        const parentBottomY = parentY + NODE_HEIGHT;
        const midY = (childTopY + parentBottomY) / 2;
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
