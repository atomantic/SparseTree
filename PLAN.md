# SparseTree Development Plan

High-level project roadmap. For detailed phase documentation, see [docs/roadmap.md](./docs/roadmap.md).

## Current Status

**Version:** 0.5.x (Multi-Platform Comparison & UI Redesign)

### Completed Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1-5 | Enhanced person extraction, UI updates | ✅ |
| 6 | Multi-provider genealogy system | ✅ |
| 7 | Favorites & sparse family tree | ✅ |
| 8 | FamilySearch-style ancestry tree | ✅ |
| 9-10 | Browser-based provider system | ✅ |
| 11 | Browser settings page | ✅ |
| 12 | DRY theme system | ✅ |
| 13 | Provider login credentials | ✅ |
| 14 | SQLite storage layer | ✅ |
| 15 | Canonical ID migration | ✅ |

### In Progress

| Phase | Description | Status |
|-------|-------------|--------|
| 15.8 | FamilySearch redirect/merge handling | ✅ |
| 15.9 | Editable person profile pages | ✅ |
| 15.10 | FamilySearch bidirectional sync | ✅ |
| 15.11 | Multi-platform data comparison | ✅ |
| 15.12 | PersonDetail UX redesign | ✅ |
| 15.13 | Provider comparison table + LinkedIn | ✅ |
| 15.14 | Code quality refactoring | 📋 |
| 15.16 | Ancestry photo upload | ✅ |
| 15.17 | Data integrity + bulk discovery | ✅ |
| 15.18 | Separate provider download from auto-apply | ✅ |
| 15.19 | Normalize FamilySearch as downstream provider | ✅ |
| 15.20 | Relationship linking (parents, spouses, children) | 📋 |
| 15.22 | Ancestry free hints automation | ✅ |
| 16 | Multi-platform sync architecture | 📋 |
| 17 | Real-time event system (Socket.IO) | 📋 |

### Planned: Relationship Linking (Parents, Spouses, Children)

High-level implementation plan:

- **UI/UX**
  - Add “Add/Link” actions in Parents/Spouse/Children cards (PersonDetail)
  - Provide modal with two flows: link existing local person, or create new profile stub
  - Allow optional provider link input (Ancestry/FS/WikiTree) during create
- **Server/API**
  - Endpoints to create relationship edges (`parent_edge`, spouse link, child link)
  - Endpoint to search/select existing people within a DB
  - Endpoint to create a minimal person record + relationship edge atomically
- **Data & Validation**
  - Enforce role semantics (father/mother/spouse/child)
  - Prevent duplicate edges and self-links
  - Optional confidence metadata for manual links
- **Integration**
  - Update multi-platform comparison to reflect newly linked parents/spouses/children
  - Trigger cache refresh for parent discovery flags

### Server Logging Overhaul

Replaced raw `console.log` calls with structured emoji-labeled logger utility:

- **Logger Utility**: `server/src/lib/logger.ts` - lightweight, no external dependencies
  - Emoji-prefixed categories: 🌐 API, 🎭 Browser, 📸 Photo, ⬆️ Upload, etc.
  - Context tags: `[upload]`, `[scraper]`, `[browser]`, etc.
  - Built-in timing: `logger.time()` / `logger.timeEnd()` with formatted output
  - Routes warn/error to appropriate console methods
- **Request Logger**: `requestLogger.ts` now shows timing and status codes
  - `🌐 POST /api/sync/.../upload-to-familysearch (started)`
  - `✔️ POST /api/sync/.../upload-to-familysearch (1.2s, 200)`
- **Services Updated**: familysearch-upload, scraper, familysearch-refresh,
  multi-platform-comparison, augmentation, browser, familysearch-redirect,
  ancestry scraper

### Playwright Scraper DRY Refactoring

Extracted duplicated code from per-provider scrapers into shared functions in `base.scraper.ts`:

- **`performLoginWithSelectors()`**: Shared login flow used by all 4 scrapers (FS, Ancestry, WikiTree, 23andMe). Each scraper's `performLogin()` is now a one-liner delegating to this function with provider-specific selectors.
- **`scrapeAncestorsBFS()`**: Shared BFS ancestor traversal used by 3 scrapers (FS, Ancestry, WikiTree). Takes `scrapePersonById` callback and rate limit options from `PROVIDER_DEFAULTS`. 23andMe excluded (bulk state extraction).
- **`isPlaceholderImage()`**: Shared placeholder image detection exported from `base.scraper.ts`, replacing duplicates in `familysearch.scraper.ts` and inline checks in `scraper.service.ts`.
- **Logger migration**: Replaced remaining `console.log` calls in `ancestry.scraper.ts` (4 calls) and `familysearch-redirect.service.ts` (4 calls) with structured logger.
- **Re-exports**: `scrapers/index.ts` re-exports all new shared functions.

### Phase 15.13: Provider Comparison Table + LinkedIn Integration

Expanded ProviderDataTable with full comparison data and LinkedIn as a new data source:

- **Comparison Table Expansion**: Father, Mother, Children, Occupations columns now show data from all providers
  - FamilySearch scraper extracts parent names and children count from DOM
  - Comparison service resolves local parent names from database
  - All provider rows (FS, Ancestry, WikiTree) show comparison status icons
- **LinkedIn Integration**: New manual-link data source following Wikipedia pattern
  - Browser-based scraping: headline (occupation), company, profile photo
  - `augmentation.service.ts`: `scrapeLinkedIn()`, `linkLinkedIn()`, photo helpers
  - API routes: `POST /:personId/linkedin`, `GET /:personId/linkedin-photo{/exists}`
  - Client: `LinkPlatformDialog` config, API methods, photo state management
  - LinkedIn row in ProviderDataTable with link/photo actions
- **Files Modified**:
  - `shared/src/index.ts` - ScrapedPersonData fields, PlatformType union
  - `server/src/services/multi-platform-comparison.service.ts` - 4 new comparison fields
  - `server/src/services/scrapers/familysearch.scraper.ts` - Parent name/children extraction
  - `server/src/services/augmentation.service.ts` - LinkedIn scrape/link/photo methods
  - `server/src/routes/augmentation.routes.ts` - LinkedIn routes
  - `client/src/services/api.ts` - LinkedIn API methods
  - `client/src/components/person/LinkPlatformDialog.tsx` - LinkedIn config
  - `client/src/components/person/ProviderDataTable.tsx` - LinkedIn row, comparison cells
  - `client/src/components/person/PersonDetail.tsx` - LinkedIn state/handlers

### Phase 15.15: Parent Provider ID Discovery

Automatically discovers and links provider-specific IDs for a person's parents by scraping the provider page and extracting parent references:

- **Scraper Extension**: Added `extractParentIds` optional method to `ProviderScraper` interface in `base.scraper.ts`
  - Ancestry: navigates to person facts page, extracts parent IDs + names from Parents section
  - FamilySearch: navigates to person details page, extracts via `data-testid` selectors
  - WikiTree: navigates to wiki page, extracts from PARENTS section and family links
- **Parent Discovery Service**: `parent-discovery.service.ts`
  - `discoverParentIds()`: Single-person discovery - matches scraped parents to local parents by role + name
  - `discoverAncestorIds()`: BFS traversal upward - discovers multiple generations with rate limiting
  - `checkParentsNeedDiscovery()`: Synchronous check if any parent lacks a provider link
  - Name matching with accent normalization and partial match support
- **API Endpoints**:
  - `POST /api/sync/:dbId/:personId/discover-parents/:provider` - Discover for one person
  - `POST /api/sync/:dbId/:personId/discover-ancestors/:provider` - BFS ancestor traversal
- **Comparison Enhancement**: `parentsNeedDiscovery` field added to `ProviderLinkInfo` type
  - Computed in `compareAcrossPlatforms()` for each linked provider
- **UI**: Discover buttons in ProviderDataTable
  - Per-row Discover button (search icon) when provider is linked and parents need discovery
  - "Discover All" button in footer for BFS ancestor traversal
  - Toast notifications with discovery results
- **Shared Types**: `DiscoverParentsResult`, `DiscoverAncestorsResult`
- **Files Modified**:
  - `shared/src/index.ts` - New types, `parentsNeedDiscovery` on `ProviderLinkInfo`
  - `server/src/services/scrapers/base.scraper.ts` - `extractParentIds` interface method
  - `server/src/services/scrapers/ancestry.scraper.ts` - `extractParentIds` + name extraction
  - `server/src/services/scrapers/familysearch.scraper.ts` - `extractParentIds` implementation
  - `server/src/services/scrapers/wikitree.scraper.ts` - `extractParentIds` + `extractWikiTreeParentNames`
  - `server/src/services/parent-discovery.service.ts` - **NEW** core discovery logic
  - `server/src/services/multi-platform-comparison.service.ts` - `parentsNeedDiscovery` computation
  - `server/src/routes/sync.routes.ts` - Discovery endpoints
  - `client/src/services/api.ts` - `discoverParentIds`, `discoverAncestorIds` methods
  - `client/src/components/person/ProviderDataTable.tsx` - Discover + Discover All buttons

### Phase 15.16: Ancestry Photo Upload

Adds photo upload to Ancestry via Playwright browser automation, mirroring the FamilySearch upload pattern:

- **Upload Service**: `ancestry-upload.service.ts`
  - `compareForUpload()` - checks local photo availability vs Ancestry status
  - `uploadToAncestry()` - orchestrates upload via browser automation
  - `uploadPhoto()` - Playwright automation: navigates to gallery page, clicks Add, sets file input
  - `handleLoginIfNeeded()` - auto-login using stored credentials via `performLoginWithSelectors` pattern
  - Tree ID/person ID resolution via `augmentationService.parseAncestryUrl()`
- **Upload Dialog**: `UploadToAncestryDialog.tsx`
  - Photo comparison: local photo vs Ancestry status
  - Upload checkbox with photo preview
  - Emerald-themed to match Ancestry branding
- **API Endpoints**:
  - `GET /api/sync/:dbId/:personId/compare-for-ancestry-upload`
  - `POST /api/sync/:dbId/:personId/upload-to-ancestry`
- **UI Integration**: Upload button on Ancestry row in ProviderDataTable
- **Dead Code Removal**: Deleted unused `UnifiedPlatformSection.tsx` (superseded by ProviderDataTable)

### Phase 15.12: PersonDetail UX Redesign

Compact layout redesign for PersonDetail page with unified provider table:

- **Compact Header**: Smaller photo (24x24), name with edit button inline, badges on right
- **IDs Inline**: Canonical ID and external IDs (FS, Ancestry, WikiTree) shown inline without toggle
- **Compact Vital Events**: Single row layout with Birth/Death/Burial + Parents/Spouses/Children
- **Alphabetized Aliases**: Also Known As names sorted alphabetically
- **ProviderDataTable**: New unified table replacing UnifiedPlatformSection
  - SparseTree as first/primary row
  - Photo thumbnails for each provider with inline "Use Photo" button
  - Inline field values (Name, Birth, Death) with comparison status icons
  - Status column showing link status and difference count
  - Action buttons (Download, Upload, Link) per provider
- **Files Modified**:
  - `PersonDetail.tsx` - Major restructure for compact layout
  - `ProviderDataTable.tsx` - New unified provider table component
  - Removed dependency on VitalEventCard grid layout

### Phase 15.11: Multi-Platform Data Comparison

Enables side-by-side comparison of person data across genealogy providers:

- **Unified Provider Cache**: Migrated FamilySearch data to `data/provider-cache/familysearch/`
  - Unified cache structure: `data/provider-cache/{provider}/{externalId}.json`
  - Migration script: `scripts/migrate-provider-cache.ts`
  - Backwards compatibility via symlink
- **Comparison Service**: `multi-platform-comparison.service.ts`
  - Compares person data across FamilySearch, Ancestry, WikiTree, 23andMe
  - Field-by-field comparison with status indicators (match/different/missing)
  - Cached provider data with optional refresh
- **API Endpoints**:
  - `GET /api/sync/:dbId/:personId/multi-platform-compare` - Full comparison
  - `POST /api/sync/:dbId/:personId/refresh-provider/:provider` - Refresh from provider
- **UI Component**: `PlatformComparisonPanel.tsx`
  - Expandable comparison grid showing all linked providers
  - Status icons: ✓ match, ⚠ different, — missing
  - Per-provider refresh buttons with loading state
  - Summary badges showing divergence count
- **New Types**:
  - `MultiPlatformComparison`, `FieldComparison`, `ComparisonStatus`
  - `ProviderCache`, `ProviderLinkInfo`, `PersonDetailViewMode`

### Phase 15.10: FamilySearch Bidirectional Sync

Implements bidirectional sync with FamilySearch:

- **Download Button**: Renamed from "Sync" - fetches latest data from FamilySearch
- **Upload Button**: New button to push local edits to FamilySearch
- **Comparison Dialog**: Side-by-side view of local vs FamilySearch values
  - Field-by-field differences with checkboxes
  - Select which fields to upload
  - Preview of changes before upload
  - "Refresh from FamilySearch" button to fetch latest data via API
- **Refresh Service**: `familysearch-refresh.service.ts` with API-based data fetching
  - Extracts auth token from browser session cookies
  - Fetches person data via FamilySearch API (not Playwright scraping)
  - Updates JSON cache and SQLite database
  - Handles person merges/redirects automatically
- **Upload Service**: `familysearch-upload.service.ts` with Playwright automation
  - Compares local overrides against cached FamilySearch data
  - Properly displays "Living" status for death date field
  - Handles name, vital events (birth/death date/place), alternate names
  - Navigates to FamilySearch edit pages and fills forms
- **API Endpoints**:
  - `GET /api/sync/:dbId/:personId/compare-for-upload` - Compare local vs FS (uses cache)
  - `POST /api/sync/:dbId/:personId/refresh-from-familysearch` - Refresh from API
  - `POST /api/sync/:dbId/:personId/upload-to-familysearch` - Execute upload

### Phase 15.9: Editable Person Profile Pages

Enables inline editing of person profile fields using the `local_override` table:

- **Service Layer**: `local-override.service.ts` with CRUD operations for overrides and claims
- **API Endpoints**: Override management (`GET/PUT/DELETE`) and claims (`GET/POST/PUT/DELETE`)
- **UI Components**: Reusable editable components with override indicators
  - `EditableField.tsx` - Generic inline text editing
  - `EditableDate.tsx` - Genealogy date format validation
  - `EditableList.tsx` - For occupations/aliases with add/edit/delete
  - `VitalEventCard.tsx` - Birth/death/burial with editable date/place
- **PersonDetail Integration**: Name, bio, vital events, occupations, aliases all editable
- **Override Indicators**: Visual badges show edited fields with revert option

### Phase 15.8: FamilySearch Redirect/Merge Handling

Handles FamilySearch person records that have been deleted/merged:

- **Redirect Detection**: Compares requested URL vs final URL after browser navigation
- **Deleted Person Detection**: Parses page content for "Deleted Person" banners
- **ID Mapping Updates**: Registers new FamilySearch ID while keeping old as historical reference
- **DRY Handler**: `familysearch-redirect.service.ts` used by both photo scraping and profile sync
- **Profile Sync Button**: "Sync FS" button on person detail page checks for updates
- **Scraping Integration**: Photo scraping now detects and handles redirects automatically

## Architecture Summary

See [docs/architecture.md](./docs/architecture.md) for full details.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Layer 3: Local Overrides                    │
│  User edits that take precedence and survive provider re-sync   │
├─────────────────────────────────────────────────────────────────┤
│                    Layer 2: Normalized Data                     │
│  Extracted facts, relationships, life events in SQLite          │
├─────────────────────────────────────────────────────────────────┤
│                     Layer 1: Raw Provider Cache                 │
│  Immutable API responses from FamilySearch, Ancestry, etc.      │
└─────────────────────────────────────────────────────────────────┘
```

### Source of Truth Principle

**SparseTree SQLite is the canonical source of truth**, not any downstream provider.

| Component | Purpose | Usage |
|-----------|---------|-------|
| SQLite Database | **Canonical source of truth** | All data reads come from here |
| Provider Cache | **Comparison only** | Shows what providers have vs what we have |
| Local Overrides | **User edits** | Takes precedence over base SQLite data |

**Key principles:**

1. **Initial Seeding**: When indexing from FamilySearch (or any provider), data is written to both SQLite (as the record) AND provider-cache (for comparison). The SQLite record becomes the source of truth.

2. **No Fallback Code**: We do NOT maintain legacy paths or fallback code. When storage locations change, we create migration scripts to upgrade data in place.

3. **Explicit Apply**: Downloaded provider data is cached but never auto-applied. Users must click "Use" buttons to apply specific values from providers.

4. **Provider Equality**: All providers (FamilySearch, Ancestry, WikiTree, etc.) are treated equally as downstream data sources. None have special priority.

## Next Steps

### Phase 15.17: Data Integrity Page + Bulk Discovery

Database maintenance dashboard with automated parent ID discovery:

- **Integrity Service**: `integrity.service.ts` - SQL-based checks for data quality
  - `getIntegritySummary()` - Counts for all check types
  - `getProviderCoverageGaps()` - Persons with some but not all provider links
  - `getParentLinkageGaps()` - Parent edges where parent lacks provider link the child has
  - `getOrphanedEdges()` - Parent edges referencing non-existent person records
  - `getStaleProviderData()` - Provider cache files older than N days
- **Bulk Discovery Service**: `bulk-discovery.service.ts` - Database-wide parent ID discovery
  - Async generator yielding `BulkDiscoveryProgress` events for SSE streaming
  - Deduplicates by child_id (one scrape discovers both parents)
  - Reuses existing `parentDiscoveryService.discoverParentIds()` per child
  - Rate limited via `PROVIDER_DEFAULTS[provider].rateLimitDefaults`
  - In-memory cancellation via `Set<operationId>` checked between iterations
- **API Endpoints** (`/api/integrity/:dbId`):
  - `GET /` - Full integrity summary
  - `GET /coverage` - Provider coverage gaps (?providers=fs,ancestry)
  - `GET /parents` - Parent linkage gaps (?provider=familysearch)
  - `GET /orphans` - Orphaned edges
  - `GET /stale` - Stale records (?days=30)
  - `POST /discover-all` - Start bulk discovery
  - `GET /discover-all/events` - SSE stream for progress
  - `POST /discover-all/cancel` - Cancel running operation
- **UI**: `IntegrityPage.tsx` at `/db/:dbId/integrity`
  - Summary cards (4 check types with counts, clickable)
  - Tabbed interface: Parents | Coverage | Orphans | Stale
  - Parents tab: provider selector, "Discover All" button with SSE progress bar + cancel
  - Coverage tab: table of persons with linked/missing provider badges
  - Orphans tab: table of broken parent edges
  - Stale tab: configurable days threshold, table with age coloring
  - Sidebar nav item with ShieldCheck icon
- **Shared Types**: `IntegritySummary`, `ProviderCoverageGap`, `ParentLinkageGap`, `OrphanedEdge`, `StaleRecord`, `BulkDiscoveryProgress`
- **Files Created**:
  - `server/src/services/integrity.service.ts`
  - `server/src/services/bulk-discovery.service.ts`
  - `server/src/routes/integrity.routes.ts`
  - `client/src/components/integrity/IntegrityPage.tsx`
- **Files Modified**:
  - `shared/src/index.ts` - New types
  - `server/src/index.ts` - Route mount
  - `client/src/services/api.ts` - API methods + type re-exports
  - `client/src/App.tsx` - Route
  - `client/src/components/layout/Sidebar.tsx` - Nav item

### Phase 15.14: Code Quality Refactoring (Pre-Phase 16 Cleanup)

Code audit identified DRY/YAGNI/performance issues to address before Phase 16:

#### DRY Fixes — Client
- [ ] **Photo state consolidation**: Replace 7 boolean `has*Photo` states in `PersonDetail.tsx` with `Record<string, boolean>`. Add batch `/api/persons/:id/photo-status` endpoint
- [ ] **Platform registry object**: Replace 3 repeated conditional chains (`linkFn`, `photoCheckFn`, `photoRefreshFn`) with `PLATFORM_REGISTRY` lookup in `PersonDetail.tsx`
- [ ] **Shared provider constants**: Move provider color/display mappings from `ProviderDataTable.tsx` to shared constants
- [ ] **Extract `useBrowserStatusSSE()` hook**: Same `EventSource('/api/browser/events')` setup duplicated in `IndexerPage`, `GenealogyProviders`, `BrowserSettingsPage`
- [ ] **Extract `useBrowserActions()` hook**: `handleConnect`/`handleDisconnect`/`handleLaunch` + loading states duplicated in `GenealogyProviders` and `BrowserSettingsPage`
- [ ] **Extract `<OutputConsole>` component**: Terminal output console (bg-gray-900, font-mono, auto-scroll) duplicated in `IndexerPage` and `ReportsPage`
- [ ] **Extract `<GoogleIcon>` component**: Inline Google logo SVG repeated 3x in `GenealogyProviders.tsx`

#### DRY Fixes — Server
- [ ] **Extract `downloadImage()` utility**: Deduplicate from `scraper.service.ts` and `augmentation.service.ts` into shared `server/src/lib/utils.ts`
- [ ] **Extract `ensureDir()` utility**: Replace repeated `fs.existsSync` + `mkdirSync` pattern across services
- [ ] **Parameterize augmentation routes**: Replace 4x copy-pasted route handlers (link, photo serve, photo exists) in `augmentation.routes.ts` with platform-parameterized routes
- [ ] **Consolidate augmentation `link*` methods**: Extract shared `linkPlatform()` core + `createDefaultAugmentation(personId)` factory (default object literal repeated 10x in `augmentation.service.ts`)
- [ ] **Extract `getPhotoPath(personId, suffix)` utility**: Deduplicate 4 identical `get*PhotoPath` methods in `augmentation.service.ts`
- [ ] **Extract `ensureBrowserConnected()` helper**: Replace 10-line browser auto-connect boilerplate repeated 3+ times in `augmentation.service.ts`
- [ ] **Extract `formatLifespan()` utility**: Same expression duplicated 5x across `favorites.service.ts` and `database.service.ts`
- [ ] **Merge external ID registration functions**: Consolidate `registerExternalIdentityIfEnabled` / `registerProviderMappingIfEnabled` in `augmentation.service.ts`

#### Component Decomposition
- [ ] **Split PersonDetail.tsx** (~1080 lines): Extract `usePersonData` hook, `usePersonOverrides` hook, `PersonHeader`, `PersonLineage`, `PersonMedia` sub-components
- [ ] **Split ProviderDataTable.tsx** (~782 lines): Extract `PhotoThumbnail`, `ComparisonCell`, `ProviderRow` sub-components
- [ ] **Split GenealogyProvidersPage.tsx** (~620 lines): Extract `ProviderCard` component, `useProviderSession` hook, `GoogleIcon` component (inlined 4x)

#### API & Route Consolidation
- [ ] **Genericize platform API methods**: Replace per-platform methods (`linkWikipedia`, `linkAncestry`, etc.) with `linkPlatform(personId, platform, url)` pattern in `client/src/services/api.ts`
- [ ] **Batch person load endpoint**: Add endpoint to return person + parents + spouses + photo status in single call, eliminating N+1 pattern on `PersonDetail` mount
- [ ] **Standardize route error handling**: Unify to `.catch(next)` pattern across all route files (currently 3 different patterns)

#### Performance
- [ ] **Fix search N+1 query**: `search.service.ts` calls `getPerson()` per result (6 SQL queries each = 300 queries for 50 results). Batch into `WHERE person_id IN (...)` queries
- [ ] **Optimize `buildPersonFromSqlite()`**: Replace 6 sequential queries with JOINs or batched queries
- [ ] **Add composite DB index**: `vital_event(person_id, place)` for search query performance
- [ ] **Convert LRUCache class to factory function**: Match project's functional style in `cache.service.ts`
- [ ] **Add route-level code splitting**: Wrap page components in `React.lazy()` + `Suspense` in `App.tsx` (all pages eagerly imported today)

#### Dead Code Removal
- [ ] **Remove Socket.IO service + hooks** (298 lines): `client/src/services/socket.ts` and `client/src/hooks/useSocket.ts` — never imported, all real-time uses SSE
- [ ] **Remove dead `TreeView` component** (167 lines): `client/src/components/tree/TreeView.tsx` — superseded by `AncestryTreeView`, not referenced
- [ ] **Remove dead `ConnectionLine` components** (193 lines): `client/src/components/ancestry-tree/ConnectionLine.tsx` — exported but never imported
- [ ] **Remove dead `batchInsert()`**: Unused function in `sqlite.service.ts` with SQL injection risk (table/column names interpolated)

#### Cleanup & Security
- [ ] **Audit legacy migration code**: Determine if `LegacyAugmentation` in `augmentation.service.ts:22-95` is still needed
- [ ] **Remove identity function**: `getCanonicalDbId()` in `database.service.ts:133-135` just returns its input
- [ ] **Deprecate legacy favorites routes**: `GET/POST/PUT/DELETE /:personId` duplicates db-scoped endpoints
- [ ] **Add route param validation**: `personId` used directly in file paths without sanitization (path traversal risk)
- [ ] **Validate browser navigate URL**: `/browser/navigate` accepts arbitrary URLs (SSRF risk) — restrict to genealogy domains
- [ ] **Fix PathFinder dark mode**: Inputs in `PathFinder.tsx` missing `bg-app-bg`/`text-app-text`/`border-app-border` theme classes
- [ ] **Fix hardcoded output console colors**: `IndexerPage` and `ReportsPage` use `bg-gray-900` instead of theme tokens

### Phase 15.18: Separate Provider Download from Apply

Separated provider data download from automatic application to prevent data corruption from bad scrapes:

**Problem Solved:**
- Previously, downloading from providers (Ancestry, FamilySearch) auto-applied scraped data as source of truth
- This caused: corrupted parent connections ("Unknown Father/Mother" replacing correct links), wrong photos

**Solution: Two-Step Workflow:**
1. **Download** - Only caches provider data in `data/provider-cache/` (no auto-apply)
2. **Use** - User explicitly selects which fields to apply via "Use" buttons

**Changes:**
- **`multi-platform-comparison.service.ts`**:
  - Renamed `linkScrapedParents()` → `cacheScrapedParentInfo()` - only caches parent IDs/URLs, doesn't create edges/persons
  - `getProviderData()` - downloads photos but never auto-sets as primary (`isPrimary: false`)
- **`person.routes.ts`** - New endpoints:
  - `POST /:dbId/:personId/use-photo/:provider` - Set provider's cached photo as primary
  - `POST /:dbId/:personId/use-parent` - Create parent_edge from cached provider data
  - `PUT /:dbId/:personId/use-field` - Apply field value as local override
- **`client/src/services/api.ts`** - New API methods:
  - `useProviderPhoto()`, `useProviderParent()`, `useProviderField()`
- **`ProviderDataTable.tsx`**:
  - Added "Use" arrow buttons on differing field values
  - Updated `PhotoThumbnail` to support "Use as Primary" action when photo exists locally
  - `handleUseValue()` handler calls appropriate API based on field type

**Shared Types Updated:**
- `ScrapedPersonData` - Added `fatherUrl`, `motherUrl` for cached parent URLs

### Phase 15.19: Normalize FamilySearch as Downstream Provider ✅

**Problem:** FamilySearch was treated as the "native" source rather than as one of several equal downstream providers.

**Solution:** Made SparseTree the canonical source with ALL providers (including FamilySearch) as equal downstream data sources.

**15.19a: Photo & ID Resolution Changes**
- Standardized FamilySearch photos: `{personId}.jpg` → `{personId}-familysearch.jpg`
- Removed FamilySearch priority in ID resolution (alphabetical order now)
- Added `linkFamilySearch()`, `getFamilySearchPhotoPath()` to augmentation service
- Created `scripts/migrate-fs-photos.ts` - migrated 16 photos

**15.19b: Remove Legacy Fallback Code**
- **Architectural principle**: No legacy fallback code - use migration scripts instead
- Created `scripts/migrate-legacy-cache.ts` - moved 140,573 files from `data/person/` to `data/provider-cache/familysearch/`
- Removed all legacy path fallbacks from services:
  - `familysearch-refresh.service.ts` - removed legacy path checks in `getCachedPersonData()`, `getLastRefreshed()`
  - `multi-platform-comparison.service.ts` - removed legacy path in `loadFamilySearchData()`
  - `augmentation.service.ts` - removed legacy photo path fallbacks
  - `scraper.service.ts` - simplified `hasFsPhoto()`, `getPhotoPath()`
  - `person.routes.ts` - removed legacy path in `use-photo` endpoint
- Verified indexer (`scripts/index.ts`) already writes to both SQLite (source of truth) AND provider-cache (for comparison)

**Files Modified:**
- `server/src/services/augmentation.service.ts` - FamilySearch methods, removed legacy fallbacks
- `server/src/services/id-mapping.service.ts` - Removed FS priority
- `server/src/services/familysearch-refresh.service.ts` - Removed legacy fallbacks
- `server/src/services/scraper.service.ts` - Updated photo paths, removed legacy fallbacks
- `server/src/services/multi-platform-comparison.service.ts` - Treat FS equally, removed legacy fallbacks
- `server/src/routes/person.routes.ts` - Removed legacy fallbacks
- `scripts/migrate-fs-photos.ts` - **NEW** photo migration
- `scripts/migrate-legacy-cache.ts` - **NEW** cache migration

### Phase 15.21: Tree Visualization Parity with Ancestry.com

Enhanced tree views matching Ancestry.com visualization modes:

**New View Modes (5 total):**
1. **Fan Chart** (default) - Radial chart with lineage-colored wedges
   - Paternal line: cool colors (blue/teal)
   - Maternal line: warm colors (red/coral)
   - SVG-based with zoom/pan support
2. **Horizontal Pedigree** - Root left, ancestors right (Ancestry-style)
   - DOM-based cards with SVG connector lines
   - Expandable nodes for loading more ancestors
3. **Vertical Family** - Ancestors top, root middle (classic family tree)
   - Generation labels ("Michael's parents", "Michael's grandparents")
   - Clean CSS-based connecting lines
4. **Columns** - Horizontal generational columns (existing)
5. **Focus** - Single person navigator (existing)

**URL-Based Routing:**
- `/tree/:dbId/:personId/fan` - Fan chart (default)
- `/tree/:dbId/:personId/horizontal` - Horizontal pedigree
- `/tree/:dbId/:personId/vertical` - Vertical family view
- `/tree/:dbId/:personId/columns` - Generational columns
- `/tree/:dbId/:personId/focus` - Focus navigator

**Shared Components:**
- `TreeCanvas.tsx` - D3 zoom/pan wrapper with hooks
- `TreeControls.tsx` - Generation selector, zoom buttons
- `AncestorNode.tsx` - Reusable person card with lineage colors

**Utilities:**
- `lineageColors.ts` - Paternal/maternal color schemes
- `treeLayout.ts` - Node positioning calculations
- `arcGenerator.ts` - Fan chart arc path generation

**Bug Fixes:**
- Replaced hardcoded initial transform with dynamic centering
- Replaced `setTimeout` with `ResizeObserver` for layout calculations

**Files Created:**
- `client/src/components/ancestry-tree/utils/lineageColors.ts`
- `client/src/components/ancestry-tree/utils/treeLayout.ts`
- `client/src/components/ancestry-tree/utils/arcGenerator.ts`
- `client/src/components/ancestry-tree/shared/TreeCanvas.tsx`
- `client/src/components/ancestry-tree/shared/TreeControls.tsx`
- `client/src/components/ancestry-tree/shared/AncestorNode.tsx`
- `client/src/components/ancestry-tree/views/HorizontalPedigreeView.tsx`
- `client/src/components/ancestry-tree/views/FanChartView.tsx`
- `client/src/components/ancestry-tree/views/VerticalFamilyView.tsx`

**Files Modified:**
- `client/src/App.tsx` - Added view mode route
- `client/src/components/ancestry-tree/AncestryTreeView.tsx` - View switcher dropdown, URL routing
- `client/src/index.css` - Lineage color CSS variables

### Phase 15.22: Ancestry Free Hints Automation ✅

Automates the processing of free hints on Ancestry.com for accepting record hints:

**Features:**
- **Single Person Processing**: Process all free hints for a person via the "Hints" button
- **Browser Automation**: Playwright-based automation that:
  - Navigates to hints page with free hints filter
  - Clicks "Review" on each hint card
  - Accepts the hint by clicking "Yes" to save
  - Checks "Add" checkboxes for related people
  - Clicks "Save to tree" to complete
- **Progress Tracking**: SSE-based progress events for real-time UI updates
- **Cancellation Support**: In-memory cancellation via Set pattern
- **Rate Limiting**: Uses provider rate limit defaults between hints

**Architecture:**
```
UI Button (ProviderDataTable)
    → API Route (ancestry-hints.routes.ts)
    → Hints Service (ancestry-hints.service.ts)
    → Browser Service (existing Playwright CDP)
    → SSE Progress Events → UI Toast/Progress
```

**Files Created:**
- `server/src/services/ancestry-hints.service.ts` - Core Playwright automation
- `server/src/routes/ancestry-hints.routes.ts` - API endpoints

**Files Modified:**
- `shared/src/index.ts` - `AncestryHintProgress`, `AncestryHintResult` types
- `server/src/index.ts` - Route registration
- `client/src/services/api.ts` - `processAncestryHints()`, `getAncestryHintsStatus()`, `cancelAncestryHints()` methods
- `client/src/components/person/ProviderDataTable.tsx` - "Hints" button with Zap icon
- `client/src/components/person/PersonDetail.tsx` - Handler and state

**API Endpoints:**
- `POST /api/ancestry-hints/:dbId/:personId` - Process hints for a person
- `GET /api/ancestry-hints/:dbId/:personId/events` - SSE progress stream
- `POST /api/ancestry-hints/:dbId/cancel` - Cancel running operation
- `GET /api/ancestry-hints/status` - Check if running

### Phase 16: Multi-Platform Sync (Remaining Items)

- ~~Provider cache structure~~ (completed in 15.11)
- ~~Data comparison UI~~ (completed in 15.11)
- ~~Download/Apply separation~~ (completed in 15.18)
- Golden Copy view mode (merged/curated data with source badges)
- Download/sync UI with progress tracking
- ~~Photo upload to Ancestry~~ (completed in 15.16)
- Bidirectional sync with Ancestry/WikiTree (remaining fields: name, dates, etc.)
- Cross-platform ID linking with matching heuristics
- Conflict resolution UI with value selection

### Phase 17: Real-Time Event System

Replace SSE endpoints with Socket.IO:

- Install `socket.io` / `socket.io-client`
- Create centralized event hub
- Event categories: `database:*`, `indexer:*`, `sync:*`, `browser:*`
- Enable operation cancellation
- Multi-tab coordination

## Documentation

| Document | Description |
|----------|-------------|
| [docs/architecture.md](./docs/architecture.md) | Data model, storage, identity system |
| [docs/api.md](./docs/api.md) | API endpoint reference |
| [docs/cli.md](./docs/cli.md) | CLI command reference |
| [docs/development.md](./docs/development.md) | Development setup guide |
| [docs/providers.md](./docs/providers.md) | Genealogy provider configuration |
| [docs/roadmap.md](./docs/roadmap.md) | Detailed phase documentation |
