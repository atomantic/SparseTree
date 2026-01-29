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
const NODE_WIDTH = 160;
const NODE_HEIGHT = 80;
const HORIZONTAL_GAP = 20; // Gap between nodes in same generation
const VERTICAL_GAP = 120; // Increased for taller connector lines

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
  // Track which people are expanded (showing their parents)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    // Start with root and first two generations expanded
    const initial = new Set<string>();
    initial.add(data.rootPerson.id);
    // Expand root's parents
    const rootUnit = data.parentUnits?.[0];
    if (rootUnit?.father) initial.add(rootUnit.father.id);
    if (rootUnit?.mother) initial.add(rootUnit.mother.id);
    return initial;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [currentZoom, setCurrentZoom] = useState(0.8);
  const [isInitialized, setIsInitialized] = useState(false);
  const [pendingCenterId, setPendingCenterId] = useState<string | null>(null);

  // Toggle expansion for a person
  const handleToggleExpand = useCallback((personId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
        // Center on the newly expanded node
        setPendingCenterId(personId);
      }
      return next;
    });
  }, []);

  // Handle loading more ancestors from API
  const handleLoadAncestors = useCallback(async (personId: string, isFather: boolean) => {
    if (!onExpand) return;
    const request: ExpandAncestryRequest = isFather
      ? { fatherId: personId }
      : { motherId: personId };
    await onExpand(request, `expand_${personId}`);
    // Auto-expand after loading
    setExpandedNodes(prev => new Set(prev).add(personId));
  }, [onExpand]);

  // Build flat node list by traversing the tree
  const buildNodeList = useCallback((): TreeNode[] => {
    const nodes: TreeNode[] = [];
    const visited = new Set<string>();

    const traverse = (
      person: AncestryPersonCard,
      parentUnits: AncestryFamilyUnit[] | undefined,
      generation: number,
      childId?: string
    ) => {
      if (visited.has(person.id)) return;
      visited.add(person.id);

      const isExpanded = expandedNodes.has(person.id);
      const unit = parentUnits?.[0];

      const node: TreeNode = {
        id: person.id,
        person,
        parentUnits,
        generation,
        isExpanded,
        fatherId: isExpanded && unit?.father ? unit.father.id : undefined,
        motherId: isExpanded && unit?.mother ? unit.mother.id : undefined,
        childId,
      };
      nodes.push(node);

      // Recursively add parents if expanded
      if (isExpanded && unit) {
        if (unit.father) {
          traverse(unit.father, unit.fatherParentUnits, generation + 1, person.id);
        }
        if (unit.mother) {
          traverse(unit.mother, unit.motherParentUnits, generation + 1, person.id);
        }
      }
    };

    traverse(data.rootPerson, data.parentUnits, 0);
    return nodes;
  }, [data.rootPerson, data.parentUnits, expandedNodes]);

  // Position nodes with multi-pass collision handling
  const positionNodes = useCallback((nodeList: TreeNode[]): PositionedNode[] => {
    const nodeMap = new Map<string, PositionedNode>();

    // Convert to positioned nodes
    nodeList.forEach(node => {
      nodeMap.set(node.id, { ...node, x: 0, y: 0 });
    });

    // Group by generation
    const generations = new Map<number, PositionedNode[]>();
    nodeMap.forEach(node => {
      const gen = node.generation;
      if (!generations.has(gen)) generations.set(gen, []);
      generations.get(gen)!.push(node);
    });

    const maxGen = Math.max(...generations.keys());

    // Set Y positions for all nodes
    nodeMap.forEach(node => {
      node.y = (maxGen - node.generation) * VERTICAL_GAP;
    });

    // Position root first (generation 0)
    const root = generations.get(0)?.[0];
    if (root) {
      root.x = 0;
    }

    // Multi-pass layout algorithm
    let changed = true;
    let iterations = 0;
    const MAX_ITERATIONS = 20;

    while (changed && iterations < MAX_ITERATIONS) {
      changed = false;
      iterations++;

      // Pass 1: Position parents centered above their children (bottom to top)
      for (let gen = 1; gen <= maxGen; gen++) {
        const genNodes = generations.get(gen) || [];
        genNodes.forEach(node => {
          const child = nodeMap.get(node.childId!)!;
          const siblings = genNodes.filter(n => n.childId === node.childId);
          const isFather = child.fatherId === node.id;

          if (siblings.length === 2) {
            // Position relative to child center (father left, mother right)
            const offset = (NODE_WIDTH + HORIZONTAL_GAP) / 2;
            const targetX = isFather ? child.x - offset : child.x + offset;
            if (Math.abs(node.x - targetX) > 0.5) {
              node.x = targetX;
              changed = true;
            }
          } else {
            // Single parent, center above child
            if (Math.abs(node.x - child.x) > 0.5) {
              node.x = child.x;
              changed = true;
            }
          }
        });
      }

      // Pass 2: Resolve collisions within each generation (top to bottom)
      for (let gen = maxGen; gen >= 1; gen--) {
        const genNodes = generations.get(gen) || [];

        // Group by child for collision resolution
        const groups = new Map<string, PositionedNode[]>();
        genNodes.forEach(node => {
          const childId = node.childId!;
          if (!groups.has(childId)) groups.set(childId, []);
          groups.get(childId)!.push(node);
        });

        // Sort groups by left edge
        const sortedGroups = Array.from(groups.entries())
          .map(([childId, nodes]) => ({
            childId,
            nodes,
            minX: Math.min(...nodes.map(n => n.x)) - NODE_WIDTH / 2,
            maxX: Math.max(...nodes.map(n => n.x)) + NODE_WIDTH / 2,
          }))
          .sort((a, b) => a.minX - b.minX);

        // Resolve overlaps by pushing right
        for (let i = 1; i < sortedGroups.length; i++) {
          const prev = sortedGroups[i - 1];
          const curr = sortedGroups[i];
          const overlap = prev.maxX + HORIZONTAL_GAP - curr.minX;

          if (overlap > 0) {
            // Shift current group to the right
            curr.nodes.forEach(n => { n.x += overlap; });
            curr.minX += overlap;
            curr.maxX += overlap;
            changed = true;
          }
        }
      }

      // Pass 3: Re-center children below their parents (top to bottom)
      for (let gen = maxGen - 1; gen >= 0; gen--) {
        const genNodes = generations.get(gen) || [];
        genNodes.forEach(node => {
          const father = node.fatherId ? nodeMap.get(node.fatherId) : undefined;
          const mother = node.motherId ? nodeMap.get(node.motherId) : undefined;

          if (father && mother) {
            const targetX = (father.x + mother.x) / 2;
            if (Math.abs(node.x - targetX) > 0.5) {
              node.x = targetX;
              changed = true;
            }
          } else if (father || mother) {
            const parent = father || mother!;
            if (Math.abs(node.x - parent.x) > 0.5) {
              node.x = parent.x;
              changed = true;
            }
          }
        });
      }
    }

    return Array.from(nodeMap.values());
  }, []);

  // Generate connector paths between children and parents
  const generateConnectors = useCallback((positionedNodes: PositionedNode[]): ConnectorPath[] => {
    const nodeMap = new Map<string, PositionedNode>();
    positionedNodes.forEach(n => nodeMap.set(n.id, n));

    const paths: ConnectorPath[] = [];

    positionedNodes.forEach(node => {
      if (!node.fatherId && !node.motherId) return;

      const father = node.fatherId ? nodeMap.get(node.fatherId) : undefined;
      const mother = node.motherId ? nodeMap.get(node.motherId) : undefined;

      const childTopY = node.y;
      const parentBottomY = node.y - VERTICAL_GAP + NODE_HEIGHT;
      const coupleBarY = parentBottomY + 15; // Coupling bar position - closer to cards
      const junctionY = childTopY - 15; // Where vertical line from child meets

      if (father && mother) {
        // Both parents: draw coupling bar and vertical drops
        const coupleBarCenterX = (father.x + mother.x) / 2;

        // Vertical from child up to junction point
        paths.push({ points: [{ x: node.x, y: childTopY }, { x: node.x, y: junctionY }] });

        // Junction to couple bar center (jog if needed)
        if (Math.abs(coupleBarCenterX - node.x) > 2) {
          paths.push({ points: [{ x: node.x, y: junctionY }, { x: coupleBarCenterX, y: junctionY }] });
          paths.push({ points: [{ x: coupleBarCenterX, y: junctionY }, { x: coupleBarCenterX, y: coupleBarY }] });
        } else {
          paths.push({ points: [{ x: node.x, y: junctionY }, { x: node.x, y: coupleBarY }] });
        }

        // Horizontal couple bar (marked for special styling)
        paths.push({
          points: [{ x: father.x, y: coupleBarY }, { x: mother.x, y: coupleBarY }],
          isCoupleLine: true
        });

        // Vertical drops to each parent card
        paths.push({ points: [{ x: father.x, y: coupleBarY }, { x: father.x, y: parentBottomY }] });
        paths.push({ points: [{ x: mother.x, y: coupleBarY }, { x: mother.x, y: parentBottomY }] });
      } else {
        // Single parent - simple L-shaped connector
        const parent = father || mother!;
        const midY = (childTopY + parentBottomY) / 2;
        paths.push({ points: [{ x: node.x, y: childTopY }, { x: node.x, y: midY }] });
        paths.push({ points: [{ x: node.x, y: midY }, { x: parent.x, y: midY }] });
        paths.push({ points: [{ x: parent.x, y: midY }, { x: parent.x, y: parentBottomY }] });
      }
    });

    return paths;
  }, []);

  // Build and position the tree
  const nodeList = buildNodeList();
  const positionedNodes = positionNodes(nodeList);
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
    if (isInitialized || !containerRef.current || !zoomRef.current) return;

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();

    const scaleX = (containerRect.width - 40) / contentWidth;
    const scaleY = (containerRect.height - 40) / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1);
    const finalScale = Math.max(0.3, Math.min(scale, 0.9));

    const scaledWidth = contentWidth * finalScale;
    const scaledHeight = contentHeight * finalScale;
    const x = (containerRect.width - scaledWidth) / 2;
    const y = containerRect.height - scaledHeight - 20;

    const containerSelection = d3.select(container);
    containerSelection
      .transition()
      .duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(x, y).scale(finalScale));

    setIsInitialized(true);
  }, [contentWidth, contentHeight, isInitialized]);

  // Center on expanded node (maintains current zoom)
  useEffect(() => {
    if (!pendingCenterId || !containerRef.current || !contentRef.current || !zoomRef.current) return;

    // Find the node that was expanded
    const expandedNode = positionedNodes.find(n => n.id === pendingCenterId);
    if (!expandedNode) {
      setPendingCenterId(null);
      return;
    }

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();

    // Calculate position to center on the expanded node (slightly above it to show parents)
    const nodeScreenX = expandedNode.x + offsetX;
    const nodeScreenY = expandedNode.y + offsetY - 50; // Offset up to show new parents

    const targetX = containerRect.width / 2 - nodeScreenX * currentZoom;
    const targetY = containerRect.height / 2 - nodeScreenY * currentZoom;

    const containerSelection = d3.select(container);
    containerSelection
      .transition()
      .duration(400)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(targetX, targetY).scale(currentZoom));

    setPendingCenterId(null);
  }, [pendingCenterId, positionedNodes, offsetX, offsetY, currentZoom]);

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

  // Person card component
  const PersonCard = ({ node, isRoot = false }: { node: PositionedNode; isRoot?: boolean }) => {
    const { person, parentUnits, isExpanded } = node;
    const genderColors = GENDER_COLORS[person.gender || 'unknown'];
    const hasLoadedParents = parentUnits && parentUnits.length > 0 && (parentUnits[0].father || parentUnits[0].mother);
    const canLoadMore = person.hasMoreAncestors && !hasLoadedParents && onExpand;
    const isExpanding = expandingNodes.has(`expand_${person.id}`);

    // Show expand button if: has loaded parents to show, or can load more
    const showExpandButton = hasLoadedParents || canLoadMore;

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
          {/* Expand/Collapse button (above card, centered) */}
          {showExpandButton && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasLoadedParents) {
                  handleToggleExpand(person.id);
                } else if (canLoadMore) {
                  handleLoadAncestors(person.id, true);
                }
              }}
              disabled={isExpanding}
              className="absolute -top-7 left-1/2 -translate-x-1/2 z-10 w-6 h-6 rounded-full bg-app-card border border-app-border flex items-center justify-center hover:bg-app-hover shadow-sm cursor-pointer disabled:opacity-50"
              title={isExpanded && hasLoadedParents ? "Hide ancestors" : (hasLoadedParents ? "Show ancestors" : "Load ancestors")}
            >
              {isExpanding ? (
                <div className="w-3 h-3 border-2 border-app-text-muted border-t-transparent rounded-full animate-spin" />
              ) : isExpanded && hasLoadedParents ? (
                <ChevronDown className="w-4 h-4 text-app-text-secondary" />
              ) : (
                <ChevronUp className="w-4 h-4 text-app-text-secondary" />
              )}
            </button>
          )}

          {/* Person card */}
          <Link
            to={`/person/${dbId}/${person.id}`}
            data-person-id={person.id}
            className={`flex items-center gap-2 rounded-lg shadow-md hover:shadow-lg transition-all ${
              isRoot ? 'p-3 border-4' : 'p-2 border-l-4'
            }`}
            style={{
              width: cardWidth,
              height: NODE_HEIGHT,
              borderColor: isRoot ? genderColors.border : undefined,
              borderLeftColor: !isRoot ? genderColors.border : undefined,
              backgroundColor: isRoot ? genderColors.bg : 'var(--color-app-card)',
              borderTopWidth: !isRoot ? '1px' : undefined,
              borderRightWidth: !isRoot ? '1px' : undefined,
              borderBottomWidth: !isRoot ? '1px' : undefined,
              borderTopColor: !isRoot ? 'var(--color-app-border)' : undefined,
              borderRightColor: !isRoot ? 'var(--color-app-border)' : undefined,
              borderBottomColor: !isRoot ? 'var(--color-app-border)' : undefined,
            }}
          >
            {/* Avatar */}
            <div
              className={`flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center ${
                isRoot ? 'w-12 h-12 border-4' : 'w-10 h-10 border-2'
              }`}
              style={{ borderColor: genderColors.border }}
            >
              {person.photoUrl ? (
                <img
                  src={person.photoUrl}
                  alt={person.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <AvatarPlaceholder gender={person.gender} className="w-full h-full" />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className={`font-semibold text-app-text truncate ${isRoot ? 'text-sm' : 'text-xs'}`}>
                {person.name}
              </div>
              <div className={`text-app-text-muted truncate ${isRoot ? 'text-xs' : 'text-[10px]'}`}>
                {person.lifespan}
              </div>
            </div>
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
