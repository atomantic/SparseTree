/**
 * Horizontal Pedigree View
 *
 * Ancestry.com-style horizontal pedigree with root on the left
 * and ancestors flowing to the right. Features:
 * - DOM-based cards with SVG connector lines
 * - Expandable nodes for loading more ancestors
 * - Zoom/pan navigation
 * - Spouse display below root
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { AncestryTreeResult, AncestryFamilyUnit, ExpandAncestryRequest } from '@fsf/shared';
import { AncestorNode, RootPersonNode } from '../shared/AncestorNode';
import { TreeControls } from '../shared/TreeControls';

interface HorizontalPedigreeViewProps {
  data: AncestryTreeResult;
  dbId: string;
  onExpand?: (request: ExpandAncestryRequest, nodeId: string) => Promise<void>;
  expandingNodes?: Set<string>;
}

export function HorizontalPedigreeView({
  data,
  dbId,
  onExpand,
  expandingNodes = new Set(),
}: HorizontalPedigreeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [currentZoom, setCurrentZoom] = useState(0.7);
  const [generations, setGenerations] = useState(4);
  const [pendingCenterId, setPendingCenterId] = useState<string | null>(null);

  // Calculate dynamic centering based on content size
  const centerTree = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || !zoomRef.current) return;

    const containerRect = container.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();

    // Calculate scale to fit (with some padding)
    const scaleX = (containerRect.width - 80) / contentRect.width;
    const scaleY = (containerRect.height - 80) / contentRect.height;
    const scale = Math.min(scaleX, scaleY, 1);
    const finalScale = Math.max(0.3, Math.min(scale, 0.9));

    // Center the content
    const scaledWidth = contentRect.width * finalScale;
    const scaledHeight = contentRect.height * finalScale;
    const x = (containerRect.width - scaledWidth) / 2;
    const y = (containerRect.height - scaledHeight) / 2;

    const containerSelection = d3.select(container);
    containerSelection
      .transition()
      .duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(x, y).scale(finalScale));
  }, []);

  // Setup D3 zoom behavior
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const containerSelection = d3.select(container);
    const contentSelection = d3.select(content);

    const zoom = d3.zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.15, 2])
      .on('zoom', (event) => {
        const { x, y, k } = event.transform;
        contentSelection.style(
          'transform',
          `translate(${x}px, ${y}px) scale(${k})`
        );
        contentSelection.style('transform-origin', '0 0');
        setCurrentZoom(k);
      });

    containerSelection.call(zoom);
    zoomRef.current = zoom;

    // Use ResizeObserver for dynamic centering
    const resizeObserver = new ResizeObserver(() => {
      centerTree();
    });
    resizeObserver.observe(container);

    // Initial centering after content renders
    requestAnimationFrame(() => {
      centerTree();
    });

    return () => {
      containerSelection.on('.zoom', null);
      resizeObserver.disconnect();
    };
  }, [data, centerTree]);

  // Center on expanded node after render
  useEffect(() => {
    if (!pendingCenterId || !containerRef.current || !contentRef.current || !zoomRef.current) return;

    const personElement = contentRef.current.querySelector(`[data-person-id="${pendingCenterId}"]`);
    if (!personElement) {
      setPendingCenterId(null);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const contentRect = contentRef.current.getBoundingClientRect();
    const elementRect = personElement.getBoundingClientRect();

    const elementX = (elementRect.left - contentRect.left) / currentZoom + elementRect.width / (2 * currentZoom);
    const elementY = (elementRect.top - contentRect.top) / currentZoom + elementRect.height / (2 * currentZoom);

    const targetX = containerRect.width / 2 - elementX * currentZoom;
    const targetY = containerRect.height / 2 - elementY * currentZoom;

    const containerSelection = d3.select(containerRef.current);
    containerSelection
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(targetX, targetY).scale(currentZoom));

    setPendingCenterId(null);
  }, [pendingCenterId, currentZoom]);

  // Handle expansion
  const handleExpand = useCallback(async (personId: string, isFather: boolean) => {
    if (!onExpand) return;
    const request: ExpandAncestryRequest = isFather
      ? { fatherId: personId }
      : { motherId: personId };
    await onExpand(request, `expand_${personId}`);
    setPendingCenterId(personId);
  }, [onExpand]);

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

  const handleResetZoom = useCallback(() => {
    centerTree();
  }, [centerTree]);

  // Render a family unit recursively
  const renderFamilyUnit = (unit: AncestryFamilyUnit, depth: number): JSX.Element => {
    if (depth > generations) return <></>;

    const hasFatherParents = unit.fatherParentUnits && unit.fatherParentUnits.length > 0;
    const hasMotherParents = unit.motherParentUnits && unit.motherParentUnits.length > 0;

    return (
      <div key={unit.id} className="flex items-center">
        {/* Parent cards (father and mother stacked vertically) */}
        <div className="flex flex-col gap-2">
          {unit.father && (
            <AncestorNode
              person={unit.father}
              dbId={dbId}
              size="sm"
              onExpand={
                unit.father.hasMoreAncestors && onExpand && !hasFatherParents
                  ? () => handleExpand(unit.father!.id, true)
                  : undefined
              }
              isExpanding={expandingNodes.has(`expand_${unit.father.id}`)}
              lineage="paternal"
              generation={depth}
              useLineageColors
            />
          )}
          {unit.mother && (
            <AncestorNode
              person={unit.mother}
              dbId={dbId}
              size="sm"
              onExpand={
                unit.mother.hasMoreAncestors && onExpand && !hasMotherParents
                  ? () => handleExpand(unit.mother!.id, false)
                  : undefined
              }
              isExpanding={expandingNodes.has(`expand_${unit.mother.id}`)}
              lineage="maternal"
              generation={depth}
              useLineageColors
            />
          )}
        </div>

        {/* Connector lines and child parent units */}
        {(hasFatherParents || hasMotherParents) && (
          <div className="flex items-center">
            {/* SVG connector */}
            <svg width="48" height="200" className="flex-shrink-0">
              {/* Horizontal line from cards */}
              <line x1="0" y1="100" x2="24" y2="100" stroke="var(--color-tree-line)" strokeWidth="2" />
              {/* Vertical trunk */}
              {hasFatherParents && hasMotherParents && (
                <line x1="24" y1="50" x2="24" y2="150" stroke="var(--color-tree-line)" strokeWidth="2" />
              )}
              {/* Branch to father's parents */}
              {hasFatherParents && (
                <>
                  <line x1="24" y1="50" x2="48" y2="50" stroke="var(--color-tree-line)" strokeWidth="2" />
                  {!hasMotherParents && (
                    <line x1="24" y1="50" x2="24" y2="100" stroke="var(--color-tree-line)" strokeWidth="2" />
                  )}
                </>
              )}
              {/* Branch to mother's parents */}
              {hasMotherParents && (
                <>
                  <line x1="24" y1="150" x2="48" y2="150" stroke="var(--color-tree-line)" strokeWidth="2" />
                  {!hasFatherParents && (
                    <line x1="24" y1="100" x2="24" y2="150" stroke="var(--color-tree-line)" strokeWidth="2" />
                  )}
                </>
              )}
            </svg>

            {/* Parent units container */}
            <div className="flex flex-col gap-4">
              {hasFatherParents && (
                <div className="flex items-center">
                  {unit.fatherParentUnits!.map(pu => renderFamilyUnit(pu, depth + 1))}
                </div>
              )}
              {hasMotherParents && (
                <div className="flex items-center">
                  {unit.motherParentUnits!.map(pu => renderFamilyUnit(pu, depth + 1))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const hasParents = data.parentUnits && data.parentUnits.length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Controls header */}
      <div className="flex items-center justify-between px-4 py-2 bg-app-card border-b border-app-border">
        <div className="text-sm text-app-text-muted">
          {data.rootPerson.name} &mdash; Horizontal Pedigree
        </div>
        <TreeControls
          generations={generations}
          onGenerationsChange={setGenerations}
          minGenerations={2}
          maxGenerations={Math.min(8, data.maxGenerationLoaded)}
          maxGenerationsLoaded={data.maxGenerationLoaded}
          currentZoom={currentZoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
        />
      </div>

      {/* Tree canvas */}
      <div
        ref={containerRef}
        className="flex-1 bg-tree-bg overflow-hidden cursor-grab active:cursor-grabbing"
      >
        <div ref={contentRef} className="p-8 inline-block">
          <div className="flex items-center">
            {/* Root section (root person and optional spouse) */}
            <div className="flex flex-col gap-2">
              <RootPersonNode person={data.rootPerson} dbId={dbId} />
              {data.rootSpouse && (
                <AncestorNode
                  person={data.rootSpouse}
                  dbId={dbId}
                  size="md"
                  variant="card"
                />
              )}
            </div>

            {/* Connector to parents */}
            {hasParents && (
              <div className="flex items-center">
                <svg width="48" height="100" className="flex-shrink-0">
                  <line x1="0" y1="50" x2="48" y2="50" stroke="var(--color-tree-line)" strokeWidth="2" />
                </svg>

                {/* Parent units */}
                <div className="flex flex-col gap-4">
                  {data.parentUnits!.map(unit => renderFamilyUnit(unit, 1))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer legend */}
      <div className="px-4 py-2 bg-app-card border-t border-app-border text-xs text-app-text-muted flex items-center gap-4">
        <span>Scroll to zoom | Drag to pan</span>
        <span>|</span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: 'var(--color-male)' }} /> Male
          <span className="w-3 h-3 rounded ml-2" style={{ backgroundColor: 'var(--color-female)' }} /> Female
        </span>
        <span>|</span>
        <span>Generations loaded: {data.maxGenerationLoaded}</span>
      </div>
    </div>
  );
}
