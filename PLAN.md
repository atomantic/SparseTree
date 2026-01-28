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
| 16 | Multi-platform sync architecture | 📋 |
| 17 | Real-time event system (Socket.IO) | 📋 |

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

### Phase 15.19: Normalize FamilySearch as Downstream Provider

**Problem:** FamilySearch is currently treated as the "native" source rather than as one of several equal downstream providers. This creates architectural asymmetry:

| Aspect | FamilySearch (Current) | Other Providers |
|--------|------------------------|-----------------|
| Photo naming | `{personId}.jpg` (primary slot) | `{personId}-{provider}.jpg` |
| Cache format | Raw GEDCOMX | Normalized `ScrapedPersonData` |
| Augmentation | Not registered as platform | Registered platforms |
| ID resolution | Checked first, given priority | Secondary lookup |
| Data flow | Downloads → auto-applies | Downloads → requires "Use" to apply |

**Goal:** Make SparseTree the canonical source with ALL providers (including FamilySearch) as equal downstream data sources.

**Changes Required:**

1. **Register FamilySearch in augmentation** (`augmentation.service.ts`)
   - Add to `PLATFORM_REGISTRY` alongside Ancestry/WikiTree/Wikipedia/LinkedIn
   - Enable `linkFamilySearch()`, `scrapeFamilySearch()` methods

2. **Standardize photo storage**
   - Change FamilySearch photos from `{personId}.jpg` to `{personId}-familysearch.jpg`
   - Add migration script for existing photos
   - Primary photo becomes explicitly user-selected, not provider-auto-assigned

3. **Normalize FamilySearch cache format**
   - Transform GEDCOMX → `ScrapedPersonData` format on cache write
   - Update `familysearch-refresh.service.ts` to use normalized format
   - Keep raw GEDCOMX in separate archive path if needed for debugging

4. **Remove FamilySearch priority in ID resolution** (`id-mapping.service.ts`)
   - Equal weight to all provider external IDs
   - Remove `familysearch` special-casing in lookup order

5. **Add "Use" buttons for FamilySearch** (`ProviderDataTable.tsx`)
   - FamilySearch row should behave identically to Ancestry/WikiTree rows
   - Apply FamilySearch data requires explicit user action

6. **Update download flow**
   - FamilySearch download should only cache, not auto-apply (like other providers)
   - Remove any auto-write to SQLite during FamilySearch sync

**Files to Modify:**
- `server/src/services/augmentation.service.ts` - Register FamilySearch as platform
- `server/src/services/id-mapping.service.ts` - Remove FS priority
- `server/src/services/familysearch-refresh.service.ts` - Normalize cache format
- `server/src/services/scraper.service.ts` - Update photo paths
- `server/src/services/multi-platform-comparison.service.ts` - Treat FS equally
- `client/src/components/person/ProviderDataTable.tsx` - FS "Use" buttons
- `scripts/migrate-fs-photos.ts` - **NEW** migration script

**Migration:**
- Rename existing `{personId}.jpg` → `{personId}-familysearch.jpg`
- Update database photo paths if stored
- Prompt users to select primary photo after migration

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
