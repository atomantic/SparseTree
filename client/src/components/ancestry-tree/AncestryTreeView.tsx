/**
 * Ancestry Tree View
 *
 * Main tree view component with multiple visualization modes:
 * - Fan: Radial chart with lineage colors (DEFAULT)
 * - Horizontal: Root left, ancestors right (Ancestry pedigree style)
 * - Vertical: Ancestors top, root middle (classic family tree)
 * - Columns: Horizontal generational columns (SparseTree unique)
 * - Focus: Single person navigator (SparseTree unique)
 *
 * Routes:
 * /tree/:dbId/:personId/fan        - Fan chart (default)
 * /tree/:dbId/:personId/horizontal - Horizontal pedigree
 * /tree/:dbId/:personId/vertical   - Vertical family view
 * /tree/:dbId/:personId/columns    - Generational columns
 * /tree/:dbId/:personId/focus      - Focus navigator
 */
import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate, Navigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import type { AncestryTreeResult, ExpandAncestryRequest } from '@fsf/shared';
import { api } from '../../services/api';

// View components
import { FocusNavigatorView } from './views/FocusNavigatorView';
import { VerticalFamilyView } from './views/VerticalFamilyView';
import { GenerationalColumnsView } from './views/GenerationalColumnsView';
import { HorizontalPedigreeView } from './views/HorizontalPedigreeView';
import { FanChartView } from './views/FanChartView';

// Supported view modes
export type ViewMode = 'fan' | 'horizontal' | 'vertical' | 'columns' | 'focus';

const VIEW_MODES: { id: ViewMode; label: string; icon: string; description: string }[] = [
  { id: 'fan', label: 'Fan Chart', icon: '\u{1F3AF}', description: 'Radial pedigree with lineage colors' },
  { id: 'horizontal', label: 'Horizontal', icon: '\u{27A1}\u{FE0F}', description: 'Root left, ancestors right' },
  { id: 'vertical', label: 'Vertical', icon: '\u{2B06}\u{FE0F}', description: 'Classic family tree layout' },
  { id: 'columns', label: 'Columns', icon: '\u{1F4CA}', description: 'Generations in columns' },
  { id: 'focus', label: 'Focus', icon: '\u{1F50D}', description: 'Navigate one person at a time' },
];

const DEFAULT_VIEW: ViewMode = 'fan';

export function AncestryTreeView() {
  const { dbId, personId, viewMode: urlViewMode } = useParams<{
    dbId: string;
    personId?: string;
    viewMode?: ViewMode;
  }>();
  const navigate = useNavigate();

  const [treeData, setTreeData] = useState<AncestryTreeResult | null>(null);
  const [rootId, setRootId] = useState<string | null>(personId || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandingNodes, setExpandingNodes] = useState<Set<string>>(new Set());
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);

  // Validate and normalize view mode
  const viewMode: ViewMode = urlViewMode && VIEW_MODES.find(m => m.id === urlViewMode)
    ? urlViewMode
    : DEFAULT_VIEW;

  // Get database info to find root if no personId provided
  useEffect(() => {
    if (!personId && dbId) {
      api.getDatabase(dbId)
        .then(db => setRootId(db.rootId))
        .catch(err => setError(err.message));
    }
  }, [dbId, personId]);

  // Load ancestry tree data
  useEffect(() => {
    if (!dbId || !rootId) return;

    setLoading(true);
    setError(null);

    // Load more generations for views that benefit from deeper data
    const generations = viewMode === 'columns' ? 10 :
      viewMode === 'horizontal' ? 5 :
      viewMode === 'fan' ? 6 : 8;

    api.getAncestryTree(dbId, rootId, generations)
      .then(data => setTreeData(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [dbId, rootId, viewMode]);

  // Handle expanding a node
  const handleExpand = useCallback(async (request: ExpandAncestryRequest, nodeId: string) => {
    if (!dbId || expandingNodes.has(nodeId)) return;

    setExpandingNodes(prev => new Set(prev).add(nodeId));

    const expandedData = await api.expandAncestryGeneration(dbId, request, 2).catch(err => {
      console.error('Failed to expand:', err);
      return null;
    });

    setExpandingNodes(prev => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });

    if (!expandedData || !treeData) return;

    setTreeData(prevData => {
      if (!prevData) return prevData;

      const newData = JSON.parse(JSON.stringify(prevData)) as AncestryTreeResult;

      const updateUnit = (units: typeof newData.parentUnits): boolean => {
        if (!units) return false;

        for (const unit of units) {
          if (unit.father?.id === request.fatherId) {
            if (!unit.fatherParentUnits) unit.fatherParentUnits = [];
            unit.fatherParentUnits.push(expandedData);
            if (unit.father) unit.father.hasMoreAncestors = false;
            return true;
          }

          if (unit.mother?.id === request.motherId) {
            if (!unit.motherParentUnits) unit.motherParentUnits = [];
            unit.motherParentUnits.push(expandedData);
            if (unit.mother) unit.mother.hasMoreAncestors = false;
            return true;
          }

          if (updateUnit(unit.fatherParentUnits)) return true;
          if (updateUnit(unit.motherParentUnits)) return true;
        }

        return false;
      };

      updateUnit(newData.parentUnits);
      return newData;
    });
  }, [dbId, expandingNodes, treeData]);

  // Navigate to a different view mode
  const changeViewMode = (newMode: ViewMode) => {
    const basePath = `/tree/${dbId}${rootId ? `/${rootId}` : ''}`;
    navigate(`${basePath}/${newMode}`);
    setIsViewMenuOpen(false);
  };

  // Redirect to default view if no view mode specified
  if (dbId && rootId && !urlViewMode) {
    return <Navigate to={`/tree/${dbId}/${rootId}/${DEFAULT_VIEW}`} replace />;
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-app-male border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-app-text-muted">Loading ancestry tree...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-app-error mb-4">Error: {error}</p>
          <Link to="/" className="px-4 py-2 bg-app-border text-app-text-secondary rounded hover:bg-app-hover">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // No data state
  if (!treeData) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-app-text-muted">No tree data available</p>
      </div>
    );
  }

  const currentMode = VIEW_MODES.find(m => m.id === viewMode) || VIEW_MODES[0];

  return (
    <div className="h-full flex flex-col">
      {/* Header with view switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-b border-app-border bg-app-card">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-app-text whitespace-nowrap">Ancestry Tree</h1>
          <span className="text-sm text-app-text-muted truncate">{treeData.rootPerson.name}</span>
        </div>

        {/* View mode dropdown and navigation */}
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="relative flex-1 sm:flex-initial">
            <button
              onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-3 py-2 min-h-[40px] rounded-lg bg-app-bg border border-app-border hover:bg-app-hover transition-colors"
            >
              <span>{currentMode.icon}</span>
              <span className="text-sm text-app-text">{currentMode.label}</span>
              <ChevronDown className={`w-4 h-4 text-app-text-muted transition-transform ${isViewMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown menu */}
            {isViewMenuOpen && (
              <>
                {/* Backdrop to close menu */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setIsViewMenuOpen(false)}
                />
                <div className="absolute top-full left-0 sm:left-auto sm:right-0 mt-1 w-64 max-w-[calc(100vw-2rem)] bg-app-card border border-app-border rounded-lg shadow-lg z-20 py-1">
                  {VIEW_MODES.map(mode => (
                    <button
                      key={mode.id}
                      onClick={() => changeViewMode(mode.id)}
                      className={`w-full px-4 py-3 min-h-[44px] text-left flex items-center gap-3 hover:bg-app-hover transition-colors ${
                        viewMode === mode.id ? 'bg-app-accent-subtle' : ''
                      }`}
                    >
                      <span className="text-lg">{mode.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm ${viewMode === mode.id ? 'text-app-accent font-medium' : 'text-app-text'}`}>
                          {mode.label}
                        </div>
                        <div className="text-xs text-app-text-muted truncate">{mode.description}</div>
                      </div>
                      {viewMode === mode.id && (
                        <span className="text-app-accent text-sm">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Navigation links */}
          <div className="flex gap-2">
            <Link to={`/search/${dbId}`} className="px-3 py-2 min-h-[40px] flex items-center justify-center bg-app-border text-app-text-secondary rounded hover:bg-app-hover text-sm">
              Search
            </Link>
            <Link to={`/path/${dbId}`} className="hidden sm:flex px-3 py-2 min-h-[40px] items-center justify-center bg-app-border text-app-text-secondary rounded hover:bg-app-hover text-sm">
              Find Path
            </Link>
          </div>
        </div>
      </div>

      {/* View content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'fan' && (
          <FanChartView data={treeData} dbId={dbId!} />
        )}

        {viewMode === 'horizontal' && (
          <HorizontalPedigreeView
            data={treeData}
            dbId={dbId!}
            onExpand={handleExpand}
            expandingNodes={expandingNodes}
          />
        )}

        {viewMode === 'vertical' && (
          <VerticalFamilyView
            data={treeData}
            dbId={dbId!}
            onExpand={handleExpand}
            expandingNodes={expandingNodes}
          />
        )}

        {viewMode === 'columns' && (
          <GenerationalColumnsView
            data={treeData}
            dbId={dbId!}
            onExpand={handleExpand}
            expandingNodes={expandingNodes}
          />
        )}

        {viewMode === 'focus' && (
          <FocusNavigatorView data={treeData} dbId={dbId!} />
        )}
      </div>
    </div>
  );
}
