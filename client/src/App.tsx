import { lazy } from 'react';
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
const IntegrityPage = lazy(() => import('./components/integrity/IntegrityPage').then(m => ({ default: m.IntegrityPage })));
const AuditPage = lazy(() => import('./components/audit/AuditPage').then(m => ({ default: m.AuditPage })));
const AncestryUpdatePage = lazy(() => import('./components/ancestry-update').then(m => ({ default: m.AncestryUpdatePage })));
const TreeStatsPage = lazy(() => import('./components/stats/TreeStatsPage').then(m => ({ default: m.TreeStatsPage })));

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="tree/:dbId" element={<AncestryTreeView />} />
        <Route path="tree/:dbId/:personId" element={<AncestryTreeView />} />
        <Route path="tree/:dbId/:personId/:viewMode" element={<AncestryTreeView />} />
        <Route path="person/:dbId/:personId" element={<PersonDetail />} />
        <Route path="search/:dbId" element={<SearchPage />} />
        <Route path="path/:dbId" element={<PathFinder />} />
        <Route path="indexer" element={<IndexerPage />} />
        <Route path="providers" element={<AIProvidersPage />} />
        <Route path="providers/genealogy" element={<GenealogyProvidersPage />} />
        <Route path="providers/genealogy/new" element={<Navigate to="/providers/genealogy" replace />} />
        <Route path="providers/genealogy/:id/edit" element={<Navigate to="/providers/genealogy" replace />} />
        <Route path="providers/scraper" element={<Navigate to="/providers/genealogy" replace />} />
        <Route path="settings/browser" element={<BrowserSettingsPage />} />
        <Route path="settings/reports" element={<ReportsPage />} />
        <Route path="tools/gedcom" element={<GedcomPage />} />
        <Route path="favorites" element={<FavoritesPage />} />
        <Route path="favorites/sparse-tree/:dbId" element={<SparseTreePage />} />
        <Route path="favorites/sparse-tree/:dbId/map" element={<SparseTreeMapPage />} />
        <Route path="db/:dbId/favorites" element={<DatabaseFavoritesPage />} />
        <Route path="db/:dbId/stats" element={<TreeStatsPage />} />
        <Route path="db/:dbId/integrity" element={<IntegrityPage />} />
        <Route path="db/:dbId/integrity/:tab" element={<IntegrityPage />} />
        <Route path="db/:dbId/audit" element={<AuditPage />} />
        <Route path="db/:dbId/audit/:tab" element={<AuditPage />} />
        <Route path="db/:dbId/ancestry-update" element={<AncestryUpdatePage />} />
      </Route>
    </Routes>
  );
}

export default App;
