/**
 * Fan Chart View
 *
 * A radial pedigree chart showing ancestors in concentric arcs.
 * Features:
 * - Root person at center
 * - Ancestors in colored wedges radiating outward
 * - Paternal line in cool colors (blue/teal)
 * - Maternal line in warm colors (red/coral)
 * - Text labels rotated to follow arc angle
 * - Zoom/pan navigation
 */
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import * as d3 from 'd3';
import type { AncestryTreeResult, AncestryPersonCard, AncestryFamilyUnit } from '@fsf/shared';
import { TreeControls } from '../shared/TreeControls';
import {
  generateFanChartArcs,
  getTextRotation,
  calculateFontSize,
  truncateNameForArc,
  type FanChartConfig,
  type ArcData,
} from '../utils/arcGenerator';
import {
  getLineageFromAhnentafel,
  getLineageColor,
  GENDER_COLORS,
} from '../utils/lineageColors';

interface FanChartViewProps {
  data: AncestryTreeResult;
  dbId: string;
}

/**
 * Build a flat map of ancestors by ahnentafel number
 */
function buildAncestorMap(data: AncestryTreeResult): Map<number, AncestryPersonCard> {
  const map = new Map<number, AncestryPersonCard>();

  // Root person is always ahnentafel 1
  map.set(1, data.rootPerson);

  // Recursively process parent units
  function processUnit(unit: AncestryFamilyUnit, parentAhnentafel: number): void {
    if (unit.father) {
      const fatherAhn = parentAhnentafel * 2;
      map.set(fatherAhn, unit.father);
      if (unit.fatherParentUnits) {
        for (const pu of unit.fatherParentUnits) {
          processUnit(pu, fatherAhn);
        }
      }
    }

    if (unit.mother) {
      const motherAhn = parentAhnentafel * 2 + 1;
      map.set(motherAhn, unit.mother);
      if (unit.motherParentUnits) {
        for (const pu of unit.motherParentUnits) {
          processUnit(pu, motherAhn);
        }
      }
    }
  }

  if (data.parentUnits) {
    for (const unit of data.parentUnits) {
      processUnit(unit, 1);
    }
  }

  return map;
}

export function FanChartView({ data, dbId }: FanChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [generations, setGenerations] = useState(5);
  const [hoveredAhn, setHoveredAhn] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Build ancestor lookup map
  const ancestorMap = useMemo(() => buildAncestorMap(data), [data]);

  // Fan chart configuration based on container dimensions
  const config = useMemo((): FanChartConfig => {
    const centerX = dimensions.width / 2;
    const centerY = dimensions.height - 60;  // Semi-circle, so center near bottom
    const maxRadius = Math.min(dimensions.width / 2 - 40, dimensions.height - 100);
    const innerRadius = Math.min(60, maxRadius / 6);
    const generationWidth = Math.max(40, (maxRadius - innerRadius) / (generations + 0.5));

    return {
      centerX,
      centerY,
      innerRadius,
      generationWidth,
      startAngle: 180,  // Left side
      endAngle: 360,    // Right side (semi-circle facing up)
      gap: 0.8,
    };
  }, [dimensions, generations]);

  // Generate arc data for all positions
  const arcs = useMemo(() => {
    return generateFanChartArcs(generations, config);
  }, [generations, config]);

  // Update dimensions on resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateDimensions = () => {
      const rect = container.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  // Setup D3 zoom behavior
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const svgSelection = d3.select(svg);
    const g = svgSelection.select('g.zoom-group');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString());
        setCurrentZoom(event.transform.k);
      });

    svgSelection.call(zoom);
    zoomRef.current = zoom;

    // Center the view initially
    const initialTransform = d3.zoomIdentity
      .translate(0, 0)
      .scale(0.9);
    svgSelection.call(zoom.transform, initialTransform);

    return () => {
      svgSelection.on('.zoom', null);
    };
  }, [dimensions]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    d3.select(svg).transition().duration(200).call(zoomRef.current.scaleBy, 1.3);
  }, []);

  const handleZoomOut = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    d3.select(svg).transition().duration(200).call(zoomRef.current.scaleBy, 0.7);
  }, []);

  const handleResetZoom = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    const transform = d3.zoomIdentity.translate(0, 0).scale(0.9);
    d3.select(svg).transition().duration(300).call(zoomRef.current.transform, transform);
  }, []);

  // Render an arc segment
  const renderArc = (arc: ArcData) => {
    const person = ancestorMap.get(arc.ahnentafel);
    const isHovered = hoveredAhn === arc.ahnentafel;

    // Get color based on person presence and lineage
    let fillColor = arc.color;
    let opacity = person ? 1 : 0.3;

    if (isHovered && person) {
      opacity = 1;
      fillColor = person.gender === 'male' ? GENDER_COLORS.male.border : GENDER_COLORS.female.border;
    }

    // Calculate text properties
    const textAngle = getTextRotation(arc.centroid.angle);
    const fontSize = calculateFontSize(arc.innerRadius, arc.outerRadius, arc.endAngle - arc.startAngle);
    const displayName = person
      ? truncateNameForArc(person.name, Math.floor((arc.outerRadius - arc.innerRadius) / (fontSize * 0.5)))
      : '?';

    return (
      <g
        key={arc.ahnentafel}
        className="cursor-pointer transition-opacity"
        onMouseEnter={() => setHoveredAhn(arc.ahnentafel)}
        onMouseLeave={() => setHoveredAhn(null)}
      >
        {person ? (
          <Link to={`/person/${dbId}/${person.id}`}>
            <path
              d={arc.path}
              fill={fillColor}
              opacity={opacity}
              stroke="var(--color-app-border)"
              strokeWidth="1"
              className="transition-all duration-150 hover:opacity-100"
            />
            {/* Text label */}
            {fontSize >= 8 && (
              <text
                x={arc.centroid.x}
                y={arc.centroid.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fill={isHovered ? 'white' : 'var(--color-app-text)'}
                fontWeight={isHovered ? 'bold' : 'normal'}
                style={{
                  transform: `rotate(${textAngle}deg)`,
                  transformOrigin: `${arc.centroid.x}px ${arc.centroid.y}px`,
                }}
              >
                {displayName}
              </text>
            )}
          </Link>
        ) : (
          <>
            <path
              d={arc.path}
              fill={fillColor}
              opacity={0.15}
              stroke="var(--color-app-border)"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
            {fontSize >= 10 && (
              <text
                x={arc.centroid.x}
                y={arc.centroid.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fill="var(--color-app-text-subtle)"
                style={{
                  transform: `rotate(${textAngle}deg)`,
                  transformOrigin: `${arc.centroid.x}px ${arc.centroid.y}px`,
                }}
              >
                ?
              </text>
            )}
          </>
        )}
      </g>
    );
  };

  // Render root person in center
  const rootPerson = data.rootPerson;
  const rootGenderColors = GENDER_COLORS[rootPerson.gender || 'unknown'];

  return (
    <div className="h-full flex flex-col">
      {/* Controls header */}
      <div className="flex items-center justify-between px-4 py-2 bg-app-card border-b border-app-border">
        <div className="text-sm text-app-text-muted">
          {data.rootPerson.name} &mdash; Fan Chart
        </div>
        <TreeControls
          generations={generations}
          onGenerationsChange={setGenerations}
          minGenerations={2}
          maxGenerations={Math.min(7, data.maxGenerationLoaded)}
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
        className="flex-1 bg-tree-bg overflow-hidden cursor-grab active:cursor-grabbing"
      >
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          className="w-full h-full"
        >
          <g className="zoom-group">
            {/* Arc segments for ancestors */}
            {arcs.map(renderArc)}

            {/* Root person circle */}
            <Link to={`/person/${dbId}/${rootPerson.id}`}>
              <circle
                cx={config.centerX}
                cy={config.centerY}
                r={config.innerRadius}
                fill={rootGenderColors.bg}
                stroke={rootGenderColors.border}
                strokeWidth="3"
                className="cursor-pointer hover:opacity-90 transition-opacity"
              />
              {/* Root person photo or initial */}
              {rootPerson.photoUrl ? (
                <clipPath id="root-clip">
                  <circle cx={config.centerX} cy={config.centerY} r={config.innerRadius - 4} />
                </clipPath>
              ) : null}
              {rootPerson.photoUrl ? (
                <image
                  href={rootPerson.photoUrl}
                  x={config.centerX - config.innerRadius + 4}
                  y={config.centerY - config.innerRadius + 4}
                  width={(config.innerRadius - 4) * 2}
                  height={(config.innerRadius - 4) * 2}
                  clipPath="url(#root-clip)"
                  preserveAspectRatio="xMidYMid slice"
                />
              ) : (
                <text
                  x={config.centerX}
                  y={config.centerY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={Math.max(14, config.innerRadius / 3)}
                  fill="var(--color-app-text)"
                  fontWeight="bold"
                >
                  {rootPerson.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </text>
              )}
            </Link>

            {/* Root person name below circle */}
            <text
              x={config.centerX}
              y={config.centerY + config.innerRadius + 18}
              textAnchor="middle"
              fontSize="14"
              fill="var(--color-app-text)"
              fontWeight="600"
            >
              {rootPerson.name}
            </text>
            <text
              x={config.centerX}
              y={config.centerY + config.innerRadius + 34}
              textAnchor="middle"
              fontSize="11"
              fill="var(--color-app-text-muted)"
            >
              {rootPerson.lifespan}
            </text>
          </g>
        </svg>
      </div>

      {/* Legend footer */}
      <div className="px-4 py-2 bg-app-card border-t border-app-border text-xs text-app-text-muted flex items-center gap-4">
        <span>Scroll to zoom | Drag to pan</span>
        <span>|</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: getLineageColor('paternal', 1) }} />
            Paternal
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: getLineageColor('maternal', 1) }} />
            Maternal
          </span>
        </div>
        <span>|</span>
        <span>
          {Array.from(ancestorMap.keys()).filter(ahn => ahn > 1 && ahn < Math.pow(2, generations + 1)).length} of {Math.pow(2, generations + 1) - 2} ancestors shown
        </span>
      </div>

      {/* Hover tooltip */}
      {hoveredAhn !== null && hoveredAhn !== 1 && ancestorMap.has(hoveredAhn) && (
        <HoverTooltip
          person={ancestorMap.get(hoveredAhn)!}
          ahnentafel={hoveredAhn}
        />
      )}
    </div>
  );
}

/**
 * Hover tooltip showing person details
 */
function HoverTooltip({
  person,
  ahnentafel,
}: {
  person: AncestryPersonCard;
  ahnentafel: number;
}) {
  const lineage = getLineageFromAhnentafel(ahnentafel);
  const generation = Math.floor(Math.log2(ahnentafel));

  const relationshipLabel = generation === 1
    ? (lineage === 'paternal' ? 'Father' : 'Mother')
    : generation === 2
      ? `${lineage === 'paternal' ? 'Paternal' : 'Maternal'} Grand${ahnentafel % 2 === 0 ? 'father' : 'mother'}`
      : `${generation - 2}${getOrdinalSuffix(generation - 2)} Great-Grand${ahnentafel % 2 === 0 ? 'father' : 'mother'}`;

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
      <div className="bg-app-card border border-app-border rounded-lg shadow-lg px-4 py-3 max-w-xs">
        <div className="text-xs text-app-text-subtle mb-1">{relationshipLabel}</div>
        <div className="font-semibold text-app-text">{person.name}</div>
        <div className="text-sm text-app-text-muted">{person.lifespan}</div>
        {person.birthPlace && (
          <div className="text-xs text-app-text-subtle mt-1">Born: {person.birthPlace}</div>
        )}
      </div>
    </div>
  );
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
