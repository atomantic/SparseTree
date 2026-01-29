/**
 * Vertical Family View
 *
 * Enhanced pedigree chart with:
 * - Ancestors at TOP, root in MIDDLE/BOTTOM
 * - Generation labels
 * - Clean CSS-based connecting lines
 * - Zoom/pan support
 * - Expandable nodes
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import * as d3 from 'd3';
import type { AncestryTreeResult, AncestryFamilyUnit, ExpandAncestryRequest } from '@fsf/shared';
import { AncestorNode, RootPersonNode } from '../shared/AncestorNode';
import { TreeControls } from '../shared/TreeControls';
import { GENDER_COLORS } from '../utils/lineageColors';

interface VerticalFamilyViewProps {
  data: AncestryTreeResult;
  dbId: string;
  onExpand?: (request: ExpandAncestryRequest, nodeId: string) => Promise<void>;
  expandingNodes?: Set<string>;
}

export function VerticalFamilyView({
  data,
  dbId,
  onExpand,
  expandingNodes = new Set()
}: VerticalFamilyViewProps) {
  const [generations, setGenerations] = useState(4);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [pendingCenterId, setPendingCenterId] = useState<string | null>(null);

  // Handle expansion
  const handleExpand = useCallback(async (personId: string, isFather: boolean) => {
    if (!onExpand) return;
    const request: ExpandAncestryRequest = isFather
      ? { fatherId: personId }
      : { motherId: personId };
    await onExpand(request, `expand_${personId}`);
    setPendingCenterId(personId);
  }, [onExpand]);
  // Recursive node component
  const VerticalPedigreeNode = ({ 
    person, 
    parentUnits, 
    lineage, 
    generation,
    isRoot = false 
  }: { 
    person: any, 
    parentUnits?: AncestryFamilyUnit[], 
    lineage?: 'paternal' | 'maternal', 
    generation: number,
    isRoot?: boolean
  }) => {
    if (generation > generations) return null;

    // Find the biological parent unit
    const primaryUnit = parentUnits && parentUnits.length > 0 ? parentUnits[0] : null;
    const hasFather = primaryUnit?.father;
    const hasMother = primaryUnit?.mother;
    const hasParents = hasFather || hasMother;
    
    // Connector styles
    const lineColor = "var(--color-tree-line)";
    const lineWidth = "2px";
    
    return (
      <div className="flex flex-col items-center">
        {/* Parents & Connectors (Rendered ABOVE the person) */}
        {!isRoot && hasParents && generation < generations && (
          <>
            <div className="flex">
              {/* Father Side */}
              {hasFather ? (
                <div className="flex flex-col items-center">
                  <VerticalPedigreeNode 
                    person={primaryUnit!.father} 
                    parentUnits={primaryUnit!.fatherParentUnits}
                    lineage="paternal"
                    generation={generation + 1}
                  />
                  {/* Connector: Down and Right (towards center) */}
                  <div className="w-full h-6 flex">
                    <div className="w-1/2"></div>
                    <div className="w-1/2 rounded-bl-lg border-l-2 border-b-2" style={{ borderColor: lineColor, borderWidth: lineWidth }}></div>
                  </div>
                </div>
              ) : hasMother ? (
                 // Placeholder to balance single mother? Or just let flex handle it?
                 // For proper spacing, we might need an empty block if we want to enforce structure, 
                 // but standard trees usually just center the single parent.
                 // Let's stick to simple "if father" logic.
                 <div className="hidden" />
              ) : null}
              
              {/* Mother Side */}
              {hasMother ? (
                <div className="flex flex-col items-center">
                  <VerticalPedigreeNode 
                    person={primaryUnit!.mother} 
                    parentUnits={primaryUnit!.motherParentUnits}
                    lineage="maternal"
                    generation={generation + 1}
                  />
                  {/* Connector: Down and Left (towards center) */}
                  <div className="w-full h-6 flex">
                    <div className="w-1/2 rounded-br-lg border-r-2 border-b-2" style={{ borderColor: lineColor, borderWidth: lineWidth }}></div>
                    <div className="w-1/2"></div>
                  </div>
                </div>
              ) : hasFather ? (
                <div className="hidden" />
              ) : null}
            </div>

            {/* Stem to Child */}
            <div className="h-6 w-px bg-tree-line" style={{ width: lineWidth, backgroundColor: lineColor }}></div>
          </>
        )}

        {/* Person Card */}
        <div className="p-2">
          {isRoot ? (
            <RootPersonNode person={person} dbId={dbId} />
          ) : (
            <AncestorNode
              person={person}
              dbId={dbId}
              size="md"
              onExpand={
                person.hasMoreAncestors && onExpand && !hasParents
                  ? () => handleExpand(person.id, lineage === 'paternal')
                  : undefined
              }
              isExpanding={expandingNodes.has(`expand_${person.id}`)}
              expandDirection="up"
              lineage={lineage}
              generation={generation}
              useLineageColors
            />
          )}
        </div>
      </div>
    );
  };

  // Setup D3 zoom
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const containerSelection = d3.select(container);
    const contentSelection = d3.select(content);

    const zoom = d3.zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.25, 2])
      .on('zoom', (event) => {
        const { x, y, k } = event.transform;
        contentSelection.style('transform', `translate(${x}px, ${y}px) scale(${k})`);
        contentSelection.style('transform-origin', '50% 50%'); // Center zoom
        setCurrentZoom(k);
      });

    containerSelection.call(zoom);
    zoomRef.current = zoom;

    // Center content initially
    const centerTree = () => {
      if (!container || !content || !zoomRef.current) return;
      const containerRect = container.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();

      const scale = Math.min(
        (containerRect.width - 80) / contentRect.width,
        (containerRect.height - 80) / contentRect.height,
        1
      );
      const finalScale = Math.max(0.4, Math.min(scale, 1));

      // Center vertically and horizontally
      const x = (containerRect.width - contentRect.width * finalScale) / 2;
      
      // For vertical tree, we often want to focus on the root (bottom) or center
      // Let's center it.
      const y = (containerRect.height - contentRect.height * finalScale) / 2;

      containerSelection.call(
        zoomRef.current.transform, 
        d3.zoomIdentity.translate(x, y).scale(finalScale)
      );
    };

    const resizeObserver = new ResizeObserver(centerTree);
    resizeObserver.observe(container);
    
    // Slight delay to ensure render
    setTimeout(centerTree, 50);

    return () => {
      containerSelection.on('.zoom', null);
      resizeObserver.disconnect();
    };
  }, [data, generations]);

  // Center on expanded node
  useEffect(() => {
    if (!pendingCenterId || !containerRef.current || !contentRef.current || !zoomRef.current) return;
    
    // TODO: Implement centering on specific node for vertical view
    // For now, we just clear the pending ID
    setPendingCenterId(null);
  }, [pendingCenterId]);

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
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || !zoomRef.current) return;

    const containerRect = container.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const x = (containerRect.width - contentRect.width * currentZoom) / 2;
    const y = (containerRect.height - contentRect.height * currentZoom) / 2;

    d3.select(container).transition().duration(300).call(
      zoomRef.current.transform, 
      d3.zoomIdentity.translate(x, y).scale(currentZoom)
    );
  }, [currentZoom]);

  return (
    <div className="h-full flex flex-col bg-app-bg">
      {/* Controls */}
      <div className="px-4 py-2 bg-app-card border-b border-app-border flex items-center justify-between">
        <div className="text-sm text-app-text-muted">
          {data.rootPerson.name} &mdash; Vertical Family View
        </div>
        <TreeControls
          generations={generations}
          onGenerationsChange={setGenerations}
          minGenerations={2}
          maxGenerations={Math.min(6, data.maxGenerationLoaded)}
          maxGenerationsLoaded={data.maxGenerationLoaded}
          currentZoom={currentZoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
        />
      </div>

      {/* Chart area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-tree-bg cursor-grab active:cursor-grabbing"
      >
        <div ref={contentRef} className="p-8 inline-block min-w-min">
          <div className="flex">
             {/* Left Labels Column (Sticky-ish?) */}
             {/* Note: Aligning labels to flex-sized nodes is tricky without a grid. 
                 We'll try to rely on consistent node heights + connector heights. 
                 Or we can position them absolutely if we knew the heights.
                 For now, let's omit the side labels in favor of the cleaner tree, 
                 or render them as a separate overlay. 
             */}
            
            {/* Tree Container */}
            <div className="flex justify-center">
              <VerticalPedigreeNode 
                person={data.rootPerson} 
                parentUnits={data.parentUnits} 
                generation={1} 
                isRoot={true}
              />
            </div>
          </div>
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
        <span>Scroll to zoom | Drag to pan</span>
      </div>
    </div>
  );
}
