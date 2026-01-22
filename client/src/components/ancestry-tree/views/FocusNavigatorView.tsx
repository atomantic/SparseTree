/**
 * Focus Navigator Tree View
 *
 * A navigation-focused tree view that shows one person at a time with their
 * immediate parents above. Click a parent to navigate up the ancestry tree.
 * Includes a breadcrumb trail for easy navigation back down.
 * Shows detailed information since we only display 3 cards at a time.
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { AncestryTreeResult, AncestryPersonCard, AncestryFamilyUnit } from '@fsf/shared';

interface FocusNavigatorViewProps {
  data: AncestryTreeResult;
  dbId: string;
}

interface PersonWithAncestors {
  person: AncestryPersonCard;
  parents?: AncestryFamilyUnit;
}

// Build a lookup map from the tree data for quick person access
function buildPersonMap(data: AncestryTreeResult): Map<string, PersonWithAncestors> {
  const map = new Map<string, PersonWithAncestors>();

  map.set(data.rootPerson.id, { person: data.rootPerson });

  const processUnits = (units: AncestryFamilyUnit[] | undefined, childId?: string) => {
    if (!units) return;

    for (const unit of units) {
      if (childId && map.has(childId)) {
        const existing = map.get(childId)!;
        existing.parents = unit;
      }

      if (unit.father) {
        if (!map.has(unit.father.id)) {
          map.set(unit.father.id, { person: unit.father });
        }
        processUnits(unit.fatherParentUnits, unit.father.id);
      }

      if (unit.mother) {
        if (!map.has(unit.mother.id)) {
          map.set(unit.mother.id, { person: unit.mother });
        }
        processUnits(unit.motherParentUnits, unit.mother.id);
      }
    }
  };

  if (data.parentUnits) {
    for (const unit of data.parentUnits) {
      const rootEntry = map.get(data.rootPerson.id)!;
      rootEntry.parents = unit;

      if (unit.father) {
        map.set(unit.father.id, { person: unit.father });
        processUnits(unit.fatherParentUnits, unit.father.id);
      }
      if (unit.mother) {
        map.set(unit.mother.id, { person: unit.mother });
        processUnits(unit.motherParentUnits, unit.mother.id);
      }
    }
  }

  return map;
}

// Parent card component - medium detail level
function ParentCard({
  person,
  dbId,
  label,
  onNavigate
}: {
  person: AncestryPersonCard | undefined;
  dbId: string;
  label: string;
  onNavigate: (person: AncestryPersonCard) => void;
}) {
  const isMale = person?.gender === 'male';

  if (!person) {
    return (
      <div className="flex flex-col items-center">
        <div className="w-48 p-4 rounded-xl border-2 border-dashed border-app-border bg-app-card/30 opacity-60">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-app-border flex items-center justify-center flex-shrink-0">
              <span className="text-2xl text-app-text-muted">?</span>
            </div>
            <div>
              <div className="text-sm font-medium text-app-text-muted">{label}</div>
              <div className="text-xs text-app-text-subtle">Unknown</div>
            </div>
          </div>
        </div>
        <div className="h-8 w-0.5 bg-app-border mt-2"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <button
        onClick={() => onNavigate(person)}
        className={`group w-56 p-4 rounded-xl border-2 ${isMale ? 'border-app-male bg-app-male/5 hover:bg-app-male/10' : 'border-app-female bg-app-female/5 hover:bg-app-female/10'} transition-all hover:shadow-md`}
      >
        <div className="flex items-start gap-3">
          <div className={`w-16 h-16 rounded-full border-3 ${isMale ? 'border-app-male' : 'border-app-female'} flex items-center justify-center flex-shrink-0 overflow-hidden group-hover:scale-105 transition-transform`}>
            {person.photoUrl ? (
              <img src={person.photoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl text-app-text-muted">{isMale ? '\u{1F468}' : '\u{1F469}'}</span>
            )}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="text-xs text-app-text-subtle uppercase tracking-wide">{label}</div>
            <div className="font-semibold text-app-text group-hover:text-app-link truncate">{person.name}</div>
            <div className="text-xs text-app-text-muted">{person.lifespan}</div>
            {person.birthPlace && (
              <div className="text-xs text-app-text-subtle mt-1 truncate" title={person.birthPlace}>
                Born: {person.birthPlace}
              </div>
            )}
          </div>
        </div>
        {person.hasMoreAncestors && (
          <div className="mt-2 text-xs text-app-link text-center">
            Click to view parents &uarr;
          </div>
        )}
      </button>
      <div className="h-8 w-0.5 bg-app-border mt-2"></div>
    </div>
  );
}

// Focused person card component - full detail level
function FocusedPersonCard({
  person,
  dbId
}: {
  person: AncestryPersonCard;
  dbId: string;
}) {
  const isMale = person.gender === 'male';

  return (
    <div className={`relative p-6 rounded-2xl border-4 ${isMale ? 'border-app-male bg-app-male/5' : 'border-app-female bg-app-female/5'} shadow-lg w-full max-w-lg`}>
      <div className="flex items-start gap-5">
        <div className={`w-24 h-24 rounded-full border-4 ${isMale ? 'border-app-male' : 'border-app-female'} flex items-center justify-center flex-shrink-0 overflow-hidden`}>
          {person.photoUrl ? (
            <img src={person.photoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-4xl text-app-text-muted">{isMale ? '\u{1F468}' : '\u{1F469}'}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold text-app-text">{person.name}</h2>
          <div className="text-base text-app-text-muted mt-1">{person.lifespan}</div>

          {/* Detail rows */}
          <div className="mt-3 space-y-1.5">
            {person.birthPlace && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-app-text-subtle w-14 flex-shrink-0">Born:</span>
                <span className="text-app-text">{person.birthPlace}</span>
              </div>
            )}
            {person.deathPlace && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-app-text-subtle w-14 flex-shrink-0">Died:</span>
                <span className="text-app-text">{person.deathPlace}</span>
              </div>
            )}
            {person.occupation && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-app-text-subtle w-14 flex-shrink-0">Work:</span>
                <span className="text-app-text">{person.occupation}</span>
              </div>
            )}
          </div>

          <div className="mt-4">
            <Link
              to={`/person/${dbId}/${person.id}`}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-app-border text-sm text-app-text hover:bg-app-hover transition-colors"
            >
              View full profile &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FocusNavigatorView({ data, dbId }: FocusNavigatorViewProps) {
  const [focusedId, setFocusedId] = useState(data.rootPerson.id);
  const [breadcrumb, setBreadcrumb] = useState<AncestryPersonCard[]>([data.rootPerson]);
  const [personMap, setPersonMap] = useState<Map<string, PersonWithAncestors>>(new Map());

  useEffect(() => {
    setPersonMap(buildPersonMap(data));
  }, [data]);

  const focused = personMap.get(focusedId);
  if (!focused) return <div className="p-4 text-app-text-muted">Loading...</div>;

  const father = focused.parents?.father;
  const mother = focused.parents?.mother;

  const navigateTo = (person: AncestryPersonCard) => {
    setFocusedId(person.id);
    const existingIndex = breadcrumb.findIndex(p => p.id === person.id);
    if (existingIndex >= 0) {
      setBreadcrumb(breadcrumb.slice(0, existingIndex + 1));
    } else {
      setBreadcrumb([...breadcrumb, person]);
    }
  };

  const goBack = () => {
    if (breadcrumb.length > 1) {
      const newBreadcrumb = breadcrumb.slice(0, -1);
      setBreadcrumb(newBreadcrumb);
      setFocusedId(newBreadcrumb[newBreadcrumb.length - 1].id);
    }
  };

  // Calculate generation level from breadcrumb
  const generationLevel = breadcrumb.length - 1;
  const generationLabel = generationLevel === 0 ? 'Self' :
    generationLevel === 1 ? 'Parent' :
    generationLevel === 2 ? 'Grandparent' :
    `${generationLevel - 1}${getOrdinalSuffix(generationLevel - 1)} Great-Grandparent`;

  return (
    <div className="h-full flex flex-col bg-app-bg">
      {/* Breadcrumb navigation */}
      <div className="px-4 py-3 bg-app-card border-b border-app-border">
        <div className="flex items-center gap-2 text-sm overflow-x-auto">
          {breadcrumb.map((person, i) => (
            <span key={`${i}-${person.id}`} className="flex items-center gap-2 whitespace-nowrap">
              {i > 0 && <span className="text-app-text-muted">&rarr;</span>}
              <button
                onClick={() => navigateTo(person)}
                className={`hover:text-app-link ${person.id === focusedId ? 'text-app-text font-medium' : 'text-app-text-muted'}`}
              >
                {person.name.split(' ')[0]}
              </button>
            </span>
          ))}
        </div>
        {generationLevel > 0 && (
          <div className="text-xs text-app-text-subtle mt-1">
            Viewing: {generationLabel}
          </div>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6 overflow-auto">
        {/* Parents row */}
        <div className="flex gap-6 items-end">
          <ParentCard
            person={father}
            dbId={dbId}
            label="Father"
            onNavigate={navigateTo}
          />
          <ParentCard
            person={mother}
            dbId={dbId}
            label="Mother"
            onNavigate={navigateTo}
          />
        </div>

        {/* Connecting bracket */}
        <div className="flex items-center">
          <div className="w-28 h-0.5 bg-app-border"></div>
          <div className="w-4 h-4 rounded-full bg-app-border flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-app-card"></div>
          </div>
          <div className="w-28 h-0.5 bg-app-border"></div>
        </div>

        {/* Focused person card */}
        <FocusedPersonCard person={focused.person} dbId={dbId} />

        {/* Back navigation button */}
        {breadcrumb.length > 1 && (
          <button
            onClick={goBack}
            className="px-4 py-2 rounded-lg bg-app-border text-app-text-secondary hover:bg-app-hover transition-colors"
          >
            &larr; Back to {breadcrumb[breadcrumb.length - 2].name.split(' ')[0]}
          </button>
        )}
      </div>

      {/* Footer legend */}
      <div className="px-4 py-2 border-t border-app-border bg-app-card text-xs text-app-text-muted">
        Click a parent card to navigate up the ancestry tree
      </div>
    </div>
  );
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
