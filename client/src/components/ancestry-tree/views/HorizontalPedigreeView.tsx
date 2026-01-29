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

  // Recursive node component with CSS-based connectors
  const PedigreeNode = ({ 
    person, 
    parentUnits, 
    lineage, 
    generation, 
    isFirst = false, 
    isLast = false,
    isRoot = false
  }: { 
    person: any, 
    parentUnits?: AncestryFamilyUnit[], 
    lineage?: 'paternal' | 'maternal', 
    generation: number,
    isFirst?: boolean,
    isLast?: boolean,
    isRoot?: boolean
  }) => {
    // Find the biological parent unit (usually the first one)
    const primaryUnit = parentUnits && parentUnits.length > 0 ? parentUnits[0] : null;
    const hasFather = primaryUnit?.father;
    const hasMother = primaryUnit?.mother;
    const hasParents = hasFather || hasMother;
    
    // Connector styles
    const lineColor = "var(--color-tree-line)";
    const lineWidth = "2px";
    
    return (
      <div className="flex">
        {/* Connector from child (if not root) */}
        {!isRoot && (
          <div className="w-6 relative flex-shrink-0">
            {/* Horizontal line to card */}
            <div 
              className="absolute w-full top-1/2" 
              style={{ height: lineWidth, backgroundColor: lineColor, transform: 'translateY(-50%)' }} 
            />
            {/* Vertical connector line (bracket) */}
            <div 
              className="absolute left-0 w-px"
              style={{ 
                width: lineWidth, 
                backgroundColor: lineColor,
                // If first, line goes from bottom to center (50%)
                // If last, line goes from top to center (50%)
                // If middle (not supported here yet), full height
                top: isLast ? 0 : '50%',
                height: '50%',
                display: (isFirst && isLast) ? 'none' : 'block' // Hide if only child
              }} 
            />
          </div>
        )}

        {/* Content Wrapper (Card + Next Connector) */}
        <div className="flex items-center">
          {/* Person Card */}
          <div className="py-1">
            <AncestorNode
              person={person}
              dbId={dbId}
              size="sm"
              onExpand={
                person.hasMoreAncestors && onExpand && !hasParents
                  ? () => handleExpand(person.id, lineage === 'paternal')
                  : undefined
              }
              isExpanding={expandingNodes.has(`expand_${person.id}`)}
              lineage={lineage}
              generation={generation}
              useLineageColors
            />
          </div>

          {/* Connector to parents and Parent Branches */}
          {hasParents && (
            <div className="flex items-center">
              {/* Horizontal line leaving card */}
              <div 
                className="w-6 flex-shrink-0" 
                style={{ height: lineWidth, backgroundColor: lineColor }} 
              />
              
              {/* Parent Branches Container */}
              <div className="flex flex-col justify-center">
                {/* Father Branch */}
                {hasFather && (
                  <PedigreeNode 
                    person={primaryUnit!.father} 
                    parentUnits={primaryUnit!.fatherParentUnits}
                    lineage="paternal"
                    generation={generation + 1}
                    isFirst={true}
                    isLast={!hasMother}
                  />
                )}
                
                {/* Mother Branch */}
                {hasMother && (
                  <PedigreeNode 
                    person={primaryUnit!.mother} 
                    parentUnits={primaryUnit!.motherParentUnits}
                    lineage="maternal"
                    generation={generation + 1}
                    isFirst={!hasFather}
                    isLast={true}
                  />
                )}
              </div>
            </div>
          )}
        </div>
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
        <div ref={contentRef} className="p-8 inline-block min-w-min min-h-min">
          <div className="flex items-center">
            {/* Root Person */}
            <div className="py-1">
               <RootPersonNode person={data.rootPerson} dbId={dbId} />
            </div>

            {/* Parents Connector */}
            {hasParents && (
               <div className="flex items-center">
                 {/* Horizontal line from Root */}
                 <div 
                   className="w-6 flex-shrink-0" 
                   style={{ height: '2px', backgroundColor: 'var(--color-tree-line)' }} 
                 />
                 
                 {/* Parents Branches */}
                 <div className="flex flex-col justify-center">
                    {data.parentUnits![0].father && (
                      <PedigreeNode 
                        person={data.parentUnits![0].father}
                        parentUnits={data.parentUnits![0].fatherParentUnits}
                        lineage="paternal"
                        generation={1}
                        isFirst={true}
                        isLast={!data.parentUnits![0].mother}
                      />
                    )}
                    {data.parentUnits![0].mother && (
                      <PedigreeNode 
                        person={data.parentUnits![0].mother}
                        parentUnits={data.parentUnits![0].motherParentUnits}
                        lineage="maternal"
                        generation={1}
                        isFirst={!data.parentUnits![0].father}
                        isLast={true}
                      />
                    )}
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
