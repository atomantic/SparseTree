import type {
  DatabaseInfo,
  PersonWithId,
  SearchResult,
  SearchParams,
  PathResult,
  TreeNode,
  IndexerStatus,
  IndexOptions,
  PersonAugmentation,
  GenealogyProviderConfig,
  GenealogyProviderRegistry,
  ProviderPersonMapping,
  PlatformType,
  GenealogyAuthType,
  FavoriteData,
  FavoritesList,
  FavoriteWithPerson,
  SparseTreeResult,
  AncestryTreeResult,
  AncestryFamilyUnit,
  ExpandAncestryRequest,
  BuiltInProvider,
  ProviderSessionStatus,
  UserProviderConfig,
  ProviderComparison,
  ScrapedPersonData,
  CredentialsStatus,
  MultiPlatformComparison,
  ProviderCache,
  DiscoverParentsResult,
  DiscoverAncestorsResult,
} from '@fsf/shared';

const BASE_URL = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed');
  }

  return data.data;
}

export const api = {
  // Databases (Roots)
  listDatabases: () => fetchJson<DatabaseInfo[]>('/databases'),

  getDatabase: (id: string) => fetchJson<DatabaseInfo>(`/databases/${id}`),

  createRoot: (personId: string, maxGenerations?: number) =>
    fetchJson<DatabaseInfo>('/databases', {
      method: 'POST',
      body: JSON.stringify({ personId, maxGenerations })
    }),

  updateRoot: (id: string, maxGenerations?: number | null) =>
    fetchJson<DatabaseInfo>(`/databases/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ maxGenerations })
    }),

  refreshRootCount: (id: string) =>
    fetchJson<{ message: string }>(`/databases/${id}/refresh`, { method: 'POST' }),

  calculateGenerations: (id: string) =>
    fetchJson<{ message: string }>(`/databases/${id}/calculate-generations`, { method: 'POST' }),

  deleteDatabase: (id: string) =>
    fetchJson<void>(`/databases/${id}`, { method: 'DELETE' }),

  // Persons
  listPersons: (dbId: string, page = 1, limit = 50) =>
    fetchJson<SearchResult>(`/persons/${dbId}?page=${page}&limit=${limit}`),

  getPerson: (dbId: string, personId: string) =>
    fetchJson<PersonWithId>(`/persons/${dbId}/${personId}`),

  getPersonTree: (dbId: string, personId: string, depth = 5, direction = 'ancestors') =>
    fetchJson<TreeNode>(`/persons/${dbId}/${personId}/tree?depth=${depth}&direction=${direction}`),

  // Get external identities (FamilySearch, Ancestry, etc.) for a person
  getIdentities: (dbId: string, personId: string) =>
    fetchJson<{
      canonicalId: string;
      identities: Array<{
        source: string;
        externalId: string;
        url?: string;
      }>;
    }>(`/persons/${dbId}/${personId}/identities`),

  // Link an external identity to a person
  linkIdentity: (dbId: string, personId: string, source: string, externalId: string, url?: string) =>
    fetchJson<{ canonicalId: string; source: string; externalId: string }>(
      `/persons/${dbId}/${personId}/link`,
      {
        method: 'POST',
        body: JSON.stringify({ source, externalId, url })
      }
    ),

  // Sync person from FamilySearch (check for merges/redirects)
  syncFromFamilySearch: (dbId: string, personId: string) =>
    fetchJson<SyncFromFamilySearchResult>(
      `/persons/${dbId}/${personId}/sync`,
      { method: 'POST' }
    ),

  // Compare local data with FamilySearch for upload
  compareForUpload: (dbId: string, personId: string) =>
    fetchJson<UploadComparisonResult>(
      `/sync/${dbId}/${personId}/compare-for-upload`
    ),

  // Refresh person data from FamilySearch API
  refreshFromFamilySearch: (dbId: string, personId: string) =>
    fetchJson<RefreshFromFamilySearchResult>(
      `/sync/${dbId}/${personId}/refresh-from-familysearch`,
      { method: 'POST' }
    ),

  // Upload selected fields to FamilySearch
  uploadToFamilySearch: (dbId: string, personId: string, fields: string[]) =>
    fetchJson<UploadToFamilySearchResult>(
      `/sync/${dbId}/${personId}/upload-to-familysearch`,
      {
        method: 'POST',
        body: JSON.stringify({ fields })
      }
    ),

  // Compare local photo with Ancestry for upload
  compareForAncestryUpload: (dbId: string, personId: string) =>
    fetchJson<{ photo: PhotoComparison }>(
      `/sync/${dbId}/${personId}/compare-for-ancestry-upload`
    ),

  // Upload photo to Ancestry
  uploadToAncestry: (dbId: string, personId: string, fields: string[]) =>
    fetchJson<UploadToFamilySearchResult>(
      `/sync/${dbId}/${personId}/upload-to-ancestry`,
      {
        method: 'POST',
        body: JSON.stringify({ fields })
      }
    ),

  // Local Overrides - Get all overrides for a person
  getPersonOverrides: (dbId: string, personId: string) =>
    fetchJson<PersonOverrides>(`/persons/${dbId}/${personId}/overrides`),

  // Local Overrides - Set or update an override
  setPersonOverride: (dbId: string, personId: string, data: SetOverrideRequest) =>
    fetchJson<LocalOverride>(`/persons/${dbId}/${personId}/override`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  // Local Overrides - Remove an override (revert to original)
  revertPersonOverride: (dbId: string, personId: string, data: RevertOverrideRequest) =>
    fetchJson<{ removed: boolean }>(`/persons/${dbId}/${personId}/override`, {
      method: 'DELETE',
      body: JSON.stringify(data)
    }),

  // Claims - Get all claims for a person
  getPersonClaims: (dbId: string, personId: string, predicate?: string) =>
    fetchJson<PersonClaim[]>(`/persons/${dbId}/${personId}/claims${predicate ? `?predicate=${predicate}` : ''}`),

  // Claims - Add a new claim
  addPersonClaim: (dbId: string, personId: string, predicate: string, value: string) =>
    fetchJson<{ claimId: string }>(`/persons/${dbId}/${personId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ predicate, value })
    }),

  // Claims - Update a claim
  updatePersonClaim: (dbId: string, personId: string, claimId: string, value: string) =>
    fetchJson<{ updated: boolean }>(`/persons/${dbId}/${personId}/claim/${claimId}`, {
      method: 'PUT',
      body: JSON.stringify({ value })
    }),

  // Claims - Delete a claim
  deletePersonClaim: (dbId: string, personId: string, claimId: string) =>
    fetchJson<{ deleted: boolean }>(`/persons/${dbId}/${personId}/claim/${claimId}`, {
      method: 'DELETE'
    }),

  // Search
  search: (dbId: string, params: SearchParams) => {
    const searchParams = new URLSearchParams();
    if (params.q) searchParams.set('q', params.q);
    if (params.location) searchParams.set('location', params.location);
    if (params.occupation) searchParams.set('occupation', params.occupation);
    if (params.birthAfter) searchParams.set('birthAfter', params.birthAfter);
    if (params.birthBefore) searchParams.set('birthBefore', params.birthBefore);
    if (params.generationMin !== undefined) searchParams.set('generationMin', params.generationMin.toString());
    if (params.generationMax !== undefined) searchParams.set('generationMax', params.generationMax.toString());
    if (params.hasPhoto) searchParams.set('hasPhoto', 'true');
    if (params.hasBio) searchParams.set('hasBio', 'true');
    if (params.page) searchParams.set('page', params.page.toString());
    if (params.limit) searchParams.set('limit', params.limit.toString());
    return fetchJson<SearchResult>(`/search/${dbId}?${searchParams}`);
  },

  // Path finding
  findPath: (dbId: string, source: string, target: string, method = 'shortest') =>
    fetchJson<PathResult>(`/path/${dbId}`, {
      method: 'POST',
      body: JSON.stringify({ source, target, method })
    }),

  // Indexer
  getIndexerStatus: () => fetchJson<IndexerStatus>('/indexer/status'),

  startIndexing: (options: IndexOptions) =>
    fetchJson<IndexerStatus>('/indexer/start', {
      method: 'POST',
      body: JSON.stringify(options)
    }),

  stopIndexing: () =>
    fetchJson<void>('/indexer/stop', { method: 'POST' }),

  // Export URLs (direct download)
  getExportTsvUrl: (dbId: string) => `${BASE_URL}/export/${dbId}/tsv`,
  getExportJsonUrl: (dbId: string) => `${BASE_URL}/export/${dbId}/json`,

  // Browser automation
  getBrowserStatus: () => fetchJson<BrowserStatus>('/browser/status'),

  getBrowserConfig: () => fetchJson<BrowserConfig>('/browser/config'),

  updateBrowserConfig: (config: Partial<BrowserConfig>) =>
    fetchJson<BrowserConfig>('/browser/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    }),

  launchBrowser: () =>
    fetchJson<{ success: boolean; message: string }>('/browser/launch', { method: 'POST' }),

  checkBrowserRunning: () =>
    fetchJson<{ running: boolean }>('/browser/running'),

  connectBrowser: (cdpUrl?: string) =>
    fetchJson<BrowserStatus>('/browser/connect', {
      method: 'POST',
      body: JSON.stringify({ cdpUrl })
    }),

  disconnectBrowser: () =>
    fetchJson<{ connected: false }>('/browser/disconnect', { method: 'POST' }),

  openFamilySearchLogin: () =>
    fetchJson<{ url: string; isLoggedIn: boolean; message: string }>('/browser/login', {
      method: 'POST'
    }),

  scrapePerson: (personId: string) =>
    fetchJson<LegacyScrapedPersonData>(`/browser/scrape/${personId}`, { method: 'POST' }),

  getScrapedData: (personId: string) =>
    fetchJson<LegacyScrapedPersonData>(`/browser/scraped/${personId}`),

  hasPhoto: (personId: string) =>
    fetchJson<{ exists: boolean }>(`/browser/photos/${personId}/exists`),

  getPhotoUrl: (personId: string) => `${BASE_URL}/browser/photos/${personId}`,

  // Augmentation (Wikipedia, custom data)
  getAugmentation: (personId: string) =>
    fetchJson<PersonAugmentation>(`/augment/${personId}`),

  linkWikipedia: (personId: string, url: string) =>
    fetchJson<PersonAugmentation>(`/augment/${personId}/wikipedia`, {
      method: 'POST',
      body: JSON.stringify({ url })
    }),

  updateAugmentation: (personId: string, data: Partial<PersonAugmentation>) =>
    fetchJson<PersonAugmentation>(`/augment/${personId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  hasWikiPhoto: (personId: string) =>
    fetchJson<{ exists: boolean }>(`/augment/${personId}/wiki-photo/exists`),

  getWikiPhotoUrl: (personId: string) => `${BASE_URL}/augment/${personId}/wiki-photo`,

  // Ancestry linking
  linkAncestry: (personId: string, url: string) =>
    fetchJson<PersonAugmentation>(`/augment/${personId}/ancestry`, {
      method: 'POST',
      body: JSON.stringify({ url })
    }),

  hasAncestryPhoto: (personId: string) =>
    fetchJson<{ exists: boolean }>(`/augment/${personId}/ancestry-photo/exists`),

  getAncestryPhotoUrl: (personId: string) => `${BASE_URL}/augment/${personId}/ancestry-photo`,

  // WikiTree linking
  linkWikiTree: (personId: string, url: string) =>
    fetchJson<PersonAugmentation>(`/augment/${personId}/wikitree`, {
      method: 'POST',
      body: JSON.stringify({ url })
    }),

  hasWikiTreePhoto: (personId: string) =>
    fetchJson<{ exists: boolean }>(`/augment/${personId}/wikitree-photo/exists`),

  getWikiTreePhotoUrl: (personId: string) => `${BASE_URL}/augment/${personId}/wikitree-photo`,

  // LinkedIn linking
  linkLinkedIn: (personId: string, url: string) =>
    fetchJson<PersonAugmentation>(`/augment/${personId}/linkedin`, {
      method: 'POST',
      body: JSON.stringify({ url })
    }),

  hasLinkedInPhoto: (personId: string) =>
    fetchJson<{ exists: boolean }>(`/augment/${personId}/linkedin-photo/exists`),

  getLinkedInPhotoUrl: (personId: string) => `${BASE_URL}/augment/${personId}/linkedin-photo`,

  // Fetch photo from linked platform
  fetchPhotoFromPlatform: (personId: string, platform: string) =>
    fetchJson<PersonAugmentation>(`/augment/${personId}/fetch-photo/${platform}`, {
      method: 'POST'
    }),

  // Genealogy Providers
  listGenealogyProviders: () =>
    fetchJson<GenealogyProviderRegistry>('/genealogy-providers'),

  getGenealogyProvider: (id: string) =>
    fetchJson<GenealogyProviderConfig>(`/genealogy-providers/${id}`),

  createGenealogyProvider: (config: Partial<GenealogyProviderConfig>) =>
    fetchJson<GenealogyProviderConfig>('/genealogy-providers', {
      method: 'POST',
      body: JSON.stringify(config)
    }),

  updateGenealogyProvider: (id: string, config: Partial<GenealogyProviderConfig>) =>
    fetchJson<GenealogyProviderConfig>(`/genealogy-providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(config)
    }),

  deleteGenealogyProvider: (id: string) =>
    fetchJson<{ deleted: string }>(`/genealogy-providers/${id}`, { method: 'DELETE' }),

  testGenealogyProviderConnection: (id: string) =>
    fetchJson<{ success: boolean; message: string }>(`/genealogy-providers/${id}/test`, {
      method: 'POST'
    }),

  activateGenealogyProvider: (id: string) =>
    fetchJson<{ activeProvider: string }>(`/genealogy-providers/${id}/activate`, {
      method: 'POST'
    }),

  deactivateGenealogyProvider: () =>
    fetchJson<{ activeProvider: null }>('/genealogy-providers/deactivate', {
      method: 'POST'
    }),

  getGenealogyProviderDefaults: (platform: PlatformType) =>
    fetchJson<Partial<GenealogyProviderConfig>>(`/genealogy-providers/defaults/${platform}`),

  listGenealogyPlatforms: () =>
    fetchJson<Array<{ platform: PlatformType; name: string; authType: GenealogyAuthType }>>('/genealogy-providers/platforms'),

  // Provider person linking
  linkPersonToProvider: (personId: string, data: {
    providerId: string;
    platform: PlatformType;
    url: string;
    externalId?: string;
    confidence?: 'high' | 'medium' | 'low';
    matchedBy?: 'manual' | 'auto' | 'imported';
  }) =>
    fetchJson<PersonAugmentation>(`/augment/${personId}/provider-link`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  unlinkPersonFromProvider: (personId: string, providerId: string) =>
    fetchJson<PersonAugmentation>(`/augment/${personId}/provider-link/${providerId}`, {
      method: 'DELETE'
    }),

  getPersonProviderLinks: (personId: string) =>
    fetchJson<ProviderPersonMapping[]>(`/augment/${personId}/provider-links`),

  // Favorites - Global (legacy, all databases)
  listFavorites: (page = 1, limit = 50) =>
    fetchJson<FavoritesList>(`/favorites?page=${page}&limit=${limit}`),

  getFavorite: (personId: string) =>
    fetchJson<FavoriteData | null>(`/favorites/${personId}`),

  addFavorite: (personId: string, whyInteresting: string, tags: string[] = []) =>
    fetchJson<PersonAugmentation>(`/favorites/${personId}`, {
      method: 'POST',
      body: JSON.stringify({ whyInteresting, tags })
    }),

  updateFavorite: (personId: string, whyInteresting: string, tags: string[] = []) =>
    fetchJson<PersonAugmentation>(`/favorites/${personId}`, {
      method: 'PUT',
      body: JSON.stringify({ whyInteresting, tags })
    }),

  removeFavorite: (personId: string) =>
    fetchJson<PersonAugmentation>(`/favorites/${personId}`, { method: 'DELETE' }),

  getFavoritesInDatabase: (dbId: string) =>
    fetchJson<FavoriteWithPerson[]>(`/favorites/in-database/${dbId}`),

  getFavoriteTags: () =>
    fetchJson<{ presetTags: string[]; allTags: string[] }>('/favorites/tags'),

  getSparseTree: (dbId: string) =>
    fetchJson<SparseTreeResult>(`/favorites/sparse-tree/${dbId}`),

  // Favorites - Database-scoped (new)
  listDbFavorites: (dbId: string, page = 1, limit = 50) =>
    fetchJson<FavoritesList>(`/favorites/db/${dbId}?page=${page}&limit=${limit}`),

  getDbFavorite: (dbId: string, personId: string) =>
    fetchJson<FavoriteData | null>(`/favorites/db/${dbId}/${personId}`),

  addDbFavorite: (dbId: string, personId: string, whyInteresting: string, tags: string[] = []) =>
    fetchJson<{ favorite: FavoriteData }>(`/favorites/db/${dbId}/${personId}`, {
      method: 'POST',
      body: JSON.stringify({ whyInteresting, tags })
    }),

  updateDbFavorite: (dbId: string, personId: string, whyInteresting: string, tags: string[] = []) =>
    fetchJson<{ favorite: FavoriteData }>(`/favorites/db/${dbId}/${personId}`, {
      method: 'PUT',
      body: JSON.stringify({ whyInteresting, tags })
    }),

  removeDbFavorite: (dbId: string, personId: string) =>
    fetchJson<{ removed: boolean }>(`/favorites/db/${dbId}/${personId}`, { method: 'DELETE' }),

  getDbFavoriteTags: (dbId: string) =>
    fetchJson<{ presetTags: string[]; allTags: string[] }>(`/favorites/db/${dbId}/tags`),

  getDbSparseTree: (dbId: string) =>
    fetchJson<SparseTreeResult>(`/favorites/db/${dbId}/sparse-tree`),

  // Ancestry Tree (FamilySearch-style visualization)
  getAncestryTree: (dbId: string, personId: string, depth = 4) =>
    fetchJson<AncestryTreeResult>(`/ancestry-tree/${dbId}/${personId}?depth=${depth}`),

  expandAncestryGeneration: (dbId: string, request: ExpandAncestryRequest, depth = 2) =>
    fetchJson<AncestryFamilyUnit>(`/ancestry-tree/${dbId}/expand?depth=${depth}`, {
      method: 'POST',
      body: JSON.stringify(request)
    }),

  // Built-in Providers (browser-based)
  listProviders: () =>
    fetchJson<{
      providers: Array<{
        provider: BuiltInProvider;
        displayName: string;
        loginUrl: string;
        treeUrlPattern: string;
        supportsMultipleTrees: boolean;
        rateLimitDefaults: { minDelayMs: number; maxDelayMs: number };
        config: UserProviderConfig;
      }>;
      registry: { providers: Record<BuiltInProvider, UserProviderConfig>; lastUpdated: string };
      browserConnected: boolean;
    }>('/scrape-providers'),

  getProvider: (provider: BuiltInProvider) =>
    fetchJson<{ config: UserProviderConfig; info: unknown }>(`/scrape-providers/${provider}`),

  updateProvider: (provider: BuiltInProvider, updates: Partial<UserProviderConfig>) =>
    fetchJson<UserProviderConfig>(`/scrape-providers/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    }),

  toggleProvider: (provider: BuiltInProvider, enabled: boolean) =>
    fetchJson<UserProviderConfig>(`/scrape-providers/${provider}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled })
    }),

  toggleBrowserScrape: (provider: BuiltInProvider, enabled: boolean) =>
    fetchJson<UserProviderConfig>(`/scrape-providers/${provider}/toggle-browser-scrape`, {
      method: 'POST',
      body: JSON.stringify({ enabled })
    }),

  confirmBrowserLogin: (provider: BuiltInProvider, loggedIn: boolean) =>
    fetchJson<UserProviderConfig>(`/scrape-providers/${provider}/confirm-browser-login`, {
      method: 'POST',
      body: JSON.stringify({ loggedIn })
    }),

  checkProviderSession: (provider: BuiltInProvider) =>
    fetchJson<ProviderSessionStatus>(`/scrape-providers/${provider}/check-session`, {
      method: 'POST'
    }),

  checkAllProviderSessions: () =>
    fetchJson<Record<BuiltInProvider, ProviderSessionStatus>>('/scrape-providers/check-all-sessions', {
      method: 'POST'
    }),

  openProviderLogin: (provider: BuiltInProvider) =>
    fetchJson<{ url: string }>(`/scrape-providers/${provider}/login`, {
      method: 'POST'
    }),

  openProviderLoginGoogle: (provider: BuiltInProvider) =>
    fetchJson<{ url: string }>(`/scrape-providers/${provider}/login-google`, {
      method: 'POST'
    }),

  listProviderTrees: (provider: BuiltInProvider) =>
    fetchJson<Array<{ provider: BuiltInProvider; treeId: string; treeName: string }>>(`/scrape-providers/${provider}/trees`),

  setProviderDefaultTree: (provider: BuiltInProvider, treeId?: string) =>
    fetchJson<UserProviderConfig>(`/scrape-providers/${provider}/default-tree`, {
      method: 'POST',
      body: JSON.stringify({ treeId })
    }),

  updateProviderRateLimits: (provider: BuiltInProvider, minDelayMs: number, maxDelayMs: number) =>
    fetchJson<UserProviderConfig>(`/scrape-providers/${provider}/rate-limit`, {
      method: 'PUT',
      body: JSON.stringify({ minDelayMs, maxDelayMs })
    }),

  scrapeFromProvider: (provider: BuiltInProvider, personId: string) =>
    fetchJson<ScrapedPersonData>(`/scrape-providers/${provider}/scrape/${personId}`, {
      method: 'POST'
    }),

  // Provider Credentials
  saveProviderCredentials: (provider: BuiltInProvider, credentials: { email?: string; username?: string; password: string }) =>
    fetchJson<CredentialsStatus>(`/scrape-providers/${provider}/credentials`, {
      method: 'POST',
      body: JSON.stringify(credentials)
    }),

  getProviderCredentialsStatus: (provider: BuiltInProvider) =>
    fetchJson<CredentialsStatus>(`/scrape-providers/${provider}/credentials`),

  deleteProviderCredentials: (provider: BuiltInProvider) =>
    fetchJson<{ deleted: boolean }>(`/scrape-providers/${provider}/credentials`, {
      method: 'DELETE'
    }),

  toggleAutoLogin: (provider: BuiltInProvider, enabled: boolean, method?: 'credentials' | 'google') =>
    fetchJson<UserProviderConfig>(`/scrape-providers/${provider}/toggle-auto-login`, {
      method: 'POST',
      body: JSON.stringify({ enabled, method })
    }),

  triggerAutoLogin: (provider: BuiltInProvider) =>
    fetchJson<{ loggedIn: boolean }>(`/scrape-providers/${provider}/auto-login`, {
      method: 'POST'
    }),

  // GEDCOM Import/Export
  getGedcomExportUrl: (dbId: string) => `${BASE_URL}/gedcom/export/${dbId}`,

  importGedcom: (content: string, dbName: string) =>
    fetchJson<{ dbId: string; personCount: number }>('/gedcom/import', {
      method: 'POST',
      body: JSON.stringify({ content, dbName })
    }),

  validateGedcom: (content: string) =>
    fetchJson<{ valid: boolean; errors: string[] }>('/gedcom/validate', {
      method: 'POST',
      body: JSON.stringify({ content })
    }),

  previewGedcom: (content: string) =>
    fetchJson<{
      header: { source?: string; version?: string };
      individualCount: number;
      familyCount: number;
      sampleIndividuals: Array<{ id: string; name: string; birthDate?: string; deathDate?: string }>;
    }>('/gedcom/preview', {
      method: 'POST',
      body: JSON.stringify({ content })
    }),

  // Sync
  compareAcrossProviders: (dbId: string, personId: string) =>
    fetchJson<ProviderComparison>(`/sync/${dbId}/${personId}/compare`),

  importPersonFromProvider: (dbId: string, personId: string, provider: BuiltInProvider, externalId?: string) =>
    fetchJson<unknown>(`/sync/${dbId}/${personId}/import`, {
      method: 'POST',
      body: JSON.stringify({ provider, externalId })
    }),

  pushToProvider: (dbId: string, personId: string, provider: BuiltInProvider) =>
    fetchJson<{ editUrl: string }>(`/sync/${dbId}/${personId}/push`, {
      method: 'POST',
      body: JSON.stringify({ provider })
    }),

  findMatchOnProvider: (dbId: string, personId: string, provider: BuiltInProvider) =>
    fetchJson<ScrapedPersonData | null>(`/sync/${dbId}/${personId}/find-match`, {
      method: 'POST',
      body: JSON.stringify({ provider })
    }),

  startDatabaseSync: (dbId: string, provider: BuiltInProvider, direction: 'import' | 'export' | 'both' = 'import') =>
    fetchJson<{ message: string; progressUrl: string }>(`/sync/database/${dbId}`, {
      method: 'POST',
      body: JSON.stringify({ provider, direction })
    }),

  // Multi-Platform Comparison
  getMultiPlatformComparison: (dbId: string, personId: string) =>
    fetchJson<MultiPlatformComparison>(`/sync/${dbId}/${personId}/multi-platform-compare`),

  refreshFromProvider: (dbId: string, personId: string, provider: BuiltInProvider) =>
    fetchJson<ProviderCache | null>(`/sync/${dbId}/${personId}/refresh-provider/${provider}`, {
      method: 'POST',
    }),

  // Parent Discovery
  discoverParentIds: (dbId: string, personId: string, provider: BuiltInProvider) =>
    fetchJson<DiscoverParentsResult>(`/sync/${dbId}/${personId}/discover-parents/${provider}`, {
      method: 'POST',
    }),

  discoverAncestorIds: (dbId: string, personId: string, provider: BuiltInProvider, maxGenerations?: number) =>
    fetchJson<DiscoverAncestorsResult>(`/sync/${dbId}/${personId}/discover-ancestors/${provider}`, {
      method: 'POST',
      body: JSON.stringify({ maxGenerations }),
    }),

  // AI Discovery
  quickDiscovery: (dbId: string, sampleSize = 100, options?: { model?: string; excludeBiblical?: boolean; minBirthYear?: number; customPrompt?: string }) =>
    fetchJson<DiscoveryResult>(`/ai-discovery/${dbId}/quick`, {
      method: 'POST',
      body: JSON.stringify({ sampleSize, ...options })
    }),

  startDiscovery: (dbId: string, options?: { batchSize?: number; maxPersons?: number; model?: string }) =>
    fetchJson<{ runId: string; message: string }>(`/ai-discovery/${dbId}/start`, {
      method: 'POST',
      body: JSON.stringify(options || {})
    }),

  getDiscoveryProgress: (runId: string) =>
    fetchJson<DiscoveryProgress>(`/ai-discovery/progress/${runId}`),

  applyDiscoveryCandidate: (dbId: string, personId: string, whyInteresting: string, tags: string[]) =>
    fetchJson<{ applied: boolean }>(`/ai-discovery/${dbId}/apply`, {
      method: 'POST',
      body: JSON.stringify({ personId, whyInteresting, tags })
    }),

  applyDiscoveryBatch: (dbId: string, candidates: DiscoveryCandidate[]) =>
    fetchJson<{ applied: number }>(`/ai-discovery/${dbId}/apply-batch`, {
      method: 'POST',
      body: JSON.stringify({ candidates })
    }),

  // Test Runner
  getTestRunnerStatus: () =>
    fetchJson<TestRun | null>('/test-runner/status'),

  getTestReportStatus: () =>
    fetchJson<{ e2e: boolean; featureCoverage: boolean; codeCoverage: boolean }>('/test-runner/reports'),

  runTests: (type: 'unit' | 'e2e' | 'feature-coverage' | 'code-coverage') =>
    fetchJson<{ message: string; status: TestRun | null }>(`/test-runner/run/${type}`, {
      method: 'POST'
    }),

  stopTests: () =>
    fetchJson<{ stopped: boolean }>('/test-runner/stop', {
      method: 'POST'
    })
};

// Test Runner types
export interface TestRun {
  id: string;
  type: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  startTime: string;
  endTime?: string;
  exitCode?: number;
}

// Browser types
export interface BrowserStatus {
  connected: boolean;
  cdpUrl: string;
  cdpPort: number;
  pageCount: number;
  pages: Array<{ url: string; title: string }>;
  familySearchLoggedIn: boolean;
  browserProcessRunning: boolean;
  autoConnect: boolean;
}

export interface BrowserConfig {
  cdpPort: number;
  autoConnect: boolean;
}

// AI Discovery types
export interface DiscoveryCandidate {
  personId: string;
  externalId?: string;
  name: string;
  lifespan: string;
  birthPlace?: string;
  deathPlace?: string;
  occupations?: string[];
  bio?: string;
  whyInteresting: string;
  suggestedTags: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface DiscoveryResult {
  dbId: string;
  candidates: DiscoveryCandidate[];
  totalAnalyzed: number;
  runId: string;
}

export interface DiscoveryProgress {
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalPersons: number;
  analyzedPersons: number;
  candidatesFound: number;
  currentBatch: number;
  totalBatches: number;
  error?: string;
}

// FamilySearch sync result
export interface SyncFromFamilySearchResult {
  canonicalId: string;
  originalFsId: string;
  currentFsId: string;
  wasRedirected: boolean;
  isDeleted?: boolean;
  newFsId?: string;
  survivingPersonName?: string;
}

// FamilySearch refresh result (from API instead of scraping)
export interface RefreshFromFamilySearchResult {
  success: boolean;
  wasRedirected?: boolean;
  originalFsId?: string;
  currentFsId?: string;
  newFsId?: string;
  error?: string;
  lastRefreshed?: string;
}

// FamilySearch upload comparison types
export interface FieldDifference {
  field: string;           // 'name', 'birthDate', 'alternateNames', etc.
  label: string;           // Human-readable label
  localValue: string | string[] | null;
  fsValue: string | string[] | null;
  canUpload: boolean;      // Whether this field can be pushed to FS
}

export interface PhotoComparison {
  localPhotoUrl: string | null;
  localPhotoPath: string | null;
  fsHasPhoto: boolean;
  photoDiffers: boolean;
}

export interface UploadComparisonResult {
  differences: FieldDifference[];
  photo: PhotoComparison;
  fsData: {
    name: string;
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
    alternateNames: string[];
  };
  localData: {
    name: string;
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
    alternateNames: string[];
  };
}

export interface UploadToFamilySearchRequest {
  fields: string[];  // Selected fields to upload
}

export interface UploadToFamilySearchResult {
  success: boolean;
  uploaded: string[];
  errors: Array<{ field: string; error: string }>;
}

// Legacy scraped data format (from browser scraper.service.ts)
export interface LegacyScrapedPersonData {
  id: string;
  photoUrl?: string;
  photoPath?: string;
  fullName?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  scrapedAt: string;
}

// Local Override types
export interface LocalOverride {
  overrideId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  originalValue: string | null;
  overrideValue: string | null;
  reason?: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonOverrides {
  personOverrides: LocalOverride[];
  eventOverrides: LocalOverride[];
  claimOverrides: LocalOverride[];
}

export interface SetOverrideRequest {
  entityType: 'person' | 'vital_event' | 'claim';
  entityId?: string;
  fieldName: string;
  value: string | null;
  originalValue: string | null;
  reason?: string;
  source?: string;
}

export interface RevertOverrideRequest {
  entityType: 'person' | 'vital_event' | 'claim';
  entityId?: string;
  fieldName: string;
}

export interface PersonClaim {
  claimId: string;
  predicate: string;
  value: string;
  source: string;
  isOverridden: boolean;
  originalValue?: string;
}

// Re-export shared types
export type {
  PersonAugmentation,
  PlatformReference,
  PersonPhoto,
  PersonDescription,
  PlatformType,
  GenealogyProviderConfig,
  GenealogyProviderRegistry,
  ProviderPersonMapping,
  GenealogyAuthType,
  FavoriteData,
  FavoritesList,
  FavoriteWithPerson,
  SparseTreeNode,
  SparseTreeResult,
  AncestryTreeResult,
  AncestryFamilyUnit,
  AncestryPersonCard,
  ExpandAncestryRequest,
  BuiltInProvider,
  ProviderSessionStatus,
  UserProviderConfig,
  ProviderComparison,
  ScrapedPersonData,
  SyncProgress,
  CredentialsStatus,
  AutoLoginMethod,
  MultiPlatformComparison,
  ProviderCache,
  FieldComparison,
  ComparisonStatus,
  ProviderLinkInfo,
  PersonDetailViewMode,
  DiscoverParentsResult,
  DiscoverAncestorsResult,
} from '@fsf/shared';
