import type { AncestryFamilyUnit } from '@fsf/shared';
import { PersonCard } from './PersonCard';
import { useRef, useEffect, useState } from 'react';

interface FamilyUnitCardProps {
  unit: AncestryFamilyUnit;
  dbId: string;
  onExpandFather?: () => void;
  onExpandMother?: () => void;
  loadingFather?: boolean;
  loadingMother?: boolean;
  renderParentUnits: (units: AncestryFamilyUnit[], depth: number) => JSX.Element;
  depth: number;
}

interface LinePositions {
  totalHeight: number;
  fatherY: number;
  motherY: number;
}

export function FamilyUnitCard({
  unit,
  dbId,
  onExpandFather,
  onExpandMother,
  loadingFather,
  loadingMother,
  renderParentUnits,
  depth
}: FamilyUnitCardProps) {
  const hasFatherParents = unit.fatherParentUnits && unit.fatherParentUnits.length > 0;
  const hasMotherParents = unit.motherParentUnits && unit.motherParentUnits.length > 0;
  const hasAnyParents = hasFatherParents || hasMotherParents;

  const parentSectionsRef = useRef<HTMLDivElement>(null);
  const fatherSectionRef = useRef<HTMLDivElement>(null);
  const motherSectionRef = useRef<HTMLDivElement>(null);
  const [linePositions, setLinePositions] = useState<LinePositions>({ totalHeight: 200, fatherY: 50, motherY: 150 });

  // Calculate line positions after render and on resize
  useEffect(() => {
    if (!hasAnyParents) return;

    const calculatePositions = () => {
      const parentSections = parentSectionsRef.current;
      const fatherSection = fatherSectionRef.current;
      const motherSection = motherSectionRef.current;

      if (!parentSections) return;

      const totalHeight = parentSections.offsetHeight;
      let fatherY = totalHeight / 4; // Default
      let motherY = (totalHeight * 3) / 4; // Default

      if (fatherSection) {
        fatherY = fatherSection.offsetTop + fatherSection.offsetHeight / 2;
      }

      if (motherSection) {
        motherY = motherSection.offsetTop + motherSection.offsetHeight / 2;
      }

      // If only one parent has ancestors, center the line
      if (hasFatherParents && !hasMotherParents) {
        motherY = fatherY;
      } else if (!hasFatherParents && hasMotherParents) {
        fatherY = motherY;
      }

      setLinePositions({ totalHeight, fatherY, motherY });
    };

    // Calculate after render
    const timeoutId = setTimeout(calculatePositions, 50);

    // Recalculate on window resize
    window.addEventListener('resize', calculatePositions);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', calculatePositions);
    };
  }, [hasAnyParents, hasFatherParents, hasMotherParents, unit]);

  return (
    <div className="flex items-center">
      {/* Family unit box containing father and mother */}
      <div className="flex flex-col gap-2 p-2 rounded-lg border border-app-border/50 bg-app-card/30">
        {/* Father card */}
        {unit.father && (
          <PersonCard
            person={unit.father}
            dbId={dbId}
            onExpand={unit.father.hasMoreAncestors ? onExpandFather : undefined}
            isLoading={loadingFather}
          />
        )}

        {/* Mother card */}
        {unit.mother && (
          <PersonCard
            person={unit.mother}
            dbId={dbId}
            onExpand={unit.mother.hasMoreAncestors ? onExpandMother : undefined}
            isLoading={loadingMother}
          />
        )}

        {/* Handle case where only one parent exists */}
        {!unit.father && !unit.mother && (
          <div className="p-3 text-app-text-subtle text-sm text-center min-w-[200px]">
            Unknown parents
          </div>
        )}
      </div>

      {/* Parent ancestry with connector lines */}
      {hasAnyParents && (
        <div className="flex items-stretch">
          {/* SVG connector lines */}
          <svg
            width="48"
            height={linePositions.totalHeight}
            className="flex-shrink-0"
            style={{ minHeight: `${linePositions.totalHeight}px` }}
          >
            {/* Horizontal line from family box (at vertical center of this SVG's parent row) */}
            <line
              x1="0"
              y1={linePositions.totalHeight / 2}
              x2="24"
              y2={linePositions.totalHeight / 2}
              stroke="var(--color-tree-line)"
              strokeWidth="2"
            />

            {/* Vertical trunk line - from first branch to last branch */}
            {hasFatherParents && hasMotherParents && (
              <line
                x1="24"
                y1={linePositions.fatherY}
                x2="24"
                y2={linePositions.motherY}
                stroke="var(--color-tree-line)"
                strokeWidth="2"
              />
            )}

            {/* Connect center to trunk if needed */}
            {hasFatherParents && hasMotherParents && (
              <>
                {/* If center is above the trunk top */}
                {linePositions.totalHeight / 2 < linePositions.fatherY && (
                  <line
                    x1="24"
                    y1={linePositions.totalHeight / 2}
                    x2="24"
                    y2={linePositions.fatherY}
                    stroke="var(--color-tree-line)"
                    strokeWidth="2"
                  />
                )}
                {/* If center is below the trunk bottom */}
                {linePositions.totalHeight / 2 > linePositions.motherY && (
                  <line
                    x1="24"
                    y1={linePositions.motherY}
                    x2="24"
                    y2={linePositions.totalHeight / 2}
                    stroke="var(--color-tree-line)"
                    strokeWidth="2"
                  />
                )}
              </>
            )}

            {/* Single parent case - connect center directly */}
            {(hasFatherParents !== hasMotherParents) && (
              <line
                x1="24"
                y1={linePositions.totalHeight / 2}
                x2="24"
                y2={hasFatherParents ? linePositions.fatherY : linePositions.motherY}
                stroke="var(--color-tree-line)"
                strokeWidth="2"
              />
            )}

            {/* Horizontal branch to father's parents */}
            {hasFatherParents && (
              <line
                x1="24"
                y1={linePositions.fatherY}
                x2="48"
                y2={linePositions.fatherY}
                stroke="var(--color-tree-line)"
                strokeWidth="2"
              />
            )}

            {/* Horizontal branch to mother's parents */}
            {hasMotherParents && (
              <line
                x1="24"
                y1={linePositions.motherY}
                x2="48"
                y2={linePositions.motherY}
                stroke="var(--color-tree-line)"
                strokeWidth="2"
              />
            )}
          </svg>

          {/* Parent sections container */}
          <div ref={parentSectionsRef} className="flex flex-col">
            {/* Father's ancestry section */}
            {hasFatherParents && (
              <div ref={fatherSectionRef} className="flex items-center py-4">
                {renderParentUnits(unit.fatherParentUnits!, depth + 1)}
              </div>
            )}

            {/* Mother's ancestry section */}
            {hasMotherParents && (
              <div ref={motherSectionRef} className="flex items-center py-4">
                {renderParentUnits(unit.motherParentUnits!, depth + 1)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
