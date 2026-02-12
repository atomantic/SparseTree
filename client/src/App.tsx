import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './components/Dashboard';
import { AncestryTreeView } from './components/ancestry-tree';
import { PersonDetail } from './components/person/PersonDetail';
import { SearchPage } from './components/search/SearchPage';
import { PathFinder } from './components/path/PathFinder';
import { IndexerPage } from './components/indexer/IndexerPage';
import { AIProvidersPage } from './pages/AIProviders';
import { GenealogyProvidersPage } from './pages/GenealogyProviders';
import { GedcomPage } from './pages/GedcomPage';
import { BrowserSettingsPage } from './pages/BrowserSettingsPage';
import { ReportsPage } from './pages/ReportsPage';
import { FavoritesPage } from './components/favorites/FavoritesPage';
import { SparseTreePage } from './components/favorites/SparseTreePage';
import { SparseTreeMapPage } from './components/favorites/SparseTreeMapPage';
import { DatabaseFavoritesPage } from './components/favorites/DatabaseFavoritesPage';
import { IntegrityPage } from './components/integrity/IntegrityPage';
import { AncestryUpdatePage } from './components/ancestry-update';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        {/* Tree routes with view mode support */}
        <Route path="tree/:dbId" element={<AncestryTreeView />} />
        <Route path="tree/:dbId/:personId" element={<AncestryTreeView />} />
        <Route path="tree/:dbId/:personId/:viewMode" element={<AncestryTreeView />} />
        <Route path="person/:dbId/:personId" element={<PersonDetail />} />
        <Route path="search/:dbId" element={<SearchPage />} />
        <Route path="path/:dbId" element={<PathFinder />} />
        <Route path="indexer" element={<IndexerPage />} />
        <Route path="providers" element={<AIProvidersPage />} />
        <Route path="providers/genealogy" element={<GenealogyProvidersPage />} />
        {/* Redirects for removed routes */}
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
        <Route path="db/:dbId/integrity" element={<IntegrityPage />} />
        <Route path="db/:dbId/integrity/:tab" element={<IntegrityPage />} />
        <Route path="db/:dbId/ancestry-update" element={<AncestryUpdatePage />} />
      </Route>
    </Routes>
  );
}

export default App;
