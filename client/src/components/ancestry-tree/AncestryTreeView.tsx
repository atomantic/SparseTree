/**
 * Ancestry Tree View
 *
 * Main tree view component with multiple visualization modes:
 * - Focus: Navigate one person at a time with breadcrumb trail
 * - Pedigree: Classic vertical tree chart
 * - Columns: Horizontal generational columns
 * - Classic: Original SVG-based horizontal tree with zoom/pan
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import * as d3 from 'd3';
import type { AncestryTreeResult, AncestryFamilyUnit, ExpandAncestryRequest } from '@fsf/shared';
import { api } from '../../services/api';
import { PersonCard } from './PersonCard';
import { FamilyUnitCard } from './FamilyUnitCard';
import { FocusNavigatorView } from './views/FocusNavigatorView';
import { PedigreeChartView } from './views/PedigreeChartView';
import { GenerationalColumnsView } from './views/GenerationalColumnsView';

type ViewMode = 'focus' | 'pedigree' | 'columns' | 'classic';

const VIEW_MODES: { id: ViewMode; label: string; icon: string; description: string }[] = [
  { id: 'focus', label: 'Focus', icon: '\u{1F3AF}', description: 'Navigate one person at a time' },
  { id: 'pedigree', label: 'Pedigree', icon: '\u{1F333}', description: 'Classic family tree chart' },
  { id: 'columns', label: 'Columns', icon: '\u{1F4CA}', description: 'Generations in columns' },
  { id: 'classic', label: 'Classic', icon: '\u{1F4D0}', description: 'Original SVG tree view' },
];

interface RootLinePositions {
  totalHeight: number;
  unitPositions: number[];
}

export function AncestryTreeView() {
  const { dbId, personId } = useParams<{ dbId: string; personId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [treeData, setTreeData] = useState<AncestryTreeResult | null>(null);
  const [rootId, setRootId] = useState<string | null>(personId || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandingNodes, setExpandingNodes] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [pendingCenterId, setPendingCenterId] = useState<string | null>(null);
  const parentUnitsContainerRef = useRef<HTMLDivElement>(null);
  const [rootLinePositions, setRootLinePositions] = useState<RootLinePositions>({ totalHeight: 400, unitPositions: [] });

  const viewMode = (searchParams.get('view') as ViewMode) || 'focus';

  const setViewMode = (mode: ViewMode) => {
    setSearchParams({ view: mode });
  };

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

    // Load more generations - columns view benefits from more data
    const generations = viewMode === 'columns' ? 10 : viewMode === 'classic' ? 4 : 8;

    api.getAncestryTree(dbId, rootId, generations)
      .then(data => setTreeData(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [dbId, rootId, viewMode]);

  // Calculate line positions for root-level parent units (classic view)
  useEffect(() => {
    if (viewMode !== 'classic' || !parentUnitsContainerRef.current || !treeData?.parentUnits) return;

    const calculatePositions = () => {
      const container = parentUnitsContainerRef.current;
      if (!container) return;

      const totalHeight = container.offsetHeight;
      const positions: number[] = [];

      const unitElements = container.querySelectorAll('[data-parent-unit]');
      unitElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const centerY = htmlEl.offsetTop + htmlEl.offsetHeight / 2;
        positions.push(centerY);
      });

      setRootLinePositions({ totalHeight, unitPositions: positions });
    };

    const timeoutId = setTimeout(calculatePositions, 100);
    window.addEventListener('resize', calculatePositions);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', calculatePositions);
    };
  }, [treeData, viewMode]);

  // Handle expanding a node (classic view)
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

    setTreeData(prevData => {
      if (!prevData) return prevData;

      const newData = JSON.parse(JSON.stringify(prevData)) as AncestryTreeResult;

      const updateUnit = (units: AncestryFamilyUnit[] | undefined): boolean => {
        if (!units) return false;

        for (const unit of units) {
          if (unit.father?.id === request.fatherId) {
            if (!unit.fatherParentUnits) unit.fatherParentUnits = [];
            unit.fatherParentUnits.push(expandedData);
            if (unit.father) unit.father.hasMoreAncestors = false;
            return true;
          }

          if (unit.mother?.id === request.motherId) {
            if (!unit.motherParentUnits) unit.motherParentUnits = [];
            unit.motherParentUnits.push(expandedData);
            if (unit.mother) unit.mother.hasMoreAncestors = false;
            return true;
          }

          if (updateUnit(unit.fatherParentUnits)) return true;
          if (updateUnit(unit.motherParentUnits)) return true;
        }

        return false;
      };

      updateUnit(newData.parentUnits);
      return newData;
    });

    const personIdToCenter = request.fatherId || request.motherId;
    if (personIdToCenter) setPendingCenterId(personIdToCenter);
  }, [dbId, expandingNodes, treeData]);

  // Setup D3 zoom behavior (classic view)
  useEffect(() => {
    if (viewMode !== 'classic' || !containerRef.current || !contentRef.current) return;

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

    const initialX = 80;
    const initialY = -100;
    container.call(zoom.transform, d3.zoomIdentity.translate(initialX, initialY).scale(0.45));

    return () => {
      container.on('.zoom', null);
    };
  }, [treeData, viewMode]);

  // Center on expanded node after render (classic view)
  useEffect(() => {
    if (!pendingCenterId || !containerRef.current || !contentRef.current || !zoomRef.current) return;

    const personElement = contentRef.current.querySelector(`[data-person-id="${pendingCenterId}"]`);
    if (!personElement) {
      setPendingCenterId(null);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const elementRect = personElement.getBoundingClientRect();
    const contentRect = contentRef.current.getBoundingClientRect();

    const elementX = elementRect.left - contentRect.left + elementRect.width / 2;
    const elementY = elementRect.top - contentRect.top + elementRect.height / 2;

    const targetX = containerRect.width / 2 - elementX;
    const targetY = containerRect.height / 2 - elementY;

    const containerSelection = d3.select(containerRef.current);
    containerSelection.transition()
      .duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(targetX, targetY));

    setPendingCenterId(null);
  }, [pendingCenterId, treeData]);

  // Render functions for classic view
  const renderParentUnits = (units: AncestryFamilyUnit[], depth: number): JSX.Element => {
    return (
      <div className="flex flex-col gap-4">
        {units.map((unit) => renderFamilyUnit(unit, depth))}
      </div>
    );
  };

  const renderFamilyUnit = (unit: AncestryFamilyUnit, depth: number): JSX.Element => {
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

  // Loading state
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

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-app-error mb-4">Error: {error}</p>
          <Link to="/" className="px-4 py-2 bg-app-border text-app-text-secondary rounded hover:bg-app-hover">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // No data state
  if (!treeData) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-app-text-muted">No tree data available</p>
      </div>
    );
  }

  const hasParents = treeData.parentUnits && treeData.parentUnits.length > 0;
  const { totalHeight, unitPositions } = rootLinePositions;

  return (
    <div className="h-full flex flex-col">
      {/* Header with view switcher */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border bg-app-card">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-app-text">Ancestry Tree</h1>
          <span className="text-sm text-app-text-muted">{treeData.rootPerson.name}</span>
        </div>

        {/* View mode switcher */}
        <div className="flex items-center gap-1 bg-app-bg rounded-lg p-1">
          {VIEW_MODES.map(mode => (
            <button
              key={mode.id}
              onClick={() => setViewMode(mode.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                viewMode === mode.id
                  ? 'bg-app-card text-app-text shadow-sm'
                  : 'text-app-text-muted hover:text-app-text hover:bg-app-card/50'
              }`}
              title={mode.description}
            >
              <span>{mode.icon}</span>
              <span className="hidden sm:inline">{mode.label}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Link to={`/search/${dbId}`} className="px-3 py-1 bg-app-border text-app-text-secondary rounded hover:bg-app-hover text-sm">
            Search
          </Link>
          <Link to={`/path/${dbId}`} className="px-3 py-1 bg-app-border text-app-text-secondary rounded hover:bg-app-hover text-sm">
            Find Path
          </Link>
        </div>
      </div>

      {/* View content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'focus' && (
          <FocusNavigatorView data={treeData} dbId={dbId!} />
        )}

        {viewMode === 'pedigree' && (
          <PedigreeChartView data={treeData} dbId={dbId!} />
        )}

        {viewMode === 'columns' && (
          <GenerationalColumnsView
            data={treeData}
            dbId={dbId!}
            onLoadMore={async (newDepth: number) => {
              if (!dbId || !rootId) return;
              setLoading(true);
              const data = await api.getAncestryTree(dbId, rootId, newDepth).catch(err => {
                console.error('Failed to load more generations:', err);
                return null;
              });
              if (data) setTreeData(data);
              setLoading(false);
            }}
          />
        )}

        {viewMode === 'classic' && (
          <div className="h-full flex flex-col">
            {/* Classic tree container with zoom/pan */}
            <div
              ref={containerRef}
              className="flex-1 bg-tree-bg rounded-lg border border-app-border overflow-hidden cursor-grab active:cursor-grabbing m-4"
              style={{ minHeight: '600px' }}
            >
              <div ref={contentRef} className="p-8">
                <div className="flex items-center">
                  {/* Root person section */}
                  <div className="flex flex-col items-start flex-shrink-0">
                    <PersonCard person={treeData.rootPerson} dbId={dbId!} />
                    {treeData.rootSpouse && (
                      <div className="mt-2">
                        <PersonCard person={treeData.rootSpouse} dbId={dbId!} />
                      </div>
                    )}
                  </div>

                  {/* Parent units with SVG connector */}
                  {hasParents && (
                    <div className="flex items-stretch">
                      <svg
                        width="48"
                        height={totalHeight || 400}
                        className="flex-shrink-0"
                        style={{ minHeight: `${totalHeight || 400}px` }}
                      >
                        <line x1="0" y1={totalHeight / 2} x2="24" y2={totalHeight / 2} stroke="var(--color-tree-line)" strokeWidth="2" />

                        {unitPositions.length > 1 && (
                          <line x1="24" y1={unitPositions[0]} x2="24" y2={unitPositions[unitPositions.length - 1]} stroke="var(--color-tree-line)" strokeWidth="2" />
                        )}

                        {unitPositions.length > 0 && (
                          <>
                            {totalHeight / 2 < unitPositions[0] && (
                              <line x1="24" y1={totalHeight / 2} x2="24" y2={unitPositions[0]} stroke="var(--color-tree-line)" strokeWidth="2" />
                            )}
                            {unitPositions.length > 1 && totalHeight / 2 > unitPositions[unitPositions.length - 1] && (
                              <line x1="24" y1={unitPositions[unitPositions.length - 1]} x2="24" y2={totalHeight / 2} stroke="var(--color-tree-line)" strokeWidth="2" />
                            )}
                            {unitPositions.length === 1 && (
                              <line x1="24" y1={Math.min(totalHeight / 2, unitPositions[0])} x2="24" y2={Math.max(totalHeight / 2, unitPositions[0])} stroke="var(--color-tree-line)" strokeWidth="2" />
                            )}
                          </>
                        )}

                        {unitPositions.map((y, i) => (
                          <line key={i} x1="24" y1={y} x2="48" y2={y} stroke="var(--color-tree-line)" strokeWidth="2" />
                        ))}
                      </svg>

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

            {/* Classic view footer */}
            <div className="px-4 py-2 text-xs text-app-text-subtle flex items-center gap-4">
              <span>Scroll to zoom | Drag to pan</span>
              <span>|</span>
              <span>Generations loaded: {treeData.maxGenerationLoaded}</span>
              <span>|</span>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-l-2 border-app-male" /> Male
                <span className="w-3 h-3 border-l-2 border-app-female ml-2" /> Female
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
