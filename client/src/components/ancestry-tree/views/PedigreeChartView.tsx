/**
 * Pedigree Chart Tree View
 *
 * Classic vertical pedigree chart with the root person at the bottom
 * and ancestors branching upward. Supports 2-6 generations with
 * clean CSS-based connecting lines.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AncestryTreeResult, AncestryPersonCard, AncestryFamilyUnit } from '@fsf/shared';

interface PedigreeChartViewProps {
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

    if (parentUnits && parentUnits.length > 0) {
      const unit = parentUnits[0];
      if (unit.father) {
        node.father = buildNode(unit.father, unit.fatherParentUnits);
      }
      if (unit.mother) {
        node.mother = buildNode(unit.mother, unit.motherParentUnits);
      }
    }

    return node;
  };

  return buildNode(data.rootPerson, data.parentUnits);
}

interface PersonNodeProps {
  person: AncestryPersonCard;
  dbId: string;
  size?: 'sm' | 'md' | 'lg';
}

function PersonNode({ person, dbId, size = 'md' }: PersonNodeProps) {
  const isMale = person.gender === 'male';
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
      className={`${sizeClasses[size]} rounded-lg border-2 ${isMale ? 'border-app-male bg-app-male/10 hover:bg-app-male/20' : 'border-app-female bg-app-female/10 hover:bg-app-female/20'} transition-colors flex flex-col items-center text-center`}
    >
      <div className={`${avatarSizes[size]} rounded-full border-2 ${isMale ? 'border-app-male' : 'border-app-female'} flex items-center justify-center mb-1 overflow-hidden`}>
        {person.photoUrl ? (
          <img src={person.photoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-app-text-muted">{isMale ? '\u{1F468}' : '\u{1F469}'}</span>
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

// Recursive component to render pedigree levels
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

      {/* Connecting lines - bracket opens upward └──┘ */}
      {level < maxLevel - 1 && node && (node.father || node.mother) && (
        <div className="relative h-6 w-full flex justify-center mb-2">
          {/* Vertical line up from person */}
          <div className="absolute top-0 w-0.5 h-3 bg-app-border"></div>
          {/* Horizontal line connecting to parents */}
          <div className="absolute bottom-0 h-0.5 bg-app-border" style={{ width: level === 0 ? '50%' : level === 1 ? '40%' : '30%' }}></div>
          {/* Vertical lines down from each parent */}
          {node.father && (
            <div className="absolute bottom-0 w-0.5 h-3 bg-app-border" style={{ left: level === 0 ? '25%' : level === 1 ? '30%' : '35%' }}></div>
          )}
          {node.mother && (
            <div className="absolute bottom-0 w-0.5 h-3 bg-app-border" style={{ right: level === 0 ? '25%' : level === 1 ? '30%' : '35%' }}></div>
          )}
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

export function PedigreeChartView({ data, dbId }: PedigreeChartViewProps) {
  const [tree, setTree] = useState<AncestorNode | null>(null);
  const [generations, setGenerations] = useState(4);

  useEffect(() => {
    setTree(buildAncestorTree(data));
  }, [data]);

  if (!tree) return <div className="p-4 text-app-text-muted">Loading...</div>;

  return (
    <div className="h-full flex flex-col bg-app-bg">
      {/* Controls */}
      <div className="px-4 py-3 bg-app-card border-b border-app-border flex items-center justify-between">
        <div className="text-sm text-app-text-muted">
          Showing {generations} generations
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setGenerations(Math.max(2, generations - 1))}
            disabled={generations <= 2}
            className="px-2 py-1 text-sm rounded bg-app-border hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            -
          </button>
          <span className="text-sm text-app-text w-8 text-center">{generations}</span>
          <button
            onClick={() => setGenerations(Math.min(6, generations + 1))}
            disabled={generations >= 6}
            className="px-2 py-1 text-sm rounded bg-app-border hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            +
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex-1 overflow-auto p-8">
        <div className="min-w-max flex justify-center">
          <PedigreeLevel node={tree} dbId={dbId} maxLevel={generations} />
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-app-border text-xs text-app-text-muted flex items-center gap-4">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border-2 border-app-male"></span> Male
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border-2 border-app-female"></span> Female
        </span>
        <span>Click any person to view details</span>
      </div>
    </div>
  );
}
