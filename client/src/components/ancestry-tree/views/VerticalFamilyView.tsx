/**
 * Vertical Family View
 *
 * Enhanced pedigree chart with:
 * - Ancestors at TOP, root in MIDDLE, (future: children at BOTTOM)
 * - Generation labels ("Michael's parents", "Michael's grandparents")
 * - Clean CSS-based connecting lines
 * - Zoom/pan support
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import * as d3 from 'd3';
import type { AncestryTreeResult, AncestryPersonCard, AncestryFamilyUnit } from '@fsf/shared';
import { AvatarPlaceholder } from '../../avatars/AvatarPlaceholder';
import { TreeControls } from '../shared/TreeControls';
import { GENDER_COLORS } from '../utils/lineageColors';

interface VerticalFamilyViewProps {
  data: AncestryTreeResult;
  dbId: string;
}

interface AncestorNode {
  person: AncestryPersonCard;
  father?: AncestorNode;
  mother?: AncestorNode;
}

// Build a simple tree structure from the ancestry data
function buildAncestorTree(data: AncestryTreeResult): AncestorNode {
  const buildNode = (person: AncestryPersonCard, parentUnits?: AncestryFamilyUnit[]): AncestorNode => {
    const node: AncestorNode = { person };

    const safeParentUnits = Array.isArray(parentUnits) ? parentUnits : undefined;
    if (safeParentUnits && safeParentUnits.length > 0) {
      const unit = safeParentUnits[0];
      if (unit.father) {
        const fatherParentUnits = Array.isArray(unit.fatherParentUnits) ? unit.fatherParentUnits : undefined;
        node.father = buildNode(unit.father, fatherParentUnits);
      }
      if (unit.mother) {
        const motherParentUnits = Array.isArray(unit.motherParentUnits) ? unit.motherParentUnits : undefined;
        node.mother = buildNode(unit.mother, motherParentUnits);
      }
    }

    return node;
  };

  const rootParentUnits = Array.isArray(data.parentUnits) ? data.parentUnits : undefined;
  return buildNode(data.rootPerson, rootParentUnits);
}

// Get generation relationship label
function getGenerationLabel(rootName: string, level: number): string {
  const firstName = rootName.split(' ')[0];
  switch (level) {
    case 0: return firstName;
    case 1: return `${firstName}'s parents`;
    case 2: return `${firstName}'s grandparents`;
    case 3: return `${firstName}'s great-grandparents`;
    default: {
      const greatCount = level - 2;
      const ordinal = greatCount > 1 ? `${greatCount}${getOrdinalSuffix(greatCount)}-great-` : 'great-';
      return `${firstName}'s ${ordinal}grandparents`;
    }
  }
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

interface PersonNodeProps {
  person: AncestryPersonCard;
  dbId: string;
  size?: 'sm' | 'md' | 'lg';
}

function PersonNode({ person, dbId, size = 'md' }: PersonNodeProps) {
  const gender = person.gender === 'female' ? 'female' : person.gender === 'male' ? 'male' : 'unknown';
  const genderColors = GENDER_COLORS[gender];

  const sizeClasses = {
    sm: 'w-28 p-2',
    md: 'w-36 p-3',
    lg: 'w-44 p-4'
  };
  const avatarSizes = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-lg',
    lg: 'w-12 h-12 text-xl'
  };

  return (
    <Link
      to={`/person/${dbId}/${person.id}`}
      data-person-id={person.id}
      className={`${sizeClasses[size]} rounded-lg border-2 transition-colors flex flex-col items-center text-center`}
      style={{
        borderColor: genderColors.border,
        backgroundColor: genderColors.bg,
      }}
    >
      <div
        className={`${avatarSizes[size]} rounded-full border-2 flex items-center justify-center mb-1 overflow-hidden`}
        style={{ borderColor: genderColors.border }}
      >
        {person.photoUrl ? (
          <img src={person.photoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <AvatarPlaceholder gender={gender} className="w-full h-full" />
        )}
      </div>
      <div className="font-medium text-app-text text-xs leading-tight truncate w-full">{person.name}</div>
      <div className="text-[10px] text-app-text-muted">{person.lifespan}</div>
    </Link>
  );
}

interface UnknownNodeProps {
  label: string;
  size?: 'sm' | 'md' | 'lg';
}

function UnknownNode({ label, size = 'md' }: UnknownNodeProps) {
  const sizeClasses = {
    sm: 'w-28 p-2',
    md: 'w-36 p-3',
    lg: 'w-44 p-4'
  };

  return (
    <div className={`${sizeClasses[size]} rounded-lg border-2 border-dashed border-app-border bg-app-card/50 flex flex-col items-center justify-center text-center opacity-60`}>
      <span className="text-xl text-app-text-muted">?</span>
      <div className="text-xs text-app-text-muted mt-1">{label}</div>
    </div>
  );
}

interface PedigreeLevelProps {
  node?: AncestorNode;
  dbId: string;
  level?: number;
  maxLevel?: number;
}

// Recursive component to render pedigree levels (ancestors at TOP)
function PedigreeLevel({ node, dbId, level = 0, maxLevel = 4 }: PedigreeLevelProps) {
  if (level >= maxLevel) return null;

  const size = level === 0 ? 'lg' : level === 1 ? 'md' : 'sm';
  const spacing = level === 0 ? 'gap-12' : level === 1 ? 'gap-8' : 'gap-4';

  return (
    <div className="flex flex-col items-center">
      {/* Parents (above) */}
      {level < maxLevel - 1 && (
        <div className={`flex ${spacing} mb-4`}>
          <PedigreeLevel node={node?.father} dbId={dbId} level={level + 1} maxLevel={maxLevel} />
          <PedigreeLevel node={node?.mother} dbId={dbId} level={level + 1} maxLevel={maxLevel} />
        </div>
      )}

      {/* Connecting lines - bracket opens upward */}
      {level < maxLevel - 1 && node && (node.father || node.mother) && (
        <div className="relative h-6 w-full flex justify-center mb-2">
          {/* Vertical lines down from each parent (top half) */}
          {node.father && (
            <div className="absolute top-0 w-0.5 h-3 bg-app-border" style={{ left: level === 0 ? '25%' : level === 1 ? '30%' : '35%' }}></div>
          )}
          {node.mother && (
            <div className="absolute top-0 w-0.5 h-3 bg-app-border" style={{ right: level === 0 ? '25%' : level === 1 ? '30%' : '35%' }}></div>
          )}
          {/* Horizontal line connecting parents (middle) */}
          <div className="absolute top-3 h-0.5 bg-app-border" style={{ width: level === 0 ? '50%' : level === 1 ? '40%' : '30%' }}></div>
          {/* Vertical line down to child (bottom half) */}
          <div className="absolute top-3 w-0.5 h-3 bg-app-border"></div>
        </div>
      )}

      {/* This person */}
      {node ? (
        <PersonNode person={node.person} dbId={dbId} size={size} />
      ) : (
        <UnknownNode label="Unknown" size={size} />
      )}
    </div>
  );
}

export function VerticalFamilyView({ data, dbId }: VerticalFamilyViewProps) {
  const [tree, setTree] = useState<AncestorNode | null>(null);
  const [generations, setGenerations] = useState(4);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);

  useEffect(() => {
    setTree(buildAncestorTree(data));
  }, [data]);

  // Calculate generation labels
  const generationLabels = useMemo(() => {
    const labels: string[] = [];
    for (let i = generations - 1; i >= 0; i--) {
      labels.push(getGenerationLabel(data.rootPerson.name, i));
    }
    return labels;
  }, [data.rootPerson.name, generations]);

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
        contentSelection.style('transform-origin', '0 0');
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

      const x = (containerRect.width - contentRect.width * finalScale) / 2;
      const y = (containerRect.height - contentRect.height * finalScale) / 2;

      containerSelection.call(zoomRef.current.transform, d3.zoomIdentity.translate(x, y).scale(finalScale));
    };

    const resizeObserver = new ResizeObserver(centerTree);
    resizeObserver.observe(container);
    requestAnimationFrame(centerTree);

    return () => {
      containerSelection.on('.zoom', null);
      resizeObserver.disconnect();
    };
  }, [tree, generations]);

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
    const x = (containerRect.width - contentRect.width) / 2;
    const y = (containerRect.height - contentRect.height) / 2;

    d3.select(container).transition().duration(300).call(zoomRef.current.transform, d3.zoomIdentity.translate(x, y).scale(1));
  }, []);

  if (!tree) return <div className="p-4 text-app-text-muted">Loading...</div>;

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
        <div ref={contentRef} className="p-8 inline-block">
          {/* Generation labels on the left */}
          <div className="flex">
            {/* Labels column */}
            <div className="flex flex-col justify-around mr-4 text-right">
              {generationLabels.map((label, i) => (
                <div
                  key={i}
                  className="text-xs text-app-text-muted py-4 whitespace-nowrap"
                  style={{ minHeight: i === generationLabels.length - 1 ? '120px' : '80px' }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Tree */}
            <div className="flex justify-center">
              <PedigreeLevel node={tree} dbId={dbId} maxLevel={generations} />
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-app-border bg-app-card text-xs text-app-text-muted flex items-center gap-4">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border-2" style={{ borderColor: GENDER_COLORS.male.border }}></span> Male
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border-2" style={{ borderColor: GENDER_COLORS.female.border }}></span> Female
        </span>
        <span>|</span>
        <span>Scroll to zoom | Drag to pan | Click any person to view details</span>
      </div>
    </div>
  );
}
