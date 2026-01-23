/**
 * Feature Coverage Matrix
 * Defines all features and their test status for BDD coverage reporting.
 */

export interface Feature {
  id: string;
  name: string;
  description: string;
  category: FeatureCategory;
  priority: 'critical' | 'high' | 'medium' | 'low';
  tested: boolean;
  specFile?: string;
}

export type FeatureCategory =
  | 'database-management'
  | 'person-browsing'
  | 'search'
  | 'favorites'
  | 'sparse-tree'
  | 'indexer'
  | 'providers'
  | 'export'
  | 'path-finding'
  | 'ai-features'
  | 'settings';

export const FEATURE_CATEGORIES: Record<FeatureCategory, string> = {
  'database-management': 'Database Management',
  'person-browsing': 'Person Browsing',
  'search': 'Search',
  'favorites': 'Favorites',
  'sparse-tree': 'Sparse Tree',
  'indexer': 'Indexer',
  'providers': 'Provider Integration',
  'export': 'Export',
  'path-finding': 'Path Finding',
  'ai-features': 'AI Features',
  'settings': 'Settings',
};

export const FEATURES: Feature[] = [
  // Database Management
  {
    id: 'db-list',
    name: 'List Databases',
    description: 'View list of all local databases on dashboard',
    category: 'database-management',
    priority: 'critical',
    tested: true,
    specFile: 'tests/integration/api/databases.spec.ts',
  },
  {
    id: 'db-stats',
    name: 'Database Statistics',
    description: 'View database size, person count, and other statistics',
    category: 'database-management',
    priority: 'high',
    tested: true,
    specFile: 'tests/integration/api/databases.spec.ts',
  },
  {
    id: 'db-delete',
    name: 'Delete Database',
    description: 'Remove a local database and all associated data',
    category: 'database-management',
    priority: 'medium',
    tested: false,
  },

  // Person Browsing
  {
    id: 'person-detail',
    name: 'Person Detail View',
    description: 'View detailed information about a person',
    category: 'person-browsing',
    priority: 'critical',
    tested: true,
    specFile: 'tests/integration/api/persons.spec.ts',
  },
  {
    id: 'person-parents',
    name: 'Navigate to Parents',
    description: 'Navigate from person to their parents',
    category: 'person-browsing',
    priority: 'critical',
    tested: true,
    specFile: 'tests/e2e/flows/search-browse.spec.ts',
  },
  {
    id: 'person-children',
    name: 'Navigate to Children',
    description: 'Navigate from person to their children',
    category: 'person-browsing',
    priority: 'high',
    tested: true,
    specFile: 'tests/e2e/flows/search-browse.spec.ts',
  },
  {
    id: 'person-external-ids',
    name: 'External Identities',
    description: 'View and link to external provider profiles',
    category: 'person-browsing',
    priority: 'medium',
    tested: true,
    specFile: 'tests/e2e/flows/search-browse.spec.ts',
  },

  // Search
  {
    id: 'search-name',
    name: 'Search by Name',
    description: 'Search persons by name using full-text search',
    category: 'search',
    priority: 'critical',
    tested: true,
    specFile: 'tests/integration/api/search.spec.ts',
  },
  {
    id: 'search-location',
    name: 'Filter by Location',
    description: 'Filter search results by birth/death location',
    category: 'search',
    priority: 'high',
    tested: true,
    specFile: 'tests/e2e/flows/search-browse.spec.ts',
  },
  {
    id: 'search-year-range',
    name: 'Filter by Year Range',
    description: 'Filter search results by birth/death year range',
    category: 'search',
    priority: 'high',
    tested: true,
    specFile: 'tests/e2e/flows/search-browse.spec.ts',
  },
  {
    id: 'search-pagination',
    name: 'Search Pagination',
    description: 'Navigate through paginated search results',
    category: 'search',
    priority: 'medium',
    tested: true,
    specFile: 'tests/e2e/flows/search-browse.spec.ts',
  },

  // Favorites
  {
    id: 'favorites-add',
    name: 'Add to Favorites',
    description: 'Mark a person as a favorite with notes and tags',
    category: 'favorites',
    priority: 'critical',
    tested: true,
    specFile: 'tests/integration/api/favorites.spec.ts',
  },
  {
    id: 'favorites-remove',
    name: 'Remove from Favorites',
    description: 'Unmark a person as a favorite',
    category: 'favorites',
    priority: 'high',
    tested: true,
    specFile: 'tests/e2e/flows/favorites.spec.ts',
  },
  {
    id: 'favorites-list',
    name: 'List Favorites',
    description: 'View all favorites for a database',
    category: 'favorites',
    priority: 'critical',
    tested: true,
    specFile: 'tests/integration/api/favorites.spec.ts',
  },
  {
    id: 'favorites-tags',
    name: 'Tag Favorites',
    description: 'Add and filter favorites by tags',
    category: 'favorites',
    priority: 'high',
    tested: false,
  },
  {
    id: 'favorites-persist',
    name: 'Favorites Persistence',
    description: 'Favorite status persists across sessions',
    category: 'favorites',
    priority: 'critical',
    tested: true,
    specFile: 'tests/e2e/flows/favorites.spec.ts',
  },

  // Sparse Tree
  {
    id: 'sparse-tree-view',
    name: 'Sparse Tree Visualization',
    description: 'View sparse tree with only favorited ancestors',
    category: 'sparse-tree',
    priority: 'critical',
    tested: true,
    specFile: 'tests/e2e/flows/favorites.spec.ts',
  },
  {
    id: 'sparse-tree-connect',
    name: 'Connect Ancestors',
    description: 'Show connecting ancestors between favorites',
    category: 'sparse-tree',
    priority: 'high',
    tested: true,
    specFile: 'tests/e2e/flows/favorites.spec.ts',
  },
  {
    id: 'sparse-tree-export',
    name: 'Export Sparse Tree',
    description: 'Export sparse tree as GEDCOM or image',
    category: 'sparse-tree',
    priority: 'medium',
    tested: false,
  },

  // Indexer
  {
    id: 'indexer-start',
    name: 'Start Indexing',
    description: 'Start indexing from a root person ID',
    category: 'indexer',
    priority: 'critical',
    tested: false,
  },
  {
    id: 'indexer-progress',
    name: 'Indexing Progress',
    description: 'View real-time indexing progress',
    category: 'indexer',
    priority: 'high',
    tested: false,
  },
  {
    id: 'indexer-stop',
    name: 'Stop Indexing',
    description: 'Cancel an in-progress indexing job',
    category: 'indexer',
    priority: 'medium',
    tested: false,
  },
  {
    id: 'indexer-resume',
    name: 'Resume Indexing',
    description: 'Resume indexing from where it left off',
    category: 'indexer',
    priority: 'medium',
    tested: false,
  },

  // Providers
  {
    id: 'provider-familysearch',
    name: 'FamilySearch Integration',
    description: 'Connect and sync with FamilySearch API',
    category: 'providers',
    priority: 'critical',
    tested: false,
  },
  {
    id: 'provider-ancestry',
    name: 'Ancestry Integration',
    description: 'Connect and sync with Ancestry via scraping',
    category: 'providers',
    priority: 'high',
    tested: false,
  },
  {
    id: 'provider-credentials',
    name: 'Credential Management',
    description: 'Securely store and manage provider credentials',
    category: 'providers',
    priority: 'critical',
    tested: false,
  },

  // Export
  {
    id: 'export-gedcom',
    name: 'Export to GEDCOM',
    description: 'Export database or subset to GEDCOM format',
    category: 'export',
    priority: 'high',
    tested: false,
  },
  {
    id: 'import-gedcom',
    name: 'Import from GEDCOM',
    description: 'Import GEDCOM file into local database',
    category: 'export',
    priority: 'high',
    tested: false,
  },

  // Path Finding
  {
    id: 'path-shortest',
    name: 'Shortest Path',
    description: 'Find shortest path between two persons',
    category: 'path-finding',
    priority: 'high',
    tested: true,
    specFile: 'tests/unit/lib/pathShortest.spec.ts',
  },
  {
    id: 'path-longest',
    name: 'Longest Path',
    description: 'Find longest path to detect cycles',
    category: 'path-finding',
    priority: 'medium',
    tested: true,
    specFile: 'tests/unit/lib/pathLongest.spec.ts',
  },
  {
    id: 'path-random',
    name: 'Random Path',
    description: 'Find a random path through ancestors',
    category: 'path-finding',
    priority: 'low',
    tested: true,
    specFile: 'tests/unit/lib/pathRandom.spec.ts',
  },

  // AI Features
  {
    id: 'ai-discovery',
    name: 'AI Ancestor Discovery',
    description: 'Use AI to find interesting ancestors',
    category: 'ai-features',
    priority: 'medium',
    tested: false,
  },
  {
    id: 'ai-providers',
    name: 'AI Provider Management',
    description: 'Configure AI providers and API keys',
    category: 'ai-features',
    priority: 'low',
    tested: false,
  },

  // Settings
  {
    id: 'settings-browser',
    name: 'Browser Automation Settings',
    description: 'Configure CDP connection for browser automation',
    category: 'settings',
    priority: 'medium',
    tested: false,
  },
  {
    id: 'health-check',
    name: 'Health Check Endpoint',
    description: 'API health check endpoint',
    category: 'settings',
    priority: 'critical',
    tested: true,
    specFile: 'tests/integration/api/health.spec.ts',
  },
];

// Computed statistics
export function getCoverageStats() {
  const total = FEATURES.length;
  const tested = FEATURES.filter(f => f.tested).length;
  const untested = total - tested;

  const byPriority = {
    critical: { total: 0, tested: 0 },
    high: { total: 0, tested: 0 },
    medium: { total: 0, tested: 0 },
    low: { total: 0, tested: 0 },
  };

  const byCategory: Record<string, { total: number; tested: number }> = {};

  for (const feature of FEATURES) {
    byPriority[feature.priority].total++;
    if (feature.tested) byPriority[feature.priority].tested++;

    if (!byCategory[feature.category]) {
      byCategory[feature.category] = { total: 0, tested: 0 };
    }
    byCategory[feature.category].total++;
    if (feature.tested) byCategory[feature.category].tested++;
  }

  return {
    total,
    tested,
    untested,
    percentage: Math.round((tested / total) * 100),
    byPriority,
    byCategory,
  };
}
