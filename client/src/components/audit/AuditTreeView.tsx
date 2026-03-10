/**
 * Audit Tree View
 *
 * Generational column view with issue overlay badges.
 * Shows ancestors organized by generation with issue counts
 * and severity indicators, so users can work top-down.
 */
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  Loader2,
  ChevronRight,
  Search,
  Scan,
  Target,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import type {
  AncestryTreeResult,
  AncestryPersonCard,
  AncestryFamilyUnit,
  ExpandAncestryRequest,
  AuditIssue,
  PathResult,
} from '@fsf/shared';
import { AvatarPlaceholder } from '../avatars/AvatarPlaceholder';
import { GENDER_COLORS } from '../ancestry-tree/utils/lineageColors';

type IssueOverlay = Record<string, { count: number; maxSeverity: string; types: string[] }>;

interface AuditTreeViewProps {
  dbId: string;
  onPersonIssuesClick: (personId: string, personName?: string) => void;
}

interface GenerationPerson {
  person: AncestryPersonCard;
  slot: 'father' | 'mother';
}

interface Generation {
  level: number;
  people: (GenerationPerson | null)[];
}

const SEVERITY_RING: Record<string, string> = {
  error: 'ring-2 ring-red-500',
  warning: 'ring-2 ring-yellow-500',
  info: 'ring-2 ring-blue-400',
  hint: 'ring-1 ring-gray-500',
};

const SEVERITY_ICON: Record<string, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  hint: HelpCircle,
};

function buildGenerations(data: AncestryTreeResult, maxGen: number): Generation[] {
  const generations: Generation[] = [];

  generations.push({
    level: 0,
    people: [{ person: data.rootPerson, slot: 'father' }]
  });

  const processLevel = (level: number, units: (AncestryFamilyUnit | undefined)[]) => {
    if (level > maxGen) return;

    const people: (GenerationPerson | null)[] = [];
    const nextUnits: (AncestryFamilyUnit | undefined)[] = [];

    units.forEach((unit) => {
      if (unit?.father) {
        people.push({ person: unit.father, slot: 'father' });
        nextUnits.push(unit.fatherParentUnits?.[0]);
      } else {
        people.push(null);
        nextUnits.push(undefined);
      }

      if (unit?.mother) {
        people.push({ person: unit.mother, slot: 'mother' });
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

  if (data.parentUnits && data.parentUnits.length > 0) {
    processLevel(1, [data.parentUnits[0]]);
  }

  return generations;
}

function getGenerationLabel(level: number): { main: string; sub?: string } {
  switch (level) {
    case 0: return { main: 'Gen 0', sub: 'Self' };
    case 1: return { main: 'Gen 1', sub: 'Parents' };
    case 2: return { main: 'Gen 2', sub: 'Grandparents' };
    case 3: return { main: 'Gen 3', sub: '1st Great-Grandparents' };
    default: {
      const n = level - 2;
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      const suffix = s[(v - 20) % 10] || s[v] || s[0];
      return { main: `Gen ${level}`, sub: `${n}${suffix} Great-Grandparents` };
    }
  }
}

export function AuditTreeView({ dbId, onPersonIssuesClick }: AuditTreeViewProps) {
  const [treeData, setTreeData] = useState<AncestryTreeResult | null>(null);
  const [overlay, setOverlay] = useState<IssueOverlay>({});
  const [loading, setLoading] = useState(true);
  const [expandingNodes, setExpandingNodes] = useState<Set<string>>(new Set());

  // Path audit state
  const [pathTarget, setPathTarget] = useState('');
  const [pathAuditing, setPathAuditing] = useState(false);
  const [pathResult, setPathResult] = useState<{ path: string[]; issues: AuditIssue[] } | null>(null);
  const [pathHighlight, setPathHighlight] = useState<Set<string>>(new Set());

  // Load tree + overlay
  useEffect(() => {
    if (!dbId) return;
    setLoading(true);
    Promise.all([
      api.getDatabase(dbId).then(db =>
        api.getAncestryTree(dbId, db.rootId, 8)
      ),
      api.getAuditIssueOverlay(dbId),
    ])
      .then(([tree, issueOverlay]) => {
        setTreeData(tree);
        setOverlay(issueOverlay);
      })
      .catch(err => toast.error(`Failed to load tree: ${err.message}`))
      .finally(() => setLoading(false));
  }, [dbId]);

  const refreshOverlay = useCallback(() => {
    api.getAuditIssueOverlay(dbId).then(setOverlay).catch(() => {});
  }, [dbId]);

  const handleExpand = useCallback((request: ExpandAncestryRequest, nodeId: string) => {
    setExpandingNodes(prev => new Set(prev).add(nodeId));
    api.expandAncestryGeneration(dbId, request, 4)
      .then(familyUnit => {
        setTreeData(prev => {
          if (!prev) return prev;
          return mergeExpansion(prev, request, familyUnit);
        });
      })
      .catch(err => toast.error(`Failed to expand: ${err.message}`))
      .finally(() => {
        setExpandingNodes(prev => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      });
  }, [dbId]);

  const handlePathAudit = useCallback(() => {
    if (!pathTarget.trim() || !dbId) return;
    setPathAuditing(true);
    setPathResult(null);

    // First find the path from root to target
    api.getDatabase(dbId)
      .then(db => api.findPath(dbId, db.rootId, pathTarget.trim()))
      .then((pathData: PathResult) => {
        if (!pathData.path || pathData.path.length === 0) {
          toast.error('No path found to that person');
          setPathAuditing(false);
          return;
        }

        const personIds = pathData.path.map(p => p.id);
        setPathHighlight(new Set(personIds));

        // Now audit just those people
        return api.auditPath(dbId, personIds).then(result => {
          setPathResult({ path: personIds, issues: result.issues });
          refreshOverlay();
          toast.success(`Path audit: ${result.personsChecked} checked, ${result.issues.length} issues`);
        });
      })
      .catch(err => toast.error(`Path audit failed: ${err.message}`))
      .finally(() => setPathAuditing(false));
  }, [dbId, pathTarget, refreshOverlay]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-app-text-muted" />
      </div>
    );
  }

  if (!treeData) {
    return (
      <div className="text-center py-12 text-app-text-muted">
        <Scan size={32} className="mx-auto mb-3 opacity-50" />
        <p>No tree data available</p>
      </div>
    );
  }

  const generations = buildGenerations(treeData, treeData.maxGenerationLoaded);

  // Count issues per generation
  const genIssueCounts = generations.map(gen => {
    const people = gen.people.filter(p => p !== null) as GenerationPerson[];
    return people.reduce((sum, p) => sum + (overlay[p.person.id]?.count ?? 0), 0);
  });

  return (
    <div className="space-y-4">
      {/* Path audit controls */}
      <div className="bg-app-card border border-app-border rounded-lg p-4">
        <div className="flex items-center gap-3">
          <Target size={16} className="text-app-accent flex-shrink-0" />
          <span className="text-sm text-app-text font-medium">Path Audit</span>
          <input
            type="text"
            value={pathTarget}
            onChange={(e) => setPathTarget(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePathAudit()}
            placeholder="Person ID or name to trace path to..."
            className="flex-1 px-3 py-1.5 rounded-lg bg-app-bg border border-app-border text-app-text text-sm"
          />
          <button
            onClick={handlePathAudit}
            disabled={pathAuditing || !pathTarget.trim()}
            className="px-3 py-1.5 rounded-lg bg-app-accent text-white hover:bg-app-accent/90 transition-colors text-sm flex items-center gap-1 disabled:opacity-50"
          >
            {pathAuditing ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Audit Path
          </button>
          {pathHighlight.size > 0 && (
            <button
              onClick={() => { setPathHighlight(new Set()); setPathResult(null); }}
              className="px-3 py-1.5 rounded-lg bg-app-card border border-app-border text-app-text-muted hover:bg-app-hover transition-colors text-sm"
            >
              Clear Path
            </button>
          )}
        </div>
        {pathResult && (
          <div className="mt-2 text-xs text-app-text-muted">
            Path: {pathResult.path.length} persons &middot; {pathResult.issues.length} issues found
          </div>
        )}
      </div>

      {/* Tree columns */}
      <div className="bg-app-card border border-app-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <div className="flex min-h-[400px]">
            {generations.map((gen, genIdx) => {
              const label = getGenerationLabel(gen.level);
              const knownPeople = gen.people.filter(p => p !== null) as GenerationPerson[];
              const genIssues = genIssueCounts[genIdx];

              return (
                <div key={gen.level} className="flex flex-col border-r border-app-border min-w-fit">
                  {/* Generation header */}
                  <div className="px-4 py-2 bg-app-card border-b border-app-border sticky top-0 z-10">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-bold text-app-text uppercase tracking-wide">
                        {label.main}
                      </div>
                      {genIssues > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400">
                          {genIssues}
                        </span>
                      )}
                    </div>
                    {label.sub && (
                      <div className="text-[10px] text-app-text-muted">{label.sub}</div>
                    )}
                    <div className="text-[10px] text-app-text-subtle mt-0.5">
                      {knownPeople.length} of {Math.pow(2, gen.level)} known
                    </div>
                  </div>

                  {/* People */}
                  <div className="flex-1 p-3 flex flex-col gap-1.5">
                    {knownPeople.map((item, idx) => (
                      <AuditPersonNode
                        key={`${gen.level}-${idx}-${item.person.id}`}
                        person={item.person}
                        dbId={dbId}
                        issueData={overlay[item.person.id]}
                        isOnPath={pathHighlight.has(item.person.id)}
                        isExpanding={expandingNodes.has(item.person.id)}
                        onExpand={item.person.hasMoreAncestors ? () => {
                          const request: ExpandAncestryRequest = item.person.gender === 'female'
                            ? { motherId: item.person.id }
                            : { fatherId: item.person.id };
                          handleExpand(request, item.person.id);
                        } : undefined}
                        onIssuesClick={() => onPersonIssuesClick(item.person.id, item.person.name)}
                        size={gen.level > 3 ? 'xs' : gen.level > 2 ? 'sm' : 'md'}
                      />
                    ))}
                    {gen.level > 0 && knownPeople.length === 0 && (
                      <div className="text-xs text-app-text-muted p-2 text-center">
                        No known ancestors
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="px-4 py-2 border-t border-app-border bg-app-card text-xs text-app-text-muted flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500"></span> Error
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500"></span> Warning
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-400"></span> Info
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500"></span> Clean
          </span>
          {pathHighlight.size > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-app-accent"></span> Audited path
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Audit Person Node — person card with issue overlay
// ============================================================================

const ISSUE_TYPE_SHORT: Record<string, string> = {
  impossible_date: 'Bad date',
  parent_age_conflict: 'Parent age',
  placeholder_name: 'Placeholder',
  missing_gender: 'No gender',
  unlinked_provider: 'Unlinked provider',
  date_mismatch: 'Date mismatch',
  place_mismatch: 'Place mismatch',
  name_mismatch: 'Name mismatch',
  missing_parents: 'No parents',
  stale_record: 'Stale',
  orphaned_edge: 'Orphan',
  duplicate_suspect: 'Duplicate',
};

function AuditPersonNode({
  person,
  dbId,
  issueData,
  isOnPath,
  isExpanding,
  onExpand,
  onIssuesClick,
}: {
  person: AncestryPersonCard;
  dbId: string;
  issueData?: { count: number; maxSeverity: string; types: string[] };
  isOnPath: boolean;
  isExpanding: boolean;
  onExpand?: () => void;
  onIssuesClick: () => void;
  size: 'xs' | 'sm' | 'md';
}) {
  const genderColors = GENDER_COLORS[person.gender || 'unknown'];
  const hasIssues = issueData && issueData.count > 0;
  const severity = issueData?.maxSeverity ?? 'info';

  return (
    <div
      className={`
        rounded-lg border transition-all duration-200 overflow-hidden
        ${isOnPath ? 'ring-2 ring-app-accent' : ''}
        ${hasIssues ? SEVERITY_RING[severity] : 'border-app-border'}
      `}
      style={{ minWidth: 220, maxWidth: 280 }}
    >
      {/* Person row */}
      <div className="flex items-center gap-2 p-2 bg-app-card">
        <Link to={`/person/${dbId}/${person.id}`} className="flex-shrink-0">
          <div
            className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center"
            style={{ borderWidth: '2px', borderColor: genderColors.border }}
          >
            <AvatarPlaceholder gender={person.gender} className="w-full h-full" />
          </div>
        </Link>
        <Link to={`/person/${dbId}/${person.id}`} className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-app-text truncate">{person.name}</div>
          <div className="text-[10px] text-app-text-muted">{person.lifespan}</div>
        </Link>
        {onExpand && (
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onExpand(); }}
            disabled={isExpanding}
            className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-app-bg-secondary hover:bg-app-hover"
          >
            {isExpanding ? (
              <div className="w-3 h-3 border-2 border-app-text-muted border-t-transparent rounded-full animate-spin" />
            ) : (
              <ChevronRight className="w-3 h-3 text-app-text-secondary" />
            )}
          </button>
        )}
      </div>

      {/* Issue tags — shown inline below the person */}
      {hasIssues && (
        <button
          onClick={onIssuesClick}
          className={`w-full px-2 py-1.5 text-left border-t ${
            severity === 'error' ? 'bg-red-500/10 border-red-500/20' :
            severity === 'warning' ? 'bg-yellow-500/10 border-yellow-500/20' :
            'bg-blue-400/10 border-blue-400/20'
          }`}
        >
          <div className="flex flex-wrap gap-1">
            {issueData.types.map(type => {
              const Icon = SEVERITY_ICON[severity];
              return (
                <span
                  key={type}
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${
                    severity === 'error' ? 'bg-red-500/20 text-red-400' :
                    severity === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-blue-400/20 text-blue-400'
                  }`}
                >
                  <Icon size={8} />
                  {ISSUE_TYPE_SHORT[type] || type}
                </span>
              );
            })}
          </div>
        </button>
      )}

      {/* Clean indicator */}
      {!hasIssues && (
        <div className="px-2 py-1 border-t border-app-border/50 bg-green-500/5">
          <span className="text-[9px] text-green-500/70">Clean</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function mergeExpansion(
  tree: AncestryTreeResult,
  request: ExpandAncestryRequest,
  newUnit: AncestryFamilyUnit,
): AncestryTreeResult {
  const targetId = request.fatherId || request.motherId;
  if (!targetId) return tree;

  function mergeIntoUnits(units: AncestryFamilyUnit[] | undefined): AncestryFamilyUnit[] | undefined {
    if (!units) return units;
    return units.map(unit => {
      if (unit.father?.id === targetId) {
        return { ...unit, fatherParentUnits: [newUnit] };
      }
      if (unit.mother?.id === targetId) {
        return { ...unit, motherParentUnits: [newUnit] };
      }
      return {
        ...unit,
        fatherParentUnits: mergeIntoUnits(unit.fatherParentUnits),
        motherParentUnits: mergeIntoUnits(unit.motherParentUnits),
      };
    });
  }

  const newMaxGen = Math.max(tree.maxGenerationLoaded, newUnit.generation + 1);
  return {
    ...tree,
    parentUnits: mergeIntoUnits(tree.parentUnits),
    maxGenerationLoaded: newMaxGen,
  };
}
