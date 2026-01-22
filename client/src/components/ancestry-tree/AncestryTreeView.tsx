import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as d3 from 'd3';
import type { AncestryTreeResult, AncestryFamilyUnit, ExpandAncestryRequest } from '@fsf/shared';
import { api } from '../../services/api';
import { PersonCard } from './PersonCard';
import { FamilyUnitCard } from './FamilyUnitCard';

interface RootLinePositions {
  totalHeight: number;
  unitPositions: number[];
}

export function AncestryTreeView() {
  const { dbId, personId } = useParams<{ dbId: string; personId?: string }>();
  const [treeData, setTreeData] = useState<AncestryTreeResult | null>(null);
  const [rootId, setRootId] = useState<string | null>(personId || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandingNodes, setExpandingNodes] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [pendingCenterId, setPendingCenterId] = useState<string | null>(null);

  // Refs for root-level SVG line calculations
  const parentUnitsContainerRef = useRef<HTMLDivElement>(null);
  const [rootLinePositions, setRootLinePositions] = useState<RootLinePositions>({ totalHeight: 400, unitPositions: [] });

  // Get database info to find root if no personId provided
  useEffect(() => {
    if (!personId && dbId) {
      api.getDatabase(dbId)
        .then(db => setRootId(db.rootId))
        .catch(err => setError(err.message));
    }
  }, [dbId, personId]);

  // Load ancestry tree data
  useEffect(() => {
    if (!dbId || !rootId) return;

    setLoading(true);
    setError(null);

    api.getAncestryTree(dbId, rootId, 4)
      .then(data => {
        setTreeData(data);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [dbId, rootId]);

  // Calculate line positions for root-level parent units
  useEffect(() => {
    if (!parentUnitsContainerRef.current || !treeData?.parentUnits) return;

    const calculatePositions = () => {
      const container = parentUnitsContainerRef.current;
      if (!container) return;

      const totalHeight = container.offsetHeight;
      const positions: number[] = [];

      // Get each parent unit element
      const unitElements = container.querySelectorAll('[data-parent-unit]');
      unitElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const centerY = htmlEl.offsetTop + htmlEl.offsetHeight / 2;
        positions.push(centerY);
      });

      setRootLinePositions({ totalHeight, unitPositions: positions });
    };

    // Calculate after render
    const timeoutId = setTimeout(calculatePositions, 100);

    // Recalculate on window resize
    window.addEventListener('resize', calculatePositions);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', calculatePositions);
    };
  }, [treeData]);

  // Handle expanding a node
  const handleExpand = useCallback(async (request: ExpandAncestryRequest, nodeId: string) => {
    if (!dbId || expandingNodes.has(nodeId)) return;

    setExpandingNodes(prev => new Set(prev).add(nodeId));

    const expandedData = await api.expandAncestryGeneration(dbId, request, 2).catch(err => {
      console.error('Failed to expand:', err);
      return null;
    });

    setExpandingNodes(prev => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });

    if (!expandedData || !treeData) return;

    // Update tree data with expanded node
    setTreeData(prevData => {
      if (!prevData) return prevData;

      // Deep clone the tree data
      const newData = JSON.parse(JSON.stringify(prevData)) as AncestryTreeResult;

      // Find and update the family unit that needs expansion
      const updateUnit = (units: AncestryFamilyUnit[] | undefined): boolean => {
        if (!units) return false;

        for (const unit of units) {
          // Check if this unit contains the person being expanded
          if (unit.father?.id === request.fatherId) {
            // Add to father's parent units
            if (!unit.fatherParentUnits) {
              unit.fatherParentUnits = [];
            }
            unit.fatherParentUnits.push(expandedData);

            // Update hasMoreAncestors flag
            if (unit.father) {
              unit.father.hasMoreAncestors = false;
            }
            return true;
          }

          if (unit.mother?.id === request.motherId) {
            // Add to mother's parent units
            if (!unit.motherParentUnits) {
              unit.motherParentUnits = [];
            }
            unit.motherParentUnits.push(expandedData);

            // Update hasMoreAncestors flag
            if (unit.mother) {
              unit.mother.hasMoreAncestors = false;
            }
            return true;
          }

          // Recursively check child units
          if (updateUnit(unit.fatherParentUnits)) return true;
          if (updateUnit(unit.motherParentUnits)) return true;
        }

        return false;
      };

      updateUnit(newData.parentUnits);

      return newData;
    });

    // Set the ID to center on after render
    const personIdToCenter = request.fatherId || request.motherId;
    if (personIdToCenter) {
      setPendingCenterId(personIdToCenter);
    }
  }, [dbId, expandingNodes, treeData]);

  // Setup D3 zoom behavior
  useEffect(() => {
    if (!containerRef.current || !contentRef.current) return;

    const container = d3.select(containerRef.current);
    const content = d3.select(contentRef.current);

    const zoom = d3.zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.15, 2])
      .on('zoom', (event) => {
        content.style('transform', `translate(${event.transform.x}px, ${event.transform.y}px) scale(${event.transform.k})`);
        content.style('transform-origin', '0 0');
      });

    container.call(zoom);
    zoomRef.current = zoom;

    // Set initial transform to position root at left and vertically centered
    const initialX = 80;
    const initialY = -100; // Start higher to center the tree vertically

    container.call(zoom.transform, d3.zoomIdentity.translate(initialX, initialY).scale(0.45));

    return () => {
      container.on('.zoom', null);
    };
  }, [treeData]);

  // Center on expanded node after render
  useEffect(() => {
    if (!pendingCenterId || !containerRef.current || !contentRef.current || !zoomRef.current) return;

    // Find the element with the person ID
    const personElement = contentRef.current.querySelector(`[data-person-id="${pendingCenterId}"]`);
    if (!personElement) {
      setPendingCenterId(null);
      return;
    }

    // Get positions
    const containerRect = containerRef.current.getBoundingClientRect();
    const elementRect = personElement.getBoundingClientRect();
    const contentRect = contentRef.current.getBoundingClientRect();

    // Calculate where the element is relative to content origin
    const elementX = elementRect.left - contentRect.left + elementRect.width / 2;
    const elementY = elementRect.top - contentRect.top + elementRect.height / 2;

    // Calculate transform to center this element in the container
    const targetX = containerRect.width / 2 - elementX;
    const targetY = containerRect.height / 2 - elementY;

    // Apply the transform with animation
    const containerSelection = d3.select(containerRef.current);
    containerSelection.transition()
      .duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(targetX, targetY));

    setPendingCenterId(null);
  }, [pendingCenterId, treeData]);

  // Render a list of parent units
  const renderParentUnits = (units: AncestryFamilyUnit[], depth: number): JSX.Element => {
    return (
      <div className="flex flex-col gap-4">
        {units.map((unit) => renderFamilyUnit(unit, depth))}
      </div>
    );
  };

  // Recursive component to render family units
  const renderFamilyUnit = (
    unit: AncestryFamilyUnit,
    depth: number
  ): JSX.Element => {
    const nodeId = unit.id;
    const isExpandingFather = unit.father?.id ? expandingNodes.has(`expand_${unit.father.id}`) : false;
    const isExpandingMother = unit.mother?.id ? expandingNodes.has(`expand_${unit.mother.id}`) : false;

    return (
      <div key={nodeId} className="flex items-center">
        <FamilyUnitCard
          unit={unit}
          dbId={dbId!}
          onExpandFather={
            unit.father?.hasMoreAncestors
              ? () => handleExpand({ fatherId: unit.father!.id }, `expand_${unit.father!.id}`)
              : undefined
          }
          onExpandMother={
            unit.mother?.hasMoreAncestors
              ? () => handleExpand({ motherId: unit.mother!.id }, `expand_${unit.mother!.id}`)
              : undefined
          }
          loadingFather={isExpandingFather}
          loadingMother={isExpandingMother}
          renderParentUnits={renderParentUnits}
          depth={depth}
        />
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-app-male border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-app-text-muted">Loading ancestry tree...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-app-error mb-4">Error: {error}</p>
          <Link
            to="/"
            className="px-4 py-2 bg-app-border text-app-text-secondary rounded hover:bg-app-hover"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!treeData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-app-text-muted">No tree data available</p>
        </div>
      </div>
    );
  }

  const hasParents = treeData.parentUnits && treeData.parentUnits.length > 0;
  const { totalHeight, unitPositions } = rootLinePositions;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 px-4 pt-4">
        <h1 className="text-2xl font-bold text-app-text">Ancestry Tree</h1>
        <div className="flex gap-2">
          <Link
            to={`/search/${dbId}`}
            className="px-3 py-1 bg-app-border text-app-text-secondary rounded hover:bg-app-hover text-sm"
          >
            Search
          </Link>
          <Link
            to={`/path/${dbId}`}
            className="px-3 py-1 bg-app-border text-app-text-secondary rounded hover:bg-app-hover text-sm"
          >
            Find Path
          </Link>
        </div>
      </div>

      {/* Tree container with zoom/pan */}
      <div
        ref={containerRef}
        className="flex-1 bg-tree-bg rounded-lg border border-app-border overflow-hidden cursor-grab active:cursor-grabbing"
        style={{ minHeight: '600px' }}
      >
        <div ref={contentRef} className="p-8">
          {/* Tree visualization - horizontal layout */}
          <div className="flex items-center">
            {/* Root person section */}
            <div className="flex flex-col items-start flex-shrink-0">
              <PersonCard
                person={treeData.rootPerson}
                dbId={dbId!}
              />
              {treeData.rootSpouse && (
                <div className="mt-2">
                  <PersonCard
                    person={treeData.rootSpouse}
                    dbId={dbId!}
                  />
                </div>
              )}
            </div>

            {/* Parent units with SVG connector */}
            {hasParents && (
              <div className="flex items-stretch">
                {/* SVG connector lines */}
                <svg
                  width="48"
                  height={totalHeight || 400}
                  className="flex-shrink-0"
                  style={{ minHeight: `${totalHeight || 400}px` }}
                >
                  {/* Horizontal line from root (at vertical center) */}
                  <line
                    x1="0"
                    y1={totalHeight / 2}
                    x2="24"
                    y2={totalHeight / 2}
                    stroke="var(--color-tree-line)"
                    strokeWidth="2"
                  />

                  {/* Vertical trunk line - from first unit to last unit */}
                  {unitPositions.length > 1 && (
                    <line
                      x1="24"
                      y1={unitPositions[0]}
                      x2="24"
                      y2={unitPositions[unitPositions.length - 1]}
                      stroke="var(--color-tree-line)"
                      strokeWidth="2"
                    />
                  )}

                  {/* Connect center to trunk */}
                  {unitPositions.length > 0 && (
                    <>
                      {/* If center is above the trunk top */}
                      {totalHeight / 2 < unitPositions[0] && (
                        <line
                          x1="24"
                          y1={totalHeight / 2}
                          x2="24"
                          y2={unitPositions[0]}
                          stroke="var(--color-tree-line)"
                          strokeWidth="2"
                        />
                      )}
                      {/* If center is below the trunk bottom */}
                      {unitPositions.length > 1 && totalHeight / 2 > unitPositions[unitPositions.length - 1] && (
                        <line
                          x1="24"
                          y1={unitPositions[unitPositions.length - 1]}
                          x2="24"
                          y2={totalHeight / 2}
                          stroke="var(--color-tree-line)"
                          strokeWidth="2"
                        />
                      )}
                      {/* Single unit case */}
                      {unitPositions.length === 1 && (
                        <line
                          x1="24"
                          y1={Math.min(totalHeight / 2, unitPositions[0])}
                          x2="24"
                          y2={Math.max(totalHeight / 2, unitPositions[0])}
                          stroke="var(--color-tree-line)"
                          strokeWidth="2"
                        />
                      )}
                    </>
                  )}

                  {/* Horizontal branches to each parent unit */}
                  {unitPositions.map((y, i) => (
                    <line
                      key={i}
                      x1="24"
                      y1={y}
                      x2="48"
                      y2={y}
                      stroke="var(--color-tree-line)"
                      strokeWidth="2"
                    />
                  ))}
                </svg>

                {/* Parent units container */}
                <div ref={parentUnitsContainerRef} className="flex flex-col gap-4">
                  {treeData.parentUnits!.map((unit) => (
                    <div key={unit.id} data-parent-unit className="flex items-center">
                      {renderFamilyUnit(unit, 1)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info footer */}
      <div className="px-4 py-2 text-xs text-app-text-subtle flex items-center gap-4">
        <span>Scroll to zoom • Drag to pan</span>
        <span>•</span>
        <span>Generations loaded: {treeData.maxGenerationLoaded}</span>
        <span>•</span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 border-l-2 border-app-male" /> Male
          <span className="w-3 h-3 border-l-2 border-app-female ml-2" /> Female
        </span>
      </div>
    </div>
  );
}
