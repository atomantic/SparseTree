import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';

const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const AncestryTreeView = lazy(() => import('./components/ancestry-tree/AncestryTreeView').then(m => ({ default: m.AncestryTreeView })));
const PersonDetail = lazy(() => import('./components/person/PersonDetail').then(m => ({ default: m.PersonDetail })));
const SearchPage = lazy(() => import('./components/search/SearchPage').then(m => ({ default: m.SearchPage })));
const PathFinder = lazy(() => import('./components/path/PathFinder').then(m => ({ default: m.PathFinder })));
const IndexerPage = lazy(() => import('./components/indexer/IndexerPage').then(m => ({ default: m.IndexerPage })));
const AIProvidersPage = lazy(() => import('./pages/AIProviders').then(m => ({ default: m.AIProvidersPage })));
const GenealogyProvidersPage = lazy(() => import('./pages/GenealogyProviders').then(m => ({ default: m.GenealogyProvidersPage })));
const GedcomPage = lazy(() => import('./pages/GedcomPage').then(m => ({ default: m.GedcomPage })));
const BrowserSettingsPage = lazy(() => import('./pages/BrowserSettingsPage').then(m => ({ default: m.BrowserSettingsPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const FavoritesPage = lazy(() => import('./components/favorites/FavoritesPage').then(m => ({ default: m.FavoritesPage })));
const SparseTreePage = lazy(() => import('./components/favorites/SparseTreePage').then(m => ({ default: m.SparseTreePage })));
const SparseTreeMapPage = lazy(() => import('./components/favorites/SparseTreeMapPage').then(m => ({ default: m.SparseTreeMapPage })));
const DatabaseFavoritesPage = lazy(() => import('./components/favorites/DatabaseFavoritesPage').then(m => ({ default: m.DatabaseFavoritesPage })));
const TreeStatsPage = lazy(() => import('./components/stats/TreeStatsPage').then(m => ({ default: m.TreeStatsPage })));
const IntegrityPage = lazy(() => import('./components/integrity/IntegrityPage').then(m => ({ default: m.IntegrityPage })));
const AuditPage = lazy(() => import('./components/audit/AuditPage').then(m => ({ default: m.AuditPage })));
const AncestryUpdatePage = lazy(() => import('./components/ancestry-update').then(m => ({ default: m.AncestryUpdatePage })));
const DeathsPage = lazy(() => import('./components/deaths/DeathsPage').then(m => ({ default: m.DeathsPage })));

function PageLoader() {
  return <div className="flex items-center justify-center py-12 text-app-text-muted">Loading...</div>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
        {/* Tree routes with view mode support */}
        <Route path="tree/:dbId" element={<Suspense fallback={<PageLoader />}><AncestryTreeView /></Suspense>} />
        <Route path="tree/:dbId/:personId" element={<Suspense fallback={<PageLoader />}><AncestryTreeView /></Suspense>} />
        <Route path="tree/:dbId/:personId/:viewMode" element={<Suspense fallback={<PageLoader />}><AncestryTreeView /></Suspense>} />
        <Route path="person/:dbId/:personId" element={<Suspense fallback={<PageLoader />}><PersonDetail /></Suspense>} />
        <Route path="search/:dbId" element={<Suspense fallback={<PageLoader />}><SearchPage /></Suspense>} />
        <Route path="path/:dbId" element={<Suspense fallback={<PageLoader />}><PathFinder /></Suspense>} />
        <Route path="indexer" element={<Suspense fallback={<PageLoader />}><IndexerPage /></Suspense>} />
        <Route path="providers" element={<Suspense fallback={<PageLoader />}><AIProvidersPage /></Suspense>} />
        <Route path="providers/genealogy" element={<Suspense fallback={<PageLoader />}><GenealogyProvidersPage /></Suspense>} />
        {/* Redirects for removed routes */}
        <Route path="providers/genealogy/new" element={<Navigate to="/providers/genealogy" replace />} />
        <Route path="providers/genealogy/:id/edit" element={<Navigate to="/providers/genealogy" replace />} />
        <Route path="providers/scraper" element={<Navigate to="/providers/genealogy" replace />} />
        <Route path="settings/browser" element={<Suspense fallback={<PageLoader />}><BrowserSettingsPage /></Suspense>} />
        <Route path="settings/reports" element={<Suspense fallback={<PageLoader />}><ReportsPage /></Suspense>} />
        <Route path="tools/gedcom" element={<Suspense fallback={<PageLoader />}><GedcomPage /></Suspense>} />
        <Route path="deaths" element={<Suspense fallback={<PageLoader />}><DeathsPage /></Suspense>} />
        <Route path="favorites" element={<Suspense fallback={<PageLoader />}><FavoritesPage /></Suspense>} />
        <Route path="favorites/sparse-tree/:dbId" element={<Suspense fallback={<PageLoader />}><SparseTreePage /></Suspense>} />
        <Route path="favorites/sparse-tree/:dbId/map" element={<Suspense fallback={<PageLoader />}><SparseTreeMapPage /></Suspense>} />
        <Route path="db/:dbId/favorites" element={<Suspense fallback={<PageLoader />}><DatabaseFavoritesPage /></Suspense>} />
        <Route path="db/:dbId/stats" element={<Suspense fallback={<PageLoader />}><TreeStatsPage /></Suspense>} />
        <Route path="db/:dbId/integrity" element={<Suspense fallback={<PageLoader />}><IntegrityPage /></Suspense>} />
        <Route path="db/:dbId/integrity/:tab" element={<Suspense fallback={<PageLoader />}><IntegrityPage /></Suspense>} />
        <Route path="db/:dbId/audit" element={<Suspense fallback={<PageLoader />}><AuditPage /></Suspense>} />
        <Route path="db/:dbId/audit/:tab" element={<Suspense fallback={<PageLoader />}><AuditPage /></Suspense>} />
        <Route path="db/:dbId/ancestry-update" element={<Suspense fallback={<PageLoader />}><AncestryUpdatePage /></Suspense>} />
      </Route>
    </Routes>
  );
}

export default App;
