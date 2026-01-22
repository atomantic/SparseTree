/**
 * Generational Columns Tree View
 *
 * Displays ancestors in vertical columns organized by generation.
 * Root person on the left, with each generation flowing to the right.
 * Scrollable horizontally for deeper ancestry.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AncestryTreeResult, AncestryPersonCard, AncestryFamilyUnit } from '@fsf/shared';

interface GenerationalColumnsViewProps {
  data: AncestryTreeResult;
  dbId: string;
  onLoadMore?: (newDepth: number) => Promise<void>;
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

interface PersonCardProps {
  person: AncestryPersonCard;
  dbId: string;
  compact?: boolean;
}

function PersonCard({ person, dbId, compact = false }: PersonCardProps) {
  const isMale = person.gender === 'male';

  if (compact) {
    return (
      <Link
        to={`/person/${dbId}/${person.id}`}
        className={`flex items-center gap-2 p-2 rounded-lg border-l-4 ${isMale ? 'border-l-app-male bg-app-male/10 hover:bg-app-male/15' : 'border-l-app-female bg-app-female/10 hover:bg-app-female/15'} transition-colors min-w-[160px]`}
      >
        <div className={`w-8 h-8 rounded-full border-2 ${isMale ? 'border-app-male' : 'border-app-female'} flex items-center justify-center flex-shrink-0 overflow-hidden`}>
          {person.photoUrl ? (
            <img src={person.photoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs text-app-text-muted">{isMale ? '\u{1F468}' : '\u{1F469}'}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-app-text text-xs truncate">{person.name}</div>
          <div className="text-[10px] text-app-text-muted">{person.lifespan}</div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={`/person/${dbId}/${person.id}`}
      className={`flex items-center gap-3 p-3 rounded-xl border-l-4 ${isMale ? 'border-l-app-male bg-app-male/10 hover:bg-app-male/20' : 'border-l-app-female bg-app-female/10 hover:bg-app-female/20'} transition-colors min-w-[200px]`}
    >
      <div className={`w-12 h-12 rounded-full border-2 ${isMale ? 'border-app-male' : 'border-app-female'} flex items-center justify-center flex-shrink-0 overflow-hidden`}>
        {person.photoUrl ? (
          <img src={person.photoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-lg text-app-text-muted">{isMale ? '\u{1F468}' : '\u{1F469}'}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-app-text text-sm">{person.name}</div>
        <div className="text-xs text-app-text-muted">{person.lifespan}</div>
      </div>
    </Link>
  );
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

export function GenerationalColumnsView({ data, dbId, onLoadMore }: GenerationalColumnsViewProps) {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [maxGen, setMaxGen] = useState(data.maxGenerationLoaded);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setGenerations(buildGenerations(data, maxGen));
  }, [data, maxGen]);

  // Update maxGen when data changes (after loading more)
  useEffect(() => {
    if (data.maxGenerationLoaded > maxGen) {
      setMaxGen(data.maxGenerationLoaded);
    }
  }, [data.maxGenerationLoaded, maxGen]);

  // Count known ancestors per generation
  const getKnownCount = (gen: Generation) => gen.people.filter(p => p !== null).length;

  // Check if any person in the last generation has more ancestors
  const hasMoreToLoad = (): boolean => {
    if (generations.length === 0) return false;
    const lastGen = generations[generations.length - 1];
    return lastGen.people.some(p => p?.person.hasMoreAncestors);
  };

  const handleLoadMore = async () => {
    if (!onLoadMore || loadingMore) return;
    setLoadingMore(true);
    await onLoadMore(data.maxGenerationLoaded + 5);
    setLoadingMore(false);
  };

  return (
    <div className="h-full flex flex-col bg-app-bg">
      {/* Controls */}
      <div className="px-4 py-3 bg-app-card border-b border-app-border flex items-center justify-between">
        <div className="text-sm text-app-text-muted">
          Showing {generations.length} generations ({generations.reduce((sum, g) => sum + getKnownCount(g), 0)} ancestors)
          {hasMoreToLoad() && <span className="text-app-text-subtle ml-2">&bull; More available</span>}
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
                    {knownPeople.map((item) => (
                      <PersonCard
                        key={item.person.id}
                        person={item.person}
                        dbId={dbId}
                        compact={gen.level > 2}
                      />
                    ))}
                    {knownPeople.length === 0 && (
                      <div className="text-xs text-app-text-muted p-2 text-center">
                        No known ancestors
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Load More column */}
          {hasMoreToLoad() && onLoadMore && (
            <div className="flex flex-col min-w-[140px] border-r-0">
              <div className="px-4 py-2 bg-app-card border-b border-app-border sticky top-0 z-10">
                <div className="text-xs font-bold text-app-text uppercase tracking-wide">
                  More...
                </div>
                <div className="text-[10px] text-app-text-muted">
                  Load deeper ancestry
                </div>
              </div>
              <div className="flex-1 p-3 flex items-start justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg bg-app-border hover:bg-app-hover disabled:opacity-50 disabled:cursor-wait transition-colors"
                >
                  {loadingMore ? (
                    <>
                      <div className="w-6 h-6 border-2 border-app-text-muted border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-app-text-muted">Loading...</span>
                    </>
                  ) : (
                    <>
                      <span className="text-2xl">+</span>
                      <span className="text-xs text-app-text-muted">Load 5 more</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
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
        <span>Scroll horizontally to see more generations</span>
      </div>
    </div>
  );
}
