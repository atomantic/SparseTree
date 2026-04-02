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
| 15.20 | Relationship linking (parents, spouses, children) | ✅ |
| 15.22 | Ancestry free hints automation | ✅ |
| 15.23 | Migration Map visualization | ✅ |
| 16 | Multi-platform sync architecture | 📋 |
| 17 | Real-time event system (Socket.IO) | 📋 |
| 18 | AI Tree Auditor Agent | 📋 |

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

## Better Audit - 2026-03-05

Summary: 105 findings across 60+ files. 1 shared utility to extract (SSE Manager factory).

### Foundation — Shared Utilities

1. **createSseManager** — Generic SSE client manager factory
   - Purpose: Eliminate 3 duplicate SSE manager implementations
   - Replaces: `server/src/utils/sseManager.ts`, `server/src/utils/browserSseManager.ts`, SSE logic in `server/src/services/test-runner.service.ts`
   - Signature: `createSseManager(name: string) => { addClient, removeClient, broadcast }`
   - New file: `server/src/utils/createSseManager.ts`

### File Ownership Map

| File | Primary Category | Reason |
|------|-----------------|--------|
| server/src/index.ts | security | CRITICAL: 0.0.0.0 binding + MEDIUM CORS + MEDIUM SIGTERM |
| server/src/middleware/errorHandler.ts | security | HIGH: stack trace leakage |
| server/src/routes/browser.routes.ts | security | HIGH: token exposure |
| server/src/routes/genealogy-provider.routes.ts | security | HIGH: predictable IDs |
| server/src/routes/ancestry-update.routes.ts | security | MEDIUM: test mode exposed |
| server/src/routes/test-runner.routes.ts | security | MEDIUM: endpoints without auth |
| server/src/db/sqlite.service.ts | security | MEDIUM: DB permissions |
| server/src/services/sync.service.ts | code-quality | HIGH: silent .catch() |
| server/src/services/ai-discovery.service.ts | code-quality | HIGH: try/catch convention |
| server/src/services/multi-platform-comparison.service.ts | code-quality | HIGH: catch handler |
| server/src/services/cache.service.ts | code-quality | MEDIUM: magic numbers |
| server/src/services/id-mapping.service.ts | code-quality | MEDIUM: magic number |
| server/src/services/path.service.ts | code-quality | MEDIUM: magic number + non-null |
| server/src/routes/map.routes.ts | code-quality | MEDIUM: magic number |
| client/src/components/ai/AiDiscoveryModal.tsx | code-quality | LOW: swallowed error |
| client/src/pages/ReportsPage.tsx | code-quality | LOW: swallowed error |
| server/src/services/familysearch-redirect.service.ts | code-quality | LOW: catch returns empty |
| server/src/utils/sseManager.ts | dry | HIGH: duplicate SSE manager |
| server/src/utils/browserSseManager.ts | dry | HIGH: duplicate SSE manager |
| server/src/utils/createSseManager.ts | dry | NEW: shared SSE factory |
| server/src/services/test-runner.service.ts | dry | HIGH: duplicate SSE logic |
| server/src/services/scrapers/ancestry.scraper.ts | dry | HIGH: duplicate checkLoginStatus |
| server/src/services/scrapers/familysearch.scraper.ts | dry | HIGH: duplicate checkLoginStatus |
| server/src/services/scrapers/23andme.scraper.ts | dry | HIGH: duplicate checkLoginStatus |
| server/src/services/scrapers/wikitree.scraper.ts | dry | HIGH: duplicate checkLoginStatus |
| server/src/services/scrapers/base.scraper.ts | dry | HIGH: shared checkLoginStatus target |
| client/src/context/SidebarContext.tsx | dry | MEDIUM: localStorage pattern |
| client/src/context/ThemeContext.tsx | dry | MEDIUM: localStorage pattern |
| server/src/services/search.service.ts | bugs-perf | HIGH: N+1 query |
| server/src/lib/graph/pathLongest.ts | bugs-perf | HIGH: memory leak |
| server/src/routes/ai-discovery.routes.ts | bugs-perf | HIGH: missing error forwarding |
| server/src/routes/ancestry-hints.routes.ts | bugs-perf | HIGH: missing error forwarding |
| server/src/routes/augmentation.routes.ts | bugs-perf | HIGH: error forwarding + stream |
| server/src/services/browser.service.ts | bugs-perf | MEDIUM: missing await |
| server/src/middleware/requestTimeout.ts | bugs-perf | MEDIUM: timer cleanup + magic numbers |
| server/src/services/geocode.service.ts | bugs-perf | MEDIUM: promise chaining + deadlock |
| server/src/routes/sync.routes.ts | bugs-perf | MEDIUM: fire-and-forget |
| client/src/hooks/useSSE.ts | stack-specific | CRITICAL: addEventListener leak |
| client/src/components/integrity/IntegrityPage.tsx | stack-specific | HIGH: missing EventSource error |
| client/src/components/ui/CopyButton.tsx | stack-specific | MEDIUM: setTimeout cleanup |
| client/src/components/ancestry-tree/shared/TreeCanvas.tsx | stack-specific | MEDIUM: D3 zoom cleanup |

### Security & Secrets
- [x] ~~[CRITICAL] server/src/index.ts — Server binds to 0.0.0.0. Fix: bind to localhost, configurable via env.~~ (Fixed: defaults to localhost)
- [ ] **[CRITICAL]** `package.json` — npm audit: form-data, react-router, qs, pm2 vulnerabilities. Fix: npm audit fix. (Medium)
- [x] ~~[HIGH] server/src/routes/genealogy-provider.routes.ts — Predictable ID via Date.now(). Fix: use ULID/UUID.~~ (Fixed: crypto.randomUUID())
- [x] ~~[HIGH] server/src/middleware/errorHandler.ts — Stack traces leaked to logs. Fix: sanitize in production.~~ (Fixed: gated by NODE_ENV)
- [x] ~~[HIGH] server/src/routes/browser.routes.ts — FS auth token returned in JSON.~~ (Documented: acceptable for local-only tool with short-lived tokens)
- [x] ~~[MEDIUM] server/src/index.ts — CORS origin parsing without URL validation. Fix: validate each origin.~~ (Fixed: URL() constructor validates)
- [x] ~~[MEDIUM] server/src/routes/ancestry-update.routes.ts — testMode query param not gated by NODE_ENV.~~ (Fixed: gated behind production check)
- [x] ~~[MEDIUM] server/src/routes/test-runner.routes.ts — Test runner endpoints exposed without auth.~~ (Fixed: gated by NODE_ENV)
- [x] ~~[MEDIUM] server/src/db/sqlite.service.ts — DB file without explicit restrictive permissions.~~ (Fixed: 0o600 on creation)
- [x] ~~[LOW] server/src/services/credentials.service.ts — key stored in plaintext hex~~ (tracked, not auto-remediated)
- [x] ~~[LOW] server/src/routes/browser.routes.ts:189 — path traversal check order~~ (tracked)
- [x] ~~[LOW] server/src/routes/ai-discovery.routes.ts:208 — debug endpoints gated by env~~ (tracked)
- [x] ~~[LOW] server/src/utils/validation.ts:28-33 — regex may miss edge cases~~ (tracked)

### Code Quality & Style
- [x] ~~[HIGH] server/src/services/sync.service.ts — Silent .catch(() => null/{}). Fix: log errors before returning null.~~ (Fixed: added logger.warn to all page.close catches, findMatch catch)
- [x] ~~[HIGH] server/src/services/multi-platform-comparison.service.ts — Catch handler returns undefined. Fix: explicit return in catch.~~ (Fixed: error logging added)
- [x] ~~[HIGH] server/src/services/ai-discovery.service.ts — try/catch for JSON parsing violates convention. Fix: use functional parsing.~~ (Fixed: functional safeJsonParse)
- [x] ~~[MEDIUM] server/src/services/path.service.ts — Unsafe queue.shift()! non-null assertions. Fix: optional chaining + early return.~~ (Fixed: safe shift with early return)
- [x] ~~[MEDIUM] server/src/middleware/requestTimeout.ts — Magic numbers 120000, 10000. Fix: named constants.~~ (Fixed: LONG_TIMEOUT_MS, SHORT_TIMEOUT_MS)
- [x] ~~[MEDIUM] server/src/services/cache.service.ts — Magic numbers for cache sizes/TTLs. Fix: named constants.~~ (Fixed: QUERY_CACHE_MAX_SIZE etc.)
- [x] ~~[MEDIUM] server/src/services/id-mapping.service.ts — Magic number 0.1 eviction ratio. Fix: named constant.~~ (Fixed: EVICTION_RATIO)
- [x] ~~[MEDIUM] server/src/routes/map.routes.ts — Magic number 15 for MAX_DEPTH. Fix: file-level constant.~~ (Fixed: MAX_DEPTH constant)
- [x] ~~[LOW] client/src/components/ai/AiDiscoveryModal.tsx:32 — swallowed fetch error~~ (tracked)
- [x] ~~[LOW] client/src/pages/ReportsPage.tsx:68 — swallowed initialization error~~ (tracked)

### DRY & YAGNI
- [x] ~~[HIGH] server/src/utils/sseManager.ts, browserSseManager.ts, test-runner.service.ts — 3 duplicate SSE manager implementations. Fix: extract createSseManager factory.~~ (Fixed: createSseManager factory)
- [x] ~~[HIGH] server/src/utils/sseManager.ts, browserSseManager.ts — Duplicate SSE response init. Fix: use existing initSSE() from sseHelpers.ts.~~ (Fixed)
- [x] ~~[HIGH] server/src/services/scrapers/*.ts (4 files) — Duplicate checkLoginStatus across all scrapers.~~ (Reviewed: provider-specific detection logic prevents clean extraction; each uses different selectors, URL patterns, and visibility checks)
- [x] ~~[MEDIUM] client/src/context/SidebarContext.tsx, ThemeContext.tsx — Duplicate localStorage sync pattern. Fix: extract useLocalStorage hook.~~ (Fixed: useLocalStorage hook)

### Architecture & SOLID
Architecture findings are tracked but not auto-remediated (all Complex, high risk of regression):
- [ ] **[HIGH]** `server/src/services/augmentation.service.ts` — 1457-line god file, 5 responsibilities. (Complex)
- [ ] **[HIGH]** `server/src/services/multi-platform-comparison.service.ts` — 1095-line god file. (Complex)
- [ ] **[HIGH]** `server/src/services/favorites.service.ts` — 883-line god file. (Complex)
- [ ] **[HIGH]** `server/src/services/database.service.ts` — 1073-line god file. (Complex)
- [ ] **[HIGH]** `client/src/components/person/PersonDetail.tsx` — 1322-line god component. (Complex)
- [ ] **[HIGH]** `client/src/components/ancestry-tree/views/VerticalFamilyView.tsx` — 977-line god component. (Complex)
- [ ] **[HIGH]** `client/src/components/person/ProviderDataTable.tsx` — 1243-line god component. (Complex)
- [ ] **[MEDIUM]** `client/src/services/api.ts` — 1123-line god client with 50+ methods. (Simple to split)
- [ ] **[MEDIUM]** `server/src/routes/person.routes.ts` — Business logic mixed into route handlers. (Simple)

### Bugs, Performance & Error Handling
- [x] ~~[HIGH] server/src/services/search.service.ts — N+1 query in search results. Fix: batch WHERE IN query.~~ (Fixed: Promise.all batching)
- [x] ~~[HIGH] server/src/lib/graph/pathLongest.ts — Memory leak from path copying in BFS. Fix: track IDs only, reconstruct at end.~~ (Fixed: reconstruct ancestors from parentOf chain on demand)
- [x] ~~[HIGH] server/src/routes/ai-discovery.routes.ts — Missing error forwarding. Fix: use asyncHandler wrapper.~~ (Fixed: asyncHandler added)
- [x] ~~[HIGH] server/src/routes/ancestry-hints.routes.ts — Missing error forwarding. Fix: use asyncHandler.~~ (Fixed: asyncHandler added)
- [x] ~~[HIGH] server/src/routes/augmentation.routes.ts — Missing error forwarding. Fix: use asyncHandler.~~ (Fixed: asyncHandler added)
- [x] ~~[MEDIUM] server/src/routes/augmentation.routes.ts — Stream pipe without error handling.~~ (Fixed: stream.on('error') handler added)
- [x] ~~[MEDIUM] server/src/services/browser.service.ts — Missing await on broadcastStatusUpdate.~~ (Fixed: await added)
- [x] ~~[MEDIUM] server/src/middleware/requestTimeout.ts — Timer not cleared on error response.~~ (Fixed: res.on('finish'/'close') cleanup)
- [x] ~~[MEDIUM] server/src/services/geocode.service.ts — Incorrect promise chaining swallows errors.~~ (Fixed: proper error handler)
- [x] ~~[MEDIUM] server/src/services/geocode.service.ts — Rate limit queue can deadlock.~~ (Fixed: .then(work, work) pattern)
- [x] ~~[MEDIUM] server/src/routes/sync.routes.ts — Silent .catch in findMatch. Fix: log errors.~~ (Fixed: added error logging)

### Stack-Specific (Node/React)
- [x] ~~[CRITICAL] client/src/hooks/useSSE.ts — addEventListener not cleaned up, memory leak.~~ (Fixed: removeEventListener in cleanup)
- [x] ~~[HIGH] client/src/components/integrity/IntegrityPage.tsx — Missing EventSource error handler.~~ (Fixed: onerror handler added)
- [x] ~~[MEDIUM] client/src/components/ui/CopyButton.tsx — setTimeout without cleanup on unmount.~~ (Fixed: clearTimeout in useEffect cleanup)
- [x] ~~[MEDIUM] client/src/components/ancestry-tree/shared/TreeCanvas.tsx — D3 zoom cleanup.~~ (Fixed: .on('.zoom', null) cleanup)
- [x] ~~[MEDIUM] server/src/index.ts — No SIGTERM/SIGINT handlers.~~ (addressed in security category)

### Test Quality & Coverage
Handled in Phase 4c. Key findings:
- [ ] **[CRITICAL][MISSING]** credentials.service.ts — 0 tests for encryption/decryption
- [ ] **[CRITICAL][MISSING]** validation.ts — 0 tests for input validation/sanitization
- [ ] **[CRITICAL][MISSING]** errorHandler.ts — 0 tests for global error handler
- [ ] **[CRITICAL][MISSING]** requestTimeout.ts — 0 tests for timeout middleware
- [ ] **[CRITICAL][MISSING]** database.service.ts — 1073 lines, no unit tests
- [ ] **[CRITICAL][MISSING]** search.service.ts — N+1 pattern, no unit tests
- [ ] **[CRITICAL][MISSING]** augmentation.service.ts — 1457 lines, 0 tests
- [ ] **[HIGH][MISSING]** 68 of 74 services have no unit tests
- [ ] **[HIGH][MISSING]** All 80+ client components have 0 tests
- [ ] **[MEDIUM][WEAK]** tests/unit/lib/json2person.spec.ts:118 — toBeDefined() too weak
- [ ] **[MEDIUM][WEAK]** tests/integration/api/persons.spec.ts:22 — pagination not verified
- [ ] **[MEDIUM][WEAK]** tests/unit/lib/pathRandom.spec.ts:54 — only checks first/last node
- [ ] **[MEDIUM][WEAK]** tests/unit/lib/pathLongest.spec.ts:120 — cycle test doesn't verify correctness
- [ ] **[MEDIUM][WEAK]** tests/integration/api/search.spec.ts:31 — substring matching too loose
- [ ] **[MEDIUM][WEAK]** tests/integration/setup.ts:85 — test DB doesn't use real services
- [ ] **[LOW][VACUOUS]** tests/unit/lib/json2person.spec.ts:198 — asserts on test data not function
- [ ] **[LOW][VACUOUS]** tests/unit/lib/pathShortest.spec.ts:115 — doesn't verify no-revisit claim

---

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

### Phase 15.23: Migration Map Visualization ✅

A 6th tree view mode plotting ancestors on an interactive Leaflet.js map with lineage-colored markers, parent-child migration lines, time filtering, and layer controls.

**Features:**
- **Migration Map view mode** - Available in the tree view mode dropdown alongside Fan, Horizontal, Vertical, Columns, Focus
- **Leaflet.js map** with OpenStreetMap tiles (light) and CartoDB dark tiles (dark theme)
- **Lineage-colored markers** - Paternal (blue/teal), Maternal (red/coral), Self (purple)
- **Migration polylines** connecting parent birth locations to child birth locations
- **Time range slider** filtering ancestors by birth year
- **Paternal/Maternal layer toggles** for lineage filtering
- **Auto-fit bounds** on data load
- **Click popups** with person name, lifespan, places, and link to person detail
- **Geocoding service** using Nominatim with 1100ms rate limiting and permanent SQLite cache
- **Geocode progress bar** with SSE streaming for batch geocoding
- **Sparse tree map page** at `/favorites/sparse-tree/:dbId/map`

**Architecture:**
```
Database: place_geocode table (SQLite cache)
    → Geocode Service (Nominatim + cache)
    → Map Service (tree data + coordinate joining)
    → Map Routes (REST + SSE geocode stream)
    → MigrationMapView (Leaflet + react-leaflet)
```

**Routes:**
- `/tree/:dbId/:personId/map` - Ancestry tree migration map
- `/favorites/sparse-tree/:dbId/map` - Sparse tree (favorites) migration map

**API Endpoints:**
- `GET /api/map/:dbId/:personId` - Ancestry tree map data
- `GET /api/map/:dbId/sparse` - Sparse tree map data
- `GET /api/map/geocode/stream` - Batch geocode via SSE (EventSource)
- `GET /api/map/geocode/stats` - Geocode cache statistics
- `POST /api/map/geocode/reset-not-found` - Reset failed entries for retry

**Files Created:**
- `server/src/db/migrations/006_place_geocode.ts` - Place geocode cache table
- `server/src/services/geocode.service.ts` - Nominatim geocoding + SQLite cache
- `server/src/services/map.service.ts` - Map data assembly
- `server/src/routes/map.routes.ts` - REST + SSE endpoints
- `client/src/components/ancestry-tree/views/MigrationMapView.tsx` - Leaflet map component
- `client/src/components/favorites/SparseTreeMapPage.tsx` - Sparse tree map page
- `client/src/components/map/GeocodeProgressBar.tsx` - Geocode progress UI
- `client/src/components/map/mapUtils.ts` - Marker/line utilities

**Files Modified:**
- `server/src/db/migrations/index.ts` - Register migration 006
- `server/src/db/schema.sql` - Add place_geocode table
- `server/src/index.ts` - Mount mapRouter
- `shared/src/index.ts` - MapCoords, MapPerson, MapData, GeocodeProgress types
- `client/package.json` - leaflet, react-leaflet, @types/leaflet deps
- `client/src/services/api.ts` - Map API methods
- `client/src/components/ancestry-tree/AncestryTreeView.tsx` - Add 'map' view mode
- `client/src/App.tsx` - Sparse tree map route

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

### Phase 18: AI Tree Auditor Agent

Long-running background agent that walks a family tree from a root person, validates data integrity, fills coverage gaps across providers, and reconciles conflicting information. Operates in review-first mode by default with configurable auto-accept.

#### 18.1: Schema & Persistence Layer

New SQLite tables for audit state that survives server restarts:

```sql
-- Track audit runs (persistent job state)
audit_run (
  run_id TEXT PRIMARY KEY,        -- ULID
  db_id TEXT NOT NULL,
  root_person_id TEXT NOT NULL,
  status TEXT NOT NULL,            -- queued|running|paused|completed|cancelled|error
  config JSON NOT NULL,            -- depth_limit, checks_enabled, auto_accept, batch_size
  cursor JSON,                     -- BFS resume point (current generation, pending queue)
  started_at TEXT,
  paused_at TEXT,
  completed_at TEXT,
  persons_checked INTEGER DEFAULT 0,
  issues_found INTEGER DEFAULT 0,
  fixes_applied INTEGER DEFAULT 0,
  error_message TEXT
)

-- Issues found by the auditor (review queue)
audit_issue (
  issue_id TEXT PRIMARY KEY,       -- ULID
  run_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  issue_type TEXT NOT NULL,        -- see types below
  severity TEXT NOT NULL,          -- error|warning|info
  description TEXT NOT NULL,
  current_value TEXT,              -- what we have now
  suggested_value TEXT,            -- what the auditor recommends
  suggested_source TEXT,           -- which provider the fix comes from
  status TEXT DEFAULT 'open',      -- open|accepted|rejected|auto_applied
  resolved_at TEXT,
  created_at TEXT NOT NULL
)

-- Log of changes actually applied (undo support)
audit_change (
  change_id TEXT PRIMARY KEY,      -- ULID
  issue_id TEXT,                   -- nullable (manual changes)
  person_id TEXT NOT NULL,
  table_name TEXT NOT NULL,        -- person|vital_event|parent_edge|external_identity|claim
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  applied_at TEXT NOT NULL
)
```

**Issue types:**
- `impossible_date` — born after death, burial before death
- `parent_age_conflict` — parent younger than child or age gap > 80
- `placeholder_name` — matches known unknowns list
- `missing_gender` — no gender assigned
- `coverage_gap` — person exists in provider A but not B
- `date_mismatch` — providers disagree on birth/death/marriage date
- `place_mismatch` — providers disagree on locations
- `name_mismatch` — providers disagree on name
- `missing_parents` — provider shows parents we don't have locally
- `stale_record` — provider data older than threshold
- `orphaned_edge` — parent_edge references non-existent person
- `duplicate_suspect` — possible duplicate person across providers

**Migration:** `scripts/migrate.ts` migration to create audit tables.

#### 18.2: Auditor Service Core

`server/src/services/auditor-agent.service.ts` — the main agent loop:

- **BFS walk** from root person, generation by generation
- **Per-person audit pipeline** runs configured checks in order:
  1. Structural validation (dates, names, gender, relationships)
  2. Coverage gap check (which providers are missing?)
  3. Cross-provider data comparison (dates, places, names differ?)
  4. Stale record detection (last fetched > N days ago)
- **Configurable options:**
  - `depthLimit: number | null` — max generations from root (null = unlimited)
  - `checksEnabled: string[]` — which check types to run
  - `autoAccept: boolean` — auto-apply fixes or queue for review (default: false)
  - `autoAcceptTypes: string[]` — when autoAccept=true, which issue types to auto-apply
  - `batchSize: number` — persons per batch before yielding progress
  - `staleDays: number` — threshold for stale record detection (default: 30)
- **Async generator pattern** yielding `AuditorProgress` events for SSE streaming
- **Pause/resume** via cursor serialization (current BFS queue saved to `audit_run.cursor`)
- **Cancel** via operation tracker (existing pattern)
- **Rate-limit aware** — uses existing provider delay config, won't exceed API limits
- **Idempotent** — re-running on same tree skips already-checked persons (within same run)

#### 18.3: Validation Checks

Individual check functions, each returning `AuditIssue[]`:

**Structural checks** (local data only, fast):
- Date logic: birth < death < burial, christening near birth
- Parent age: parent born 12-80 years before child
- Spouse age: marriage after both spouses born
- Placeholder names: match against `KNOWN_UNKNOWNS` list from config
- Missing gender on persons with parent_role = father/mother
- Self-referential edges

**Coverage checks** (requires provider API calls):
- For each person, check which providers have external_identity records
- For missing providers, attempt discovery via existing parent-discovery patterns
- Use FamilySearch API (token auth) and Ancestry scraper (browser auth)
- Log `coverage_gap` issues with suggested provider link

**Cross-provider reconciliation** (requires provider API calls):
- Fetch current data from each linked provider
- Compare: name, birth date/place, death date/place, parents
- When values differ, create `*_mismatch` issue with both values
- Suggested fix: prefer highest-confidence source, or flag for review
- Uses existing `multi-platform-comparison.service.ts` patterns

**Stale record refresh:**
- Check `last_seen_at` on external_identity records
- If older than `staleDays`, re-fetch from provider
- Detect upstream merges/deletes (FamilySearch redirect handling)

#### 18.4: API Endpoints

`server/src/routes/auditor.routes.ts`:

```
POST   /api/audit/:dbId/start          — Start new audit run (config in body)
POST   /api/audit/:dbId/:runId/pause   — Pause running audit
POST   /api/audit/:dbId/:runId/resume  — Resume paused audit
POST   /api/audit/:dbId/:runId/cancel  — Cancel audit
GET    /api/audit/:dbId/:runId/events  — SSE stream for progress
GET    /api/audit/:dbId/runs           — List audit runs (history)
GET    /api/audit/:dbId/:runId         — Get run details + summary

GET    /api/audit/:dbId/issues         — List issues (filterable by type, severity, status)
POST   /api/audit/:dbId/issues/accept  — Bulk accept issues (apply fixes)
POST   /api/audit/:dbId/issues/reject  — Bulk reject issues (dismiss)
GET    /api/audit/:dbId/issues/:id     — Get single issue detail
POST   /api/audit/:dbId/issues/:id/accept  — Accept single issue
POST   /api/audit/:dbId/issues/:id/reject  — Reject single issue

GET    /api/audit/:dbId/changes        — Audit change log (what was modified)
POST   /api/audit/:dbId/changes/:id/undo  — Undo a specific change
```

#### 18.5: Issue Resolution Engine

`server/src/services/auditor-resolver.service.ts`:

- **Accept issue** → apply the `suggested_value` to the database
  - Write to appropriate table (person, vital_event, external_identity, etc.)
  - Record in `audit_change` with old/new values
  - Mark issue as `accepted`
- **Reject issue** → mark as `rejected`, no data change
- **Bulk accept** → accept multiple issues atomically (SQLite transaction)
- **Undo change** → restore `old_value` from `audit_change`, reopen issue
- **Auto-accept mode** — when enabled, resolver runs inline during audit
  - Only auto-accepts configured issue types (e.g., `coverage_gap`, `stale_record`)
  - Never auto-accepts destructive changes (deletions, name overwrites)

#### 18.6: Audit Dashboard UI

`client/src/components/audit/` — new route `/databases/:id/audit`:

- **Run Control Panel** — start/pause/resume/cancel, configure options
  - Depth limit slider
  - Checkboxes for which checks to enable
  - Auto-accept toggle with type selection
  - Real-time progress bar (persons checked, issues found)
- **Issue Queue** — filterable table of open issues
  - Columns: person name, issue type, severity, current vs suggested value, source
  - Bulk select + accept/reject
  - Click to expand issue detail with full context
  - Link to person detail page
- **Run History** — past audit runs with summary stats
- **Change Log** — applied changes with undo buttons
- **Health Score** — overall tree quality metric
  - % of persons with all providers linked
  - % of persons with consistent cross-provider data
  - % of persons with fresh (non-stale) data
  - Trend over time (per audit run)

#### Implementation Order

1. **18.1** Schema + migration (foundation)
2. **18.2** Core service with structural checks only (no API calls needed, fast to validate)
3. **18.3** Add coverage + reconciliation checks (requires API integration)
4. **18.4** API endpoints
5. **18.5** Issue resolution engine (accept/reject/undo)
6. **18.6** Dashboard UI

#### Dependencies

- Phase 15.17 (data integrity service) — ✅ completed, reuse patterns
- Phase 15.15 (parent discovery) — ✅ completed, reuse for coverage gaps
- Phase 15.11 (multi-platform comparison) — ✅ completed, reuse for reconciliation
- FamilySearch token auth — ✅ existing
- Ancestry browser auth — ✅ existing
- SSE streaming — ✅ existing pattern (indexer, bulk discovery)
- Operation tracker — ✅ existing utility

## Documentation

| Document | Description |
|----------|-------------|
| [docs/architecture.md](./docs/architecture.md) | Data model, storage, identity system |
| [docs/api.md](./docs/api.md) | API endpoint reference |
| [docs/cli.md](./docs/cli.md) | CLI command reference |
| [docs/development.md](./docs/development.md) | Development setup guide |
| [docs/providers.md](./docs/providers.md) | Genealogy provider configuration |
| [docs/roadmap.md](./docs/roadmap.md) | Detailed phase documentation |
