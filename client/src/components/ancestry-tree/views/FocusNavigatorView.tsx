/**
 * Focus Navigator Tree View
 *
 * A navigation-focused tree view that shows one person at a time with their
 * immediate parents above. Click a parent to navigate up the ancestry tree.
 * Includes a breadcrumb trail for easy navigation back down.
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

  const isMale = (person: AncestryPersonCard) => person.gender === 'male';

  return (
    <div className="h-full flex flex-col bg-app-bg">
      {/* Breadcrumb navigation */}
      <div className="px-4 py-2 bg-app-card border-b border-app-border flex items-center gap-2 text-sm overflow-x-auto">
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

      {/* Main content area */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-8">
        {/* Parents row */}
        <div className="flex gap-8 items-end">
          {/* Father */}
          <div className="flex flex-col items-center">
            {father ? (
              <button
                onClick={() => navigateTo(father)}
                className="group flex flex-col items-center"
              >
                <div className={`w-24 h-24 rounded-full border-4 ${isMale(father) ? 'border-app-male bg-app-male/10' : 'border-app-female bg-app-female/10'} flex items-center justify-center group-hover:scale-105 transition-transform overflow-hidden`}>
                  {father.photoUrl ? (
                    <img src={father.photoUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl text-app-text-muted">{isMale(father) ? '\u{1F468}' : '\u{1F469}'}</span>
                  )}
                </div>
                <div className="mt-2 text-center">
                  <div className="font-medium text-app-text group-hover:text-app-link">{father.name}</div>
                  <div className="text-xs text-app-text-muted">{father.lifespan}</div>
                </div>
              </button>
            ) : (
              <div className="flex flex-col items-center opacity-50">
                <div className="w-24 h-24 rounded-full border-4 border-dashed border-app-border flex items-center justify-center">
                  <span className="text-2xl text-app-text-muted">?</span>
                </div>
                <div className="mt-2 text-sm text-app-text-muted">Father Unknown</div>
              </div>
            )}
            <div className="h-8 w-0.5 bg-app-border mt-2"></div>
          </div>

          {/* Mother */}
          <div className="flex flex-col items-center">
            {mother ? (
              <button
                onClick={() => navigateTo(mother)}
                className="group flex flex-col items-center"
              >
                <div className={`w-24 h-24 rounded-full border-4 ${isMale(mother) ? 'border-app-male bg-app-male/10' : 'border-app-female bg-app-female/10'} flex items-center justify-center group-hover:scale-105 transition-transform overflow-hidden`}>
                  {mother.photoUrl ? (
                    <img src={mother.photoUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl text-app-text-muted">{isMale(mother) ? '\u{1F468}' : '\u{1F469}'}</span>
                  )}
                </div>
                <div className="mt-2 text-center">
                  <div className="font-medium text-app-text group-hover:text-app-link">{mother.name}</div>
                  <div className="text-xs text-app-text-muted">{mother.lifespan}</div>
                </div>
              </button>
            ) : (
              <div className="flex flex-col items-center opacity-50">
                <div className="w-24 h-24 rounded-full border-4 border-dashed border-app-border flex items-center justify-center">
                  <span className="text-2xl text-app-text-muted">?</span>
                </div>
                <div className="mt-2 text-sm text-app-text-muted">Mother Unknown</div>
              </div>
            )}
            <div className="h-8 w-0.5 bg-app-border mt-2"></div>
          </div>
        </div>

        {/* Connecting line to focused person */}
        <div className="flex items-center gap-0">
          <div className="w-16 h-0.5 bg-app-border"></div>
          <div className="w-3 h-3 rounded-full bg-app-border"></div>
          <div className="w-16 h-0.5 bg-app-border"></div>
        </div>

        {/* Focused person card */}
        <div className={`relative p-6 rounded-2xl border-4 ${isMale(focused.person) ? 'border-app-male bg-app-male/5' : 'border-app-female bg-app-female/5'} shadow-lg max-w-md`}>
          <div className="flex items-start gap-4">
            <div className={`w-20 h-20 rounded-full border-4 ${isMale(focused.person) ? 'border-app-male' : 'border-app-female'} flex items-center justify-center flex-shrink-0 overflow-hidden`}>
              {focused.person.photoUrl ? (
                <img src={focused.person.photoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl text-app-text-muted">{isMale(focused.person) ? '\u{1F468}' : '\u{1F469}'}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-app-text">{focused.person.name}</h2>
              <div className="text-sm text-app-text-muted mt-1">{focused.person.lifespan}</div>
              <div className="mt-2">
                <Link
                  to={`/person/${dbId}/${focused.person.id}`}
                  className="text-xs text-app-link hover:underline"
                >
                  View full profile &rarr;
                </Link>
              </div>
            </div>
          </div>
        </div>

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
    </div>
  );
}
