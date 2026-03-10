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
  generateTextArcPath,
  isArcInBottomHalf,
  getRadialTextRotation,
  fitFontSizeToName,
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

/**
 * Root person label that auto-wraps name into multiple lines to fit the center circle.
 */
function RootPersonLabel({
  name,
  lifespan,
  cx,
  cy,
  radius,
}: {
  name: string;
  lifespan: string;
  cx: number;
  cy: number;
  radius: number;
}) {
  const diameter = radius * 2 * 0.75; // usable width ~75% of diameter
  const maxFontSize = Math.min(14, radius / 3);

  // Split name into words and wrap into lines that fit
  const words = name.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = testLine.length * maxFontSize * 0.55;
    if (testWidth > diameter && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  // Auto-size: shrink font if any line still overflows
  let fontSize = maxFontSize;
  for (const line of lines) {
    const lineWidth = line.length * fontSize * 0.55;
    if (lineWidth > diameter) {
      fontSize = Math.min(fontSize, diameter / (line.length * 0.55));
    }
  }
  fontSize = Math.max(8, fontSize);

  const lifespanSize = Math.max(7, fontSize * 0.75);
  const lineHeight = fontSize * 1.3;
  const totalTextHeight = lines.length * lineHeight + lifespanSize * 1.3;
  const startY = cy - totalTextHeight / 2 + lineHeight / 2;

  return (
    <>
      {lines.map((line, i) => (
        <text
          key={i}
          x={cx}
          y={startY + i * lineHeight}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fill="var(--color-app-text)"
          fontWeight="bold"
        >
          {line}
        </text>
      ))}
      <text
        x={cx}
        y={startY + lines.length * lineHeight}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={lifespanSize}
        fill="var(--color-app-text-muted)"
      >
        {lifespan}
      </text>
    </>
  );
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
  // Progressively expand from semi-circle to full circle as generations increase
  const config = useMemo((): FanChartConfig => {
    // Expand angle: 180° for ≤4 gens, +30° per gen after, capping at 360°
    const spread = Math.min(360, 180 + Math.max(0, generations - 4) * 30);
    // How far from semi-circle to full circle (0..1)
    const fullness = (spread - 180) / 180;

    const centerX = dimensions.width / 2;
    // Interpolate center from bottom (semi) to middle (full circle)
    const semiCenterY = dimensions.height - 60;
    const fullCenterY = dimensions.height / 2;
    const centerY = semiCenterY + (fullCenterY - semiCenterY) * fullness;

    // Max radius adapts: semi-circle uses height, full circle uses min(w,h)/2
    const semiMaxRadius = Math.min(dimensions.width / 2 - 40, dimensions.height - 100);
    const fullMaxRadius = Math.min(dimensions.width / 2 - 40, dimensions.height / 2 - 40);
    const maxRadius = semiMaxRadius + (fullMaxRadius - semiMaxRadius) * fullness;

    const innerRadius = Math.min(50, maxRadius / 7);
    const generationWidth = Math.max(30, (maxRadius - innerRadius) / (generations + 0.5));

    // Expand symmetrically around 270° (top of semi-circle)
    const halfSpread = spread / 2;
    const startAngle = 270 - halfSpread;
    const endAngle = 270 + halfSpread;

    return {
      centerX,
      centerY,
      innerRadius,
      generationWidth,
      startAngle,
      endAngle,
      gap: Math.max(0.2, 0.8 - generations * 0.05),
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

  // Render an arc segment with curved or radial text
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

    // First name only for gen 4+
    const personName = person
      ? (arc.generation >= 4 ? person.name.split(' ')[0] : person.name)
      : '?';

    // Gen 1-3: curved arc text, Gen 4+: radial text reading outward
    const useRadialText = arc.generation >= 4;

    // Arc backgrounds are always light pastels regardless of theme,
    // so text must always be dark for contrast
    const textFill = person
      ? (isHovered ? 'white' : '#1a1a1a')
      : '#999';

    let textEl: React.ReactNode = null;

    if (useRadialText) {
      // Radial text: straight text rotated to read from center outward
      const rotation = getRadialTextRotation(arc.centroid.angle);
      const arcHeight = arc.outerRadius - arc.innerRadius;
      const arcWidth = (arc.innerRadius + arc.outerRadius) / 2 * (arc.endAngle - arc.startAngle);

      // Max font size constrained by arc width, then auto-fit to name length
      const maxSize = Math.min(14, arcHeight * 0.55, arcWidth * 0.8);
      const fittedSize = fitFontSizeToName(personName, arcHeight, maxSize);

      // Always render — use CSS scale for tiny text (visible on zoom)
      const renderSize = Math.max(8, fittedSize);
      const scale = fittedSize < 8 ? fittedSize / 8 : 1;

      textEl = (
        <text
          x={arc.centroid.x}
          y={arc.centroid.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={renderSize}
          fill={textFill}
          fontWeight={isHovered ? 'bold' : 'normal'}
          style={{
            transform: `rotate(${rotation}deg)${scale < 1 ? ` scale(${scale})` : ''}`,
            transformOrigin: `${arc.centroid.x}px ${arc.centroid.y}px`,
          }}
        >
          {personName}
        </text>
      );
    } else {
      // Curved arc text using textPath
      const midR = (arc.innerRadius + arc.outerRadius) / 2;
      const arcLength = midR * (arc.endAngle - arc.startAngle);
      const arcHeight = arc.outerRadius - arc.innerRadius;

      // Max font size from arc geometry, then fit to name without truncation
      const maxSize = Math.min(14, arcHeight * 0.55);
      const fittedSize = fitFontSizeToName(personName, arcLength, maxSize);

      const flipped = isArcInBottomHalf(arc.startAngle, arc.endAngle);
      const textR = flipped ? midR + fittedSize * 0.4 : midR;
      const textPathId = `fan-tp-${arc.ahnentafel}`;
      const textArcPath = generateTextArcPath(
        config.centerX, config.centerY, textR,
        arc.startAngle, arc.endAngle, flipped
      );

      // Always render — CSS scale handles sub-pixel for zoom
      const renderSize = Math.max(8, fittedSize);
      const scale = fittedSize < 8 ? fittedSize / 8 : 1;

      textEl = (
        <>
          <defs>
            <path id={textPathId} d={textArcPath} fill="none" />
          </defs>
          <text
            fontSize={renderSize}
            fill={textFill}
            fontWeight={isHovered ? 'bold' : 'normal'}
            style={scale < 1 ? {
              transform: `scale(${scale})`,
              transformOrigin: `${arc.centroid.x}px ${arc.centroid.y}px`,
            } : undefined}
          >
            <textPath
              href={`#${textPathId}`}
              startOffset="50%"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {personName}
            </textPath>
          </text>
        </>
      );
    }

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
            {textEl}
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
            {textEl}
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
          maxGenerations={Math.min(10, data.maxGenerationLoaded)}
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
              {/* Root person photo or name inside center circle */}
              {rootPerson.photoUrl ? (
                <>
                  <clipPath id="root-clip">
                    <circle cx={config.centerX} cy={config.centerY} r={config.innerRadius - 4} />
                  </clipPath>
                  <image
                    href={rootPerson.photoUrl}
                    x={config.centerX - config.innerRadius + 4}
                    y={config.centerY - config.innerRadius + 4}
                    width={(config.innerRadius - 4) * 2}
                    height={(config.innerRadius - 4) * 2}
                    clipPath="url(#root-clip)"
                    preserveAspectRatio="xMidYMid slice"
                  />
                </>
              ) : (
                <RootPersonLabel
                  name={rootPerson.name}
                  lifespan={rootPerson.lifespan}
                  cx={config.centerX}
                  cy={config.centerY}
                  radius={config.innerRadius}
                />
              )}
            </Link>
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
