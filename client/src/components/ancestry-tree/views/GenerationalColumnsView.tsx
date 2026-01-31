/**
 * Generational Columns Tree View
 *
 * Displays ancestors in vertical columns organized by generation.
 * Root person on the left, with each generation flowing to the right.
 * Scrollable horizontally for deeper ancestry.
 * Users can expand individual nodes to load more ancestors.
 */
import { useEffect, useState } from 'react';
import type { AncestryTreeResult, AncestryPersonCard, AncestryFamilyUnit, ExpandAncestryRequest } from '@fsf/shared';
import { AncestorNode, RootPersonNode } from '../shared/AncestorNode';

interface GenerationalColumnsViewProps {
  data: AncestryTreeResult;
  dbId: string;
  onExpand?: (request: ExpandAncestryRequest, nodeId: string) => void;
  expandingNodes?: Set<string>;
}

interface GenerationPerson {
  person: AncestryPersonCard;
  parentIndex?: number;
  slot: 'father' | 'mother';
}

interface Generation {
  level: number;
  people: (GenerationPerson | null)[];
}

// Build generations array from tree data
function buildGenerations(data: AncestryTreeResult, maxGen: number): Generation[] {
  const generations: Generation[] = [];

  // Gen 0: Root person
  generations.push({
    level: 0,
    people: [{ person: data.rootPerson, slot: 'father' }]
  });

  // Build subsequent generations
  const processLevel = (level: number, units: (AncestryFamilyUnit | undefined)[]) => {
    if (level > maxGen) return;

    const people: (GenerationPerson | null)[] = [];
    const nextUnits: (AncestryFamilyUnit | undefined)[] = [];

    units.forEach((unit, parentIndex) => {
      if (unit?.father) {
        people.push({ person: unit.father, parentIndex, slot: 'father' });
        nextUnits.push(unit.fatherParentUnits?.[0]);
      } else {
        people.push(null);
        nextUnits.push(undefined);
      }

      if (unit?.mother) {
        people.push({ person: unit.mother, parentIndex, slot: 'mother' });
        nextUnits.push(unit.motherParentUnits?.[0]);
      } else {
        people.push(null);
        nextUnits.push(undefined);
      }
    });

    if (people.some(p => p !== null)) {
      generations.push({ level, people });
      processLevel(level + 1, nextUnits);
    }
  };

  // Start with root's parents
  if (data.parentUnits && data.parentUnits.length > 0) {
    processLevel(1, [data.parentUnits[0]]);
  }

  return generations;
}


// Get generation label - simplified for deep generations
function getGenerationLabel(level: number): { main: string; sub?: string } {
  switch (level) {
    case 0: return { main: 'Gen 0', sub: 'Self' };
    case 1: return { main: 'Gen 1', sub: 'Parents' };
    case 2: return { main: 'Gen 2', sub: 'Grandparents' };
    case 3: return { main: 'Gen 3', sub: '1st Great-Grandparents' };
    default: return { main: `Gen ${level}`, sub: `${level - 2}${getOrdinalSuffix(level - 2)} Great-Grandparents` };
  }
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

export function GenerationalColumnsView({ data, dbId, onExpand, expandingNodes = new Set() }: GenerationalColumnsViewProps) {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [maxGen, setMaxGen] = useState(data.maxGenerationLoaded);

  useEffect(() => {
    setGenerations(buildGenerations(data, maxGen));
  }, [data, maxGen]);

  // Update maxGen when data changes (after expanding nodes)
  useEffect(() => {
    if (data.maxGenerationLoaded > maxGen) {
      setMaxGen(data.maxGenerationLoaded);
    }
  }, [data.maxGenerationLoaded, maxGen]);

  // Count known ancestors per generation
  const getKnownCount = (gen: Generation) => gen.people.filter(p => p !== null).length;

  // Count how many nodes have more ancestors to load
  const getExpandableCount = (): number => {
    return generations.reduce((sum, gen) => {
      return sum + gen.people.filter(p => p?.person.hasMoreAncestors).length;
    }, 0);
  };

  // Handle expanding a person's ancestors
  const handleNodeExpand = (person: AncestryPersonCard) => {
    if (!onExpand) return;
    const request: ExpandAncestryRequest = person.gender === 'female'
      ? { motherId: person.id }
      : { fatherId: person.id };
    onExpand(request, person.id);
  };

  return (
    <div className="h-full flex flex-col bg-app-bg">
      {/* Controls */}
      <div className="px-4 py-3 bg-app-card border-b border-app-border flex items-center justify-between">
        <div className="text-sm text-app-text-muted">
          Showing {generations.length} generations ({generations.reduce((sum, g) => sum + getKnownCount(g), 0)} ancestors)
          {getExpandableCount() > 0 && (
            <span className="text-app-text-subtle ml-2">&bull; {getExpandableCount()} expandable</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-app-text-subtle">Visible:</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMaxGen(Math.max(2, maxGen - 1))}
              disabled={maxGen <= 2}
              className="px-2 py-1 text-sm rounded bg-app-border hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              -
            </button>
            <span className="text-sm text-app-text w-8 text-center">{maxGen}</span>
            <button
              onClick={() => setMaxGen(Math.min(maxGen + 1, data.maxGenerationLoaded))}
              disabled={maxGen >= data.maxGenerationLoaded}
              className="px-2 py-1 text-sm rounded bg-app-border hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              +
            </button>
          </div>
          <span className="text-xs text-app-text-subtle">of {data.maxGenerationLoaded} loaded</span>
        </div>
      </div>

      {/* Columns */}
      <div className="flex-1 overflow-auto">
        <div className="flex min-h-full">
          {generations.map((gen) => {
            const label = getGenerationLabel(gen.level);
            const knownPeople = gen.people.filter(p => p !== null) as GenerationPerson[];

            return (
              <div key={gen.level} className="flex flex-col border-r border-app-border min-w-fit">
                {/* Generation header - solid background */}
                <div className="px-4 py-2 bg-app-card border-b border-app-border sticky top-0 z-10">
                  <div className="text-xs font-bold text-app-text uppercase tracking-wide">
                    {label.main}
                  </div>
                  {label.sub && (
                    <div className="text-[10px] text-app-text-muted">
                      {label.sub}
                    </div>
                  )}
                  <div className="text-[10px] text-app-text-subtle mt-0.5">
                    {knownPeople.length} of {Math.pow(2, gen.level)} known
                  </div>
                </div>

                {/* People in this generation - only show known people */}
                <div className="flex-1 p-3 flex flex-col">
                  <div className="flex flex-col gap-1.5">
                    {gen.level === 0 ? (
                      <RootPersonNode
                        key={`root-${data.rootPerson.id}`}
                        person={data.rootPerson}
                        dbId={dbId}
                      />
                    ) : (
                      knownPeople.map((item, idx) => (
                        <AncestorNode
                          key={`${gen.level}-${idx}-${item.person.id}`}
                          person={item.person}
                          dbId={dbId}
                          size={gen.level > 3 ? 'xs' : gen.level > 2 ? 'sm' : 'md'}
                          variant="card"
                          expandDirection="right"
                          onExpand={item.person.hasMoreAncestors && onExpand ? () => handleNodeExpand(item.person) : undefined}
                          isExpanding={expandingNodes.has(item.person.id)}
                        />
                      ))
                    )}
                    {gen.level > 0 && knownPeople.length === 0 && (
                      <div className="text-xs text-app-text-muted p-2 text-center">
                        No known ancestors
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-app-border bg-app-card text-xs text-app-text-muted flex items-center gap-4">
        <span className="flex items-center gap-1">
          <span className="w-3 h-1 bg-app-male"></span> Male
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-1 bg-app-female"></span> Female
        </span>
        <span>Click arrows on nodes to expand ancestors</span>
      </div>
    </div>
  );
}
