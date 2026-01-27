// Re-export fact types
export * from './fact-types.js';

// Vital event (birth, death, burial)
export interface VitalEvent {
  date?: string;               // Original format (supports BC notation)
  dateFormal?: string;         // ISO-like formal date (+1151, -1620 for BC)
  place?: string;
  placeId?: string;            // For future geo features
}

// ============================================================================
// Expanded Data Model (Phase 15.6+)
// ============================================================================

// Life event - comprehensive event storage for all GEDCOM-X and provider fact types
export interface LifeEvent {
  eventId: string;             // ULID
  personId: string;
  eventType: string;           // GEDCOM-X URI or custom type
  eventRole?: string;          // principal, witness, officiant, etc.

  // Temporal data
  dateOriginal?: string;       // Original text (e.g., "abt 1523", "12 Mar 1847")
  dateFormal?: string;         // GEDCOM-X formal date
  dateYear?: number;           // Extracted year for range queries
  dateMonth?: number;
  dateDay?: number;
  dateEndYear?: number;        // For date ranges

  // Location data
  placeOriginal?: string;      // Original place text
  placeNormalized?: string;    // Standardized place name
  placeId?: string;            // FamilySearch/GeoNames place ID

  // Event details
  value?: string;              // Primary value (e.g., occupation name, title)
  description?: string;        // Extended description/notes
  cause?: string;              // For death events

  // Provenance
  source: string;              // Provider: 'familysearch', 'ancestry', 'local'
  sourceId?: string;           // Provider's fact ID
  confidence?: number;

  createdAt?: string;
  updatedAt?: string;
}

// Note - for LifeSketch, stories, research notes
export interface Note {
  noteId: string;              // ULID
  personId: string;
  noteType: string;            // 'life_sketch', 'research', 'story', 'memorial', 'custom'
  title?: string;
  content: string;
  contentType?: string;        // 'text', 'markdown', 'html'
  language?: string;

  // Provenance
  source: string;              // 'familysearch', 'local', 'ai_generated'
  sourceId?: string;           // Provider's note/memory ID
  author?: string;

  createdAt?: string;
  updatedAt?: string;
}

// Source citation - provenance tracking
export interface SourceCitation {
  citationId: string;          // ULID

  // What this citation supports
  entityType: string;          // 'life_event', 'note', 'person', 'relationship'
  entityId: string;            // ID of the entity being cited

  // Citation details
  sourceType?: string;         // 'record', 'document', 'book', 'website', 'oral'
  title?: string;
  author?: string;
  publisher?: string;
  publicationDate?: string;
  url?: string;
  repository?: string;
  callNumber?: string;
  page?: string;

  // Provider reference
  provider?: string;           // 'familysearch', 'ancestry', etc.
  providerSourceId?: string;   // Provider's source ID

  notes?: string;
  confidence?: number;

  createdAt?: string;
}

// Local override - user edits that survive re-sync from providers
export interface LocalOverride {
  overrideId: string;          // ULID

  // What is being overridden
  entityType: string;          // 'person', 'life_event', 'relationship', 'note'
  entityId: string;            // ID of the entity being overridden
  fieldName: string;           // Which field is overridden

  // Override values
  originalValue?: string;      // What the provider had (for diff/revert)
  overrideValue?: string;      // User's value

  // Metadata
  reason?: string;             // Why the user made this change
  source?: string;             // 'local', 'research', 'family_knowledge'

  createdAt?: string;
  updatedAt?: string;
}

// Sync log - track when entities were last synced from providers
export interface SyncLog {
  id: number;
  entityType: string;          // 'person', 'database'
  entityId: string;
  provider: string;            // 'familysearch', 'ancestry'
  syncType: string;            // 'full', 'incremental', 'manual'
  status: string;              // 'success', 'partial', 'failed'
  recordsAdded?: number;
  recordsUpdated?: number;
  recordsUnchanged?: number;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
}

// Computed person fields (from the person_computed view)
export interface PersonComputed {
  personId: string;
  displayName: string;
  gender?: string;
  birthYear?: number;
  birthPlace?: string;
  deathYear?: number;
  deathPlace?: string;
  deathCause?: string;
  ageAtDeath?: number;
  childCount?: number;
  firstMarriageYear?: number;
  ageAtFirstMarriage?: number;
  titleOfNobility?: string;
  primaryOccupation?: string;
  militaryService?: string;
  hasLifeSketch?: boolean;
}

// Person data stored in graph database
export interface Person {
  // Identity
  name: string;                  // Preferred/display name
  birthName?: string;            // Birth/maiden name (if different from display name)
  marriedNames?: string[];       // Names taken after marriage
  aliases?: string[];            // Also known as names (nicknames, alternate spellings)
  alternateNames?: string[];     // Deprecated: all non-preferred names (kept for backwards compat)
  gender?: 'male' | 'female' | 'unknown';
  living: boolean;

  // Canonical identity (ULID-based, set when using SQLite)
  canonicalId?: string;          // ULID - canonical identifier across all providers

  // Vital Events
  birth?: VitalEvent;
  death?: VitalEvent;
  burial?: VitalEvent;

  // Life Details
  occupations?: string[];      // Multiple occupations/titles
  religion?: string;
  bio?: string;                // FamilySearch life sketch

  // Relationships (FamilySearch IDs or canonical ULIDs)
  parents: string[];           // [fatherId, motherId] convention
  children: string[];
  spouses?: string[];

  // Metadata
  lastModified?: string;       // When FS record was last updated

  // Compatibility fields (computed from above)
  lifespan: string;            // Computed from birth.date and death.date
  location?: string;           // First available place (birth or death)
  occupation?: string;         // First occupation (for backwards compat)
}

// Platform reference for cross-platform linking
export type PlatformType = 'familysearch' | 'wikipedia' | 'findagrave' | 'heritage' | 'ancestry' | 'geni' | 'wikitree' | 'myheritage' | 'findmypast' | '23andme' | 'linkedin';

// Built-in provider types (browser-based scrapers)
export type BuiltInProvider = 'familysearch' | 'ancestry' | '23andme' | 'wikitree';

// Legacy: Genealogy provider authentication types (kept for backward compatibility)
export type GenealogyAuthType = 'oauth2' | 'api_key' | 'session_token' | 'none';

// Legacy: Configuration for a genealogy data provider (kept for backward compatibility)
export interface GenealogyProviderConfig {
  id: string;
  name: string;
  platform: PlatformType;
  enabled: boolean;
  authType: GenealogyAuthType;
  credentials?: {
    accessToken?: string;
    apiKey?: string;
    clientId?: string;
    clientSecret?: string;
  };
  rateLimit: {
    requestsPerWindow: number;
    windowSeconds: number;
    minDelayMs: number;
    maxDelayMs: number;
  };
  baseUrl: string;
  timeout: number;
  lastConnected?: string;
  connectionStatus?: 'connected' | 'disconnected' | 'error';
}

// Legacy: Registry of all configured genealogy providers (kept for backward compatibility)
export interface GenealogyProviderRegistry {
  activeProvider: string | null;
  providers: Record<string, GenealogyProviderConfig>;
}

// Provider session status (checked via browser)
export interface ProviderSessionStatus {
  provider: BuiltInProvider;
  enabled: boolean;
  loggedIn: boolean;
  lastChecked?: string;
  userName?: string;
}

// Tree information from a provider
export interface ProviderTreeInfo {
  provider: BuiltInProvider;
  treeId: string;
  treeName: string;
  personCount?: number;
  rootPersonId?: string;
}

// Auto-login method type
export type AutoLoginMethod = 'credentials' | 'google';

// User configuration for a provider
export interface UserProviderConfig {
  provider: BuiltInProvider;
  enabled: boolean;
  defaultTreeId?: string;
  rateLimit: {
    minDelayMs: number;
    maxDelayMs: number;
  };
  // Browser scrape options
  browserScrapeEnabled: boolean;  // Whether browser scraping is enabled for this provider
  browserLoggedIn: boolean;       // User has confirmed they've logged into browser for this provider
  browserLastLogin?: string;      // Last time user confirmed browser login (ISO date)
  // Credential options
  hasCredentials?: boolean;       // Whether credentials are stored for this provider
  autoLoginEnabled?: boolean;     // Whether to auto-login when session expires
  autoLoginMethod?: AutoLoginMethod; // 'credentials' or 'google' (FamilySearch only)
}

// Login credentials for a provider (stored securely, never exposed in full via API)
export interface ProviderCredentials {
  email?: string;
  username?: string;
  password?: string;
  lastUpdated?: string;
}

// Status of credentials (returned by API - no password)
export interface CredentialsStatus {
  hasCredentials: boolean;
  email?: string;
  username?: string;
  autoLoginEnabled: boolean;
  autoLoginMethod?: AutoLoginMethod; // 'credentials' or 'google'
  lastUpdated?: string;
}

// Registry of all provider configurations
export interface ProviderRegistry {
  providers: Record<BuiltInProvider, UserProviderConfig>;
  lastUpdated: string;
}

// Scraped person data from any provider
export interface ScrapedPersonData {
  externalId: string;
  provider: BuiltInProvider;
  name: string;
  gender?: 'male' | 'female' | 'unknown';
  birth?: { date?: string; place?: string };
  death?: { date?: string; place?: string };
  fatherExternalId?: string;
  motherExternalId?: string;
  spouseExternalIds?: string[];
  alternateNames?: string[];
  fatherName?: string;
  motherName?: string;
  childrenCount?: number;
  occupations?: string[];
  photoUrl?: string;
  sourceUrl: string;
  scrapedAt: string;
}

// GEDCOM Types
export interface GedcomPerson {
  id: string;
  name: string;
  givenName?: string;
  surname?: string;
  gender?: 'M' | 'F' | 'U';
  birth?: { date?: string; place?: string };
  death?: { date?: string; place?: string };
  burial?: { date?: string; place?: string };
  familyChildIds?: string[];  // FAM IDs where this person is a child
  familySpouseIds?: string[]; // FAM IDs where this person is a spouse
  notes?: string;
}

export interface GedcomFamily {
  id: string;
  husbandId?: string;
  wifeId?: string;
  childIds?: string[];
  marriageDate?: string;
  marriagePlace?: string;
}

export interface GedcomFile {
  header: {
    source?: string;
    version?: string;
    charset?: string;
    submitter?: string;
  };
  individuals: Record<string, GedcomPerson>;
  families: Record<string, GedcomFamily>;
}

// Sync types
export interface ProviderComparison {
  personId: string;
  localPerson: Person;
  providerData: Record<BuiltInProvider, ScrapedPersonData | null>;
  differences: Array<{
    field: string;
    localValue?: string;
    providerValues: Record<BuiltInProvider, string | undefined>;
  }>;
}

export interface SyncProgress {
  phase: 'initializing' | 'comparing' | 'importing' | 'exporting' | 'complete' | 'error';
  currentIndex: number;
  totalCount: number;
  currentPerson?: string;
  imported: number;
  exported: number;
  skipped: number;
  errors: string[];
}

// ============================================================================
// Multi-Platform Comparison Types
// ============================================================================

// View mode for PersonDetail page
export type PersonDetailViewMode = 'provider-data' | 'golden-copy';

// Status of a field comparison across providers
export type ComparisonStatus = 'match' | 'different' | 'missing_local' | 'missing_provider';

// Comparison result for a single field across providers
export interface FieldComparison {
  fieldName: string;           // Internal field name: 'birthDate', 'birthPlace', etc.
  label: string;               // Human-readable label: 'Birth Date', 'Birth Place', etc.
  localValue: string | null;   // FamilySearch value (baseline/primary source)
  localUrl?: string;           // Optional link URL for the local value
  providerValues: Record<string, {
    value: string | null;
    status: ComparisonStatus;
    lastScrapedAt?: string;
    url?: string;              // Optional link URL for the provider value
  }>;
}

// Provider link status for a person
export interface ProviderLinkInfo {
  provider: BuiltInProvider;
  isLinked: boolean;
  externalId?: string;
  url?: string;
  lastScrapedAt?: string;
  scrapeError?: string;
  parentsNeedDiscovery?: boolean;
}

// Full multi-platform comparison result
export interface MultiPlatformComparison {
  personId: string;            // Can be canonical ULID or external ID
  canonicalId: string;         // Canonical ULID
  displayName: string;         // Person's display name
  providers: ProviderLinkInfo[];
  fields: FieldComparison[];
  summary: {
    totalFields: number;
    matchingFields: number;
    differingFields: number;
    missingOnProviders: Record<string, number>;
  };
  generatedAt: string;
}

// Cached provider data (stored in data/provider-cache/{provider}/{externalId}.json)
export interface ProviderCache {
  personId: string;            // Canonical ID or FamilySearch ID
  provider: BuiltInProvider;
  externalId: string;          // Provider's external ID
  scrapedData: ScrapedPersonData;
  scrapedAt: string;
  sourceUrl?: string;
}

// Mapping a person to an external provider record
export interface ProviderPersonMapping {
  platform: PlatformType;
  url: string;
  externalId?: string;
  linkedAt: string;
  verified?: boolean;
  providerId: string;
  confidence?: 'high' | 'medium' | 'low';
  matchedBy?: 'manual' | 'auto' | 'imported';
  lastSynced?: string;
}

export interface PlatformReference {
  platform: PlatformType;
  url: string;
  externalId?: string;         // Platform-specific ID
  linkedAt: string;            // When we linked it
  verified?: boolean;          // Manual verification flag
  photoUrl?: string;           // Photo URL discovered from this platform (not yet downloaded)
}

// Photo from any source
export interface PersonPhoto {
  url: string;
  source: string;              // Which platform
  localPath?: string;          // Downloaded copy
  isPrimary?: boolean;
  downloadedAt?: string;
}

// Description from any source
export interface PersonDescription {
  text: string;
  source: string;
  language?: string;
}

// Favorite data for a person
export interface FavoriteData {
  isFavorite: boolean;
  whyInteresting: string;
  addedAt: string;
  tags: string[];  // Categorization (e.g., "royalty", "notable", "immigrant", "revolutionary")
}

// Augmentation record for cross-platform data
export interface PersonAugmentation {
  id: string;                  // FamilySearch ID

  // Platform links
  platforms: PlatformReference[];

  // Consolidated data from all sources
  photos: PersonPhoto[];

  descriptions: PersonDescription[];

  // Custom overrides (user-provided)
  customBio?: string;
  customPhotoUrl?: string;
  notes?: string;              // Research notes

  // Provider-specific mappings (links to configured providers)
  providerMappings?: ProviderPersonMapping[];

  // Favorite marking
  favorite?: FavoriteData;

  updatedAt: string;
}

// External identity mapping (for multi-provider support)
export interface ExternalIdentity {
  source: string;              // 'familysearch', 'ancestry', 'wikitree', etc.
  externalId: string;          // Provider's ID for this person
  url?: string;                // Profile URL on provider
  confidence?: number;         // 0.0-1.0 confidence this is the same person
  lastSeenAt?: string;
}

// Claim/fact with provenance
export interface Claim {
  claimId: string;             // ULID
  predicate: string;           // 'occupation', 'religion', 'alias', etc.
  valueText?: string;
  valueDate?: string;
  source?: string;
  confidence?: number;
}

// Person with full identity information (for SQLite-backed responses)
export interface PersonWithIdentity extends Person {
  canonicalId: string;         // ULID - always present
  externalIds: ExternalIdentity[];
  claims?: Claim[];
}

// Graph database format (db-{id}.json)
export interface Database {
  [personId: string]: Person;
}

// Database metadata for listing
export interface DatabaseInfo {
  id: string;                  // Root person's canonical ULID (for URL routing)
  legacyId?: string;           // Original db_id for file references (e.g., "9CNK-KN3")
  filename: string;
  personCount: number;
  rootId: string;              // Same as id - root person's canonical ULID
  rootExternalId?: string;     // FamilySearch ID for display/external linking (legacy, use externalIds)
  externalIds?: Record<string, string>; // All external IDs by platform (e.g., { familysearch: 'GW21-BZR', ancestry: '12345' })
  rootName?: string;           // Name of the root person
  maxGenerations?: number;
  sourceProvider?: string;     // Provider ID that was used to create this database
  sourceRootExternalId?: string; // External ID from the source provider
  isSample?: boolean;          // True if this is a bundled sample database
  hasPhoto?: boolean;          // True if root person has a photo
}

// Person with ID included
export interface PersonWithId extends Person {
  id: string;                  // Canonical ULID for URL routing
  externalId?: string;         // Primary external ID (FamilySearch) for display/linking
}

// Tree node for D3 visualization
export interface TreeNode {
  id: string;
  name: string;
  lifespan: string;
  location?: string;
  occupation?: string;
  children?: TreeNode[];
  _collapsed?: boolean;
}

// Path finding result
export interface PathResult {
  path: PersonWithId[];
  length: number;
  method: 'shortest' | 'longest' | 'random';
}

// Search query parameters
export interface SearchParams {
  q?: string;
  location?: string;
  occupation?: string;
  birthAfter?: string;
  birthBefore?: string;
  generationMin?: number;
  generationMax?: number;
  hasPhoto?: boolean;
  hasBio?: boolean;
  page?: number;
  limit?: number;
}

// Search result with pagination
export interface SearchResult {
  results: PersonWithId[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Indexer job options
export interface IndexOptions {
  rootId: string;
  maxGenerations?: number;
  ignoreIds?: string[];
  cacheMode?: 'all' | 'complete' | 'none';
  oldest?: string;
}

// Indexer job status
export interface IndexerStatus {
  jobId: string | null;
  status: 'idle' | 'running' | 'stopping' | 'completed' | 'error';
  rootId?: string;
  progress?: IndexerProgress;
  startedAt?: string;
  error?: string;
}

// Indexer progress data
export interface IndexerProgress {
  new: number;
  cached: number;
  refreshed: number;
  generations: number;
  deepest: string;
  currentPerson?: string;
}

// SSE event types
export type IndexerEventType = 'started' | 'progress' | 'person' | 'completed' | 'error' | 'stopped';

export interface IndexerEvent {
  type: IndexerEventType;
  timestamp: string;
  data: {
    jobId?: string;
    rootId?: string;
    options?: IndexOptions;
    progress?: IndexerProgress;
    personId?: string;
    personName?: string;
    generation?: number;
    personStatus?: 'new' | 'cached' | 'refreshed';
    totalPersons?: number;
    databaseFile?: string;
    message?: string;
  };
}

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Sparse tree node for favorites visualization
export interface SparseTreeNode {
  id: string;
  name: string;
  lifespan: string;
  photoUrl?: string;
  whyInteresting?: string;
  tags?: string[];
  generationFromRoot: number;
  generationsSkipped?: number;  // From previous visible node
  isFavorite: boolean;
  children?: SparseTreeNode[];
  nodeType: 'person' | 'junction';  // Discriminate between person and junction nodes
  junctionLineage?: 'paternal' | 'maternal' | 'unknown';  // Lineage for junction nodes
  // Lineage badges - which lineages connect from this node to ancestors
  hasPaternal?: boolean;  // Has paternal ancestor connections
  hasMaternal?: boolean;  // Has maternal ancestor connections
  lineageFromParent?: 'paternal' | 'maternal' | 'unknown';  // How this node connects to its parent
}

// Sparse tree result
export interface SparseTreeResult {
  root: SparseTreeNode;
  totalFavorites: number;
  maxGeneration: number;
}

// Favorite with person info (for listing)
export interface FavoriteWithPerson {
  personId: string;      // Canonical ULID for URL routing
  externalId?: string;   // FamilySearch ID for display/linking
  name: string;
  lifespan: string;
  photoUrl?: string;
  favorite: FavoriteData;
  databases: string[];  // Which databases contain this person
}

// Favorites list response
export interface FavoritesList {
  favorites: FavoriteWithPerson[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  allTags: string[];  // All unique tags across favorites
}

// Ancestry Tree Types (FamilySearch-style visualization)

// Person card data for ancestry tree
export interface AncestryPersonCard {
  id: string;
  name: string;
  lifespan: string;
  gender: 'male' | 'female' | 'unknown';
  photoUrl?: string;
  hasMoreAncestors: boolean;
  // Extended fields for detailed views
  birthPlace?: string;
  deathPlace?: string;
  occupation?: string;
}

// Family unit containing father and mother cards
export interface AncestryFamilyUnit {
  id: string;
  father?: AncestryPersonCard;
  mother?: AncestryPersonCard;
  generation: number;
  // Separate parent units for each parent's ancestry line
  fatherParentUnits?: AncestryFamilyUnit[];
  motherParentUnits?: AncestryFamilyUnit[];
}

// Full ancestry tree result
export interface AncestryTreeResult {
  rootPerson: AncestryPersonCard;
  rootSpouse?: AncestryPersonCard;
  parentUnits?: AncestryFamilyUnit[];
  maxGenerationLoaded: number;
}

// Request to expand a specific generation
export interface ExpandAncestryRequest {
  fatherId?: string;
  motherId?: string;
}

// ============================================================================
// Parent Discovery Types
// ============================================================================

// Result of discovering parent provider IDs for a single person
export interface DiscoverParentsResult {
  personId: string;
  provider: BuiltInProvider;
  discovered: Array<{
    parentId: string;        // canonical ULID
    parentRole: string;      // 'father' | 'mother'
    parentName: string;      // local name
    externalId: string;      // discovered provider ID
    providerUrl: string;     // URL on provider
    confidence: number;      // 1.0 = role + name match, 0.7 = role only
    nameMatch: boolean;
  }>;
  skipped: Array<{
    parentId: string;
    parentRole: string;
    reason: 'already_linked' | 'not_found_on_provider' | 'name_mismatch_below_threshold';
  }>;
  error?: string;
}

// Aggregate result of discovering ancestors across multiple generations
export interface DiscoverAncestorsResult {
  provider: BuiltInProvider;
  totalDiscovered: number;
  totalSkipped: number;
  totalErrors: number;
  generationsTraversed: number;
  personsVisited: number;
  results: DiscoverParentsResult[];
}
