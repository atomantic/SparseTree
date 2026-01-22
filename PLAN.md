# Multi-Platform Genealogy Data Architecture

## Status: IMPLEMENTED

All phases have been completed. The new architecture supports:
- Richer person data extraction from FamilySearch (gender, living, birth/death objects, spouses, multiple occupations, alternate names)
- Multi-platform augmentation (Wikipedia, with support for future platforms like FindAGrave, Heritage, etc.)
- Backwards compatibility with existing data through computed fields (lifespan, location, occupation)

---

## Implementation Summary

### Phase 1: Shared Type Definitions ✅
**File:** `shared/src/index.ts`

New types added:
- `VitalEvent` - Birth/death/burial with date, dateFormal, place, placeId
- `Person` - Enhanced with gender, living, birth/death/burial objects, occupations[], spouses[], alternateNames[], lastModified
- `PlatformReference` - Cross-platform linking (familysearch, wikipedia, findagrave, etc.)
- `PersonPhoto` - Photo with url, source, localPath, isPrimary
- `PersonDescription` - Description with text, source, language
- `PersonAugmentation` - Multi-platform augmentation record

### Phase 2: Enhanced Person Extraction ✅
**File:** `lib/json2person.js`

Now extracts:
- `alternateNames[]` - From AlsoKnownAs and non-preferred BirthName entries
- `gender` - male/female/unknown from GEDCOMX type
- `living` - Boolean flag
- `birth` - Object with date, dateFormal, place, placeId
- `death` - Object with date, dateFormal, place, placeId
- `burial` - Object with date, place
- `occupations[]` - All occupations AND titles (nobility)
- `spouses[]` - Spouse IDs from familiesAsParent
- `lastModified` - Most recent modification timestamp

Maintains backwards compatibility:
- `lifespan` - Computed from birth.date and death.date
- `location` - First available place (birth or death)
- `occupation` - First occupation

### Phase 3: Database Rebuild Script ✅
**File:** `rebuild.js`

Usage:
```bash
node rebuild DB_ID           # Rebuild specific database
node rebuild --all           # Rebuild all databases
```

### Phase 4: Augmentation Migration ✅
**File:** `server/src/services/augmentation.service.ts`

New features:
- Multi-platform support with `platforms[]` array
- Photos array with url, source, localPath, isPrimary
- Descriptions array with text, source, language
- Automatic migration of legacy Wikipedia-only augmentations
- Helper methods: `addPlatform()`, `addPhoto()`, `addDescription()`, `getPrimaryPhoto()`, `getPrimaryDescription()`, `hasPlatform()`, `getLinkedPlatforms()`

### Phase 5: UI Updates ✅
**File:** `client/src/components/person/PersonDetail.tsx`

New displays:
- Gender badge (male/female)
- Alternate names list
- Separate Birth/Death/Burial cards with date and place
- All occupations as badges
- Spouses section with links
- Platform badges showing linked sources (Wikipedia, etc.)
- Backwards compatibility for old data without new fields

**File:** `server/src/services/search.service.ts`

Updated to search:
- New `birth.date` and `birth.place` fields
- New `occupations[]` array
- `alternateNames[]` in text search

---

## Data Structure Examples

### New Person Record
```json
{
  "name": "Guy le Strange",
  "alternateNames": ["Guy De Wallense", "Guy Wallace"],
  "gender": "male",
  "living": false,
  "birth": {
    "date": "Abt 1048",
    "dateFormal": "+1048",
    "place": "England"
  },
  "death": {
    "date": "1105",
    "dateFormal": "+1105",
    "place": "London City, Middlesex, England"
  },
  "occupations": ["Sheriff of Metz"],
  "spouses": ["GZ79-RNZ"],
  "parents": ["PARENT-ID-1", "PARENT-ID-2"],
  "children": [],
  "lastModified": "2024-01-15T10:30:00.000Z",
  "lifespan": "1048-1105",
  "location": "England",
  "occupation": "Sheriff of Metz"
}
```

### New Augmentation Record
```json
{
  "id": "PERSON-ID",
  "platforms": [
    {
      "platform": "wikipedia",
      "url": "https://en.wikipedia.org/wiki/...",
      "linkedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "photos": [
    {
      "url": "https://upload.wikimedia.org/...",
      "source": "wikipedia",
      "localPath": "/data/photos/PERSON-ID-wiki.jpg",
      "isPrimary": true,
      "downloadedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "descriptions": [
    {
      "text": "Guy le Strange was a medieval nobleman...",
      "source": "wikipedia",
      "language": "en"
    }
  ],
  "customBio": "Additional notes...",
  "notes": "Research notes...",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

---

## Multi-Provider Genealogy System (Phase 6) ✅

### Overview
Added support for configuring multiple genealogy providers (FamilySearch, MyHeritage, Geni, WikiTree, FindMyPast) and mapping database nodes to provider records.

### Supported Providers

| Provider | Auth | Rate Limits |
|----------|------|-------------|
| FamilySearch | Session Token | 100 req/60s |
| MyHeritage | OAuth 2.0 | 60 req/60s |
| Geni | OAuth 2.0 | 40 req/10s |
| WikiTree | None (public) | 60 req/60s |
| FindMyPast | API Key | 30 req/60s |
| Ancestry | OAuth 2.0 | 30 req/60s |
| Find A Grave | None | 20 req/60s |

### New Types (shared/src/index.ts)
- `GenealogyAuthType` - oauth2, api_key, session_token, none
- `GenealogyProviderConfig` - Provider configuration with credentials and rate limits
- `GenealogyProviderRegistry` - Active provider and all configured providers
- `ProviderPersonMapping` - Link between a person and an external provider record

### New Backend Service
**File:** `server/src/services/genealogy-provider.service.ts`

Methods:
- `getProviders()` - Get all configured providers
- `getProvider(id)` - Get single provider
- `saveProvider(config)` - Create/update provider
- `deleteProvider(id)` - Remove provider
- `setActiveProvider(id)` - Set active provider for indexing
- `testConnection(id)` - Test provider connectivity
- `getProviderDefaults(platform)` - Get default settings for a platform

### New API Routes
**File:** `server/src/routes/genealogy-provider.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/genealogy-providers | List all providers |
| GET | /api/genealogy-providers/:id | Get single provider |
| POST | /api/genealogy-providers | Create provider |
| PUT | /api/genealogy-providers/:id | Update provider |
| DELETE | /api/genealogy-providers/:id | Delete provider |
| POST | /api/genealogy-providers/:id/test | Test connection |
| POST | /api/genealogy-providers/:id/activate | Set as active |
| GET | /api/genealogy-providers/platforms | List available platforms |
| GET | /api/genealogy-providers/defaults/:platform | Get platform defaults |

### Person-Provider Linking
**Extended:** `server/src/routes/augmentation.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/augment/:personId/provider-link | Link person to provider |
| DELETE | /api/augment/:personId/provider-link/:providerId | Unlink |
| GET | /api/augment/:personId/provider-links | Get all links |

### Frontend Pages
**New files:**
- `client/src/pages/GenealogyProviders.tsx` - Provider list with status, test, activate
- `client/src/pages/GenealogyProviderEdit.tsx` - Form for creating/editing providers

**Routes:** `/providers/genealogy`, `/providers/genealogy/new`, `/providers/genealogy/:id/edit`

### Person Detail Updates
**File:** `client/src/components/person/PersonDetail.tsx`

- Added "Provider Links" section
- Link person to any configured provider with URL and external ID
- Confidence indicator (high/medium/low)
- Open in provider button
- Unlink action

### Data Storage
- Provider config: `data/genealogy-providers.json`
- Person mappings: `data/augment/{personId}.json` (providerMappings array)

---

## Favorites & Sparse Family Tree (Phase 7) ✅

### Overview
Added ability to mark people as "favorites" with notes about why they're interesting, view all favorites on a dedicated page, and generate a sparse family tree visualization showing the lineage from root to selected interesting ancestors.

### New Types (shared/src/index.ts)
- `FavoriteData` - isFavorite, whyInteresting, addedAt, tags[]
- `SparseTreeNode` - Node for visualization with generation info
- `SparseTreeResult` - Tree root, totalFavorites, maxGeneration
- `FavoriteWithPerson` - Favorite with person details for listing
- `FavoritesList` - Paginated list of favorites with allTags

### Extended Type
- `PersonAugmentation` - Added `favorite?: FavoriteData` field

### Backend Services
**File:** `server/src/services/favorites.service.ts`
- `getFavorite(personId)` - Get favorite status
- `setFavorite(personId, whyInteresting, tags)` - Mark as favorite
- `updateFavorite(personId, whyInteresting, tags)` - Update favorite
- `removeFavorite(personId)` - Remove from favorites
- `listFavorites(page, limit)` - List all favorites with pagination
- `getFavoritesInDatabase(dbId)` - Get favorites in a specific database
- `getAllTags()` - Get all unique tags

**File:** `server/src/services/sparse-tree.service.ts`
- `getSparseTree(dbId)` - Generate sparse tree showing only favorites

### API Routes
**File:** `server/src/routes/favorites.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/favorites | List all favorites (paginated) |
| GET | /api/favorites/tags | Get preset and all tags |
| GET | /api/favorites/in-database/:dbId | Get favorites in database |
| GET | /api/favorites/sparse-tree/:dbId | Get sparse tree visualization |
| GET | /api/favorites/:personId | Get favorite status |
| POST | /api/favorites/:personId | Mark as favorite |
| PUT | /api/favorites/:personId | Update favorite |
| DELETE | /api/favorites/:personId | Remove from favorites |

### Frontend Components
**New files:**
- `client/src/components/favorites/FavoriteButton.tsx` - Star toggle button
- `client/src/components/favorites/WhyInterestingModal.tsx` - Modal for adding/editing favorites
- `client/src/components/favorites/FavoritesPage.tsx` - List of all favorites with filtering
- `client/src/components/favorites/SparseTreePage.tsx` - D3.js visualization of sparse tree

**Routes:** `/favorites`, `/favorites/sparse-tree/:dbId`

### Navigation Updates
**File:** `client/src/components/layout/Sidebar.tsx`
- Added "Favorites" link to primary navigation
- Added "Sparse Tree" link to database-specific navigation

### PersonDetail Integration
**File:** `client/src/components/person/PersonDetail.tsx`
- Added FavoriteButton next to gender badge

### Preset Tags
- royalty, immigrant, revolutionary, founder, notable, military, religious
- scientist, artist, politician, explorer, criminal

### Sparse Tree Features
- Vertical layout (root at top)
- Shows only favorites and branch points
- Generation skip labels on edges (e.g., "12 gen")
- Node cards with photo, name, lifespan, tags
- Click to see details panel
- Zoom/pan controls
- SVG export functionality

---

## FamilySearch-Style Ancestry Tree (Phase 8) ✅

### Overview
Replaced the simple D3 tree view with a FamilySearch-style ancestry visualization featuring:
- Paired father/mother cards with gender-colored borders (blue/pink)
- Circular photos with fallback placeholders
- Click-to-expand ">" buttons for lazy loading ancestors
- Horizontal layout (root left, ancestors right)
- Gray connection lines between family units
- D3.js-powered zoom/pan

### New Types (shared/src/index.ts)
- `AncestryPersonCard` - Person card data with id, name, lifespan, gender, photoUrl, hasMoreAncestors
- `AncestryFamilyUnit` - Family unit with father/mother cards and nested parentUnits
- `AncestryTreeResult` - Full tree with rootPerson, rootSpouse, parentUnits, maxGenerationLoaded
- `ExpandAncestryRequest` - Request to expand a specific person's ancestors

### Backend Service
**File:** `server/src/services/ancestry-tree.service.ts`

Methods:
- `getAncestryTree(dbId, personId, depth)` - Build ancestry tree (default 4 generations)
- `expandAncestry(dbId, fatherId, motherId, depth)` - Expand specific parents for lazy loading

Photo resolution priority:
1. Wikipedia photo (from augmentation)
2. Scraped FamilySearch photo
3. Placeholder icon

### API Routes
**File:** `server/src/routes/ancestry-tree.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/ancestry-tree/:dbId/:personId | Get ancestry tree (4 gen default) |
| POST | /api/ancestry-tree/:dbId/expand | Expand specific parents |

### Client API
**File:** `client/src/services/api.ts`
- `getAncestryTree(dbId, personId, depth)` - Fetch ancestry tree
- `expandAncestryGeneration(dbId, request, depth)` - Expand ancestors lazily

### Frontend Components
**New folder:** `client/src/components/ancestry-tree/`

| Component | Description |
|-----------|-------------|
| `PersonCard.tsx` | Individual person card with photo, name, lifespan, gender border, expand button |
| `FamilyUnitCard.tsx` | Vertical stack of father/mother PersonCards |
| `ConnectionLine.tsx` | SVG path components for tree connections |
| `AncestryTreeView.tsx` | Main component with D3 zoom/pan, recursive rendering |
| `index.ts` | Barrel export |

### Styling
- Male border: `border-l-4 border-blue-500`
- Female border: `border-l-4 border-pink-500`
- Unknown border: `border-l-4 border-gray-500`
- Circular 48px photos with User icon fallback
- Dark theme compatible colors

### Routes Updated
**File:** `client/src/App.tsx`
- `/tree/:dbId` → `AncestryTreeView` (replaced old TreeView)
- `/tree/:dbId/:personId` → `AncestryTreeView`

---

## Browser-Based Genealogy Provider System (Phase 9) ✅

### Overview
Transformed the genealogy provider system from API-based to browser scraping automation. Added 4 built-in providers with browser-based session checking, GEDCOM import/export, and cross-provider sync capabilities.

### Built-in Providers

| Provider | Login URL | Tree URL |
|----------|-----------|----------|
| FamilySearch | familysearch.org/auth/familysearch/login | familysearch.org/tree/pedigree/landscape/{id} |
| Ancestry | ancestry.com/account/signin | ancestry.com/family-tree/tree/{treeId}/family |
| 23AndMe | you.23andme.com/ | you.23andme.com/family/tree/ |
| WikiTree | wikitree.com/wiki/Special:Userlogin | wikitree.com/wiki/{WikiTreeId} |

### New Types (shared/src/index.ts)
- `BuiltInProvider` - 'familysearch' | 'ancestry' | '23andme' | 'wikitree'
- `ProviderSessionStatus` - Browser login status for a provider
- `ProviderTreeInfo` - Tree information from a provider
- `UserProviderConfig` - User configuration per provider (enable/disable, rate limits)
- `ProviderRegistry` - All provider configurations
- `ScrapedPersonData` - Standardized scraped data format
- `GedcomPerson`, `GedcomFamily`, `GedcomFile` - GEDCOM import/export types
- `ProviderComparison`, `SyncProgress` - Cross-provider sync types

### Scraper Architecture

**Base Interface:** `server/src/services/scrapers/base.scraper.ts`
```typescript
interface ProviderScraper {
  provider: BuiltInProvider;
  displayName: string;
  loginUrl: string;
  checkLoginStatus(page): Promise<boolean>;
  getLoggedInUser(page): Promise<{name?, userId?} | null>;
  listTrees(page): Promise<ProviderTreeInfo[]>;
  scrapePersonById(page, id): Promise<ScrapedPersonData>;
  scrapeAncestors(page, rootId, maxGen): AsyncGenerator<ScrapedPersonData>;
  getPersonUrl(id): string;
  getPersonEditUrl(id): string;
}
```

**Provider Scrapers:**
- `server/src/services/scrapers/familysearch.scraper.ts`
- `server/src/services/scrapers/ancestry.scraper.ts`
- `server/src/services/scrapers/23andme.scraper.ts`
- `server/src/services/scrapers/wikitree.scraper.ts`
- `server/src/services/scrapers/index.ts` - Registry and factory

### Provider Service
**File:** `server/src/services/provider.service.ts`
- `getAllConfigs()` - Get all provider configurations
- `getConfig(provider)` - Get single provider config
- `saveConfig(config)` - Save provider config
- `toggleProvider(provider, enabled)` - Enable/disable provider
- `checkSession(provider)` - Check browser login status
- `checkAllSessions()` - Check all enabled providers
- `discoverTrees(provider)` - List available trees
- `openLoginPage(provider)` - Open login page in browser

### GEDCOM Service
**File:** `server/src/services/gedcom.service.ts`
- `exportToGedcom(dbId)` - Export database to GEDCOM 5.5.1
- `parseGedcom(content)` - Parse GEDCOM file
- `validateGedcom(content)` - Validate GEDCOM file
- `importGedcom(content, dbName)` - Import GEDCOM to new database
- `personToGedcom()` / `gedcomToPerson()` - Conversion helpers

### Sync Service
**File:** `server/src/services/sync.service.ts`
- `compareAcrossProviders(dbId, personId)` - Compare person across all providers
- `scrapeFromProvider(provider, externalId)` - Scrape single person
- `findMatch(person, targetProvider)` - Find matching person
- `importPerson(provider, externalId, dbId)` - Import from provider
- `pushUpdate(dbId, personId, provider)` - Open edit page on provider
- `syncDatabase(dbId, provider, direction)` - Batch sync with progress

### API Routes

**Provider Routes:** `server/src/routes/provider.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/providers | List all configs + session status |
| GET | /api/providers/:provider | Get single provider config |
| PUT | /api/providers/:provider | Update config |
| POST | /api/providers/:provider/toggle | Enable/disable |
| POST | /api/providers/:provider/check-session | Check browser login |
| POST | /api/providers/:provider/login | Open login page |
| GET | /api/providers/:provider/trees | List available trees |
| POST | /api/providers/:provider/scrape/:personId | Scrape person |

**GEDCOM Routes:** `server/src/routes/gedcom.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/gedcom/export/:dbId | Download GEDCOM file |
| POST | /api/gedcom/import | Import GEDCOM |
| POST | /api/gedcom/validate | Validate GEDCOM |
| POST | /api/gedcom/preview | Preview GEDCOM contents |

**Sync Routes:** `server/src/routes/sync.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/sync/:dbId/:personId/compare | Compare across providers |
| POST | /api/sync/:dbId/:personId/import | Import from provider |
| POST | /api/sync/:dbId/:personId/push | Open edit page |
| POST | /api/sync/:dbId/:personId/find-match | Find matching person |
| GET | /api/sync/database/:dbId/events | SSE for batch sync |
| POST | /api/sync/database/:dbId | Start batch sync |

### Frontend Pages

**ProvidersPage:** `client/src/pages/ProvidersPage.tsx`
- 4 built-in provider cards (not dynamically added)
- Toggle switch for enable/disable
- Session status indicator (green/red)
- "Check Login" button
- "Open Login" button
- Rate limit sliders
- Route: `/providers/scraper`

**GedcomPage:** `client/src/pages/GedcomPage.tsx`
- File upload for import with validation
- Database selector for export
- Preview before import
- Route: `/tools/gedcom`

### Data Files
- Provider config: `data/provider-config.json`
- Scraped data: `data/scrape/{personId}.json`
- Downloaded photos: `data/photos/{personId}.{jpg|png}`

---

## Browser Scrape Options (Phase 10) ✅

### Overview
Added explicit browser scrape options to the genealogy provider system, allowing users to:
- Enable/disable browser-based scraping per provider
- Confirm when they've logged into the browser for a provider
- Track the last login confirmation timestamp

### Changes

**Shared Types:** `shared/src/index.ts`
```typescript
export interface UserProviderConfig {
  // ... existing fields
  browserScrapeEnabled: boolean;  // Whether browser scraping is enabled
  browserLoggedIn: boolean;       // User has confirmed browser login
  browserLastLogin?: string;      // Last confirmation timestamp
}
```

**Provider Service:** `server/src/services/provider.service.ts`
- `toggleBrowserScrape(provider, enabled)` - Enable/disable browser scraping
- `confirmBrowserLogin(provider, loggedIn)` - Confirm/clear browser login status
- Migration: Existing configs automatically get new fields

**API Routes:** `server/src/routes/provider.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/scrape-providers/:provider/toggle-browser-scrape | Toggle scrape on/off |
| POST | /api/scrape-providers/:provider/confirm-browser-login | Confirm login status |

**Note:** Routes moved from `/api/providers` to `/api/scrape-providers` to avoid conflict with AI toolkit's provider routes.

**Frontend:** `client/src/pages/ProvidersPage.tsx`
- Status badges show "Scrape On/Off" and "Logged In/Not Logged In"
- Expanded settings panel includes:
  - "Enable Browser Scraping" toggle button
  - "Confirm Login" button with last login timestamp
  - Help text explaining the feature

**Client API:** `client/src/services/api.ts`
- `toggleBrowserScrape(provider, enabled)`
- `confirmBrowserLogin(provider, loggedIn)`

---

## Browser Settings Page (Phase 11) ✅

### Overview
Added a dedicated Browser Settings page for managing the CDP (Chrome DevTools Protocol) browser instance used for genealogy provider scraping. Provides centralized control over browser connection, configuration, and provider login status.

### Features
- **CDP Configuration:** Configure CDP port (default 9920), view CDP URL
- **Browser Process Status:** See if browser process is running
- **Playwright Connection:** Connect/disconnect Playwright from CDP
- **Launch Browser:** Start browser process from the UI (runs `.browser/start.sh`)
- **Auto-connect:** Option to auto-connect when server starts
- **Provider Login Status:** Check login status for all genealogy providers
- **Open Pages:** View list of open browser pages

### Backend Changes

**Browser Service:** `server/src/services/browser.service.ts`
- `getConfig()` - Get browser configuration
- `updateConfig(updates)` - Update CDP port, auto-connect settings
- `launchBrowser()` - Launch browser process via start script
- `checkBrowserRunning()` - Check if CDP endpoint is responding
- `BrowserStatus` extended with `cdpPort`, `browserProcessRunning`, `autoConnect`
- Configuration persisted in `data/browser-config.json`

**Browser Routes:** `server/src/routes/browser.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/browser/config | Get browser configuration |
| PUT | /api/browser/config | Update browser configuration |
| POST | /api/browser/launch | Launch browser process |
| GET | /api/browser/running | Check if browser is running |

### Frontend

**BrowserSettingsPage:** `client/src/pages/BrowserSettingsPage.tsx`
- CDP connection status card with connect/disconnect/launch buttons
- CDP configuration card with port editing and auto-connect toggle
- Provider login status card with check/login buttons per provider
- Open browser pages list

**Route:** `/settings/browser`

**Navigation:** Added "Browser Settings" link with Monitor icon to sidebar

### Data Files
- Browser config: `data/browser-config.json`

---

## DRY Theme System (Phase 12) ✅

### Overview
Comprehensive update to the light/dark theme system to provide a DRY (Don't Repeat Yourself) implementation that allows easily toggling between light and dark modes with consistent styling across all components.

### Theme Architecture

**CSS Variables:** `client/src/index.css`

Core variable categories:
- **Core colors:** `--color-app-bg`, `--color-app-bg-secondary`, `--color-app-card`, `--color-app-border`, `--color-app-hover`
- **Text colors:** `--color-app-text`, `--color-app-text-secondary`, `--color-app-text-muted`, `--color-app-text-subtle`
- **Input colors:** `--color-app-input-bg`, `--color-app-input-border`, `--color-app-placeholder`
- **Accent colors:** `--color-app-accent`, `--color-app-accent-hover`, `--color-app-accent-subtle`
- **Status colors:** `--color-app-success`, `--color-app-warning`, `--color-app-error` (with `-subtle` variants)
- **Gender colors:** `--color-male`, `--color-female` (with `-subtle` variants)
- **Overlay:** `--color-app-overlay`

**Tailwind Config:** `client/tailwind.config.js`

All CSS variables exposed as Tailwind utilities:
- `text-app-text`, `text-app-text-secondary`, `text-app-text-muted`, `text-app-text-subtle`
- `bg-app-bg`, `bg-app-bg-secondary`, `bg-app-card`, `bg-app-hover`
- `border-app-border`, `border-app-input-border`
- `text-app-accent`, `bg-app-accent`, `hover:bg-app-accent-hover`
- `text-app-male`, `text-app-female`, `bg-app-male-subtle`, `bg-app-female-subtle`
- And more...

### Theme Toggle

**ThemeContext:** `client/src/context/ThemeContext.tsx`
- Manages `theme` state ('light' | 'dark')
- Toggles `.dark` class on `document.documentElement`
- Persists preference to localStorage
- Detects system preference on initial load

**Sidebar Integration:** Theme toggle button in sidebar footer with Sun/Moon icons

### Migration Summary

All components updated to use semantic color variables instead of hardcoded colors:
- `text-white` → `text-app-text`
- `text-neutral-300` → `text-app-text-secondary`
- `text-neutral-400` → `text-app-text-muted`
- `text-neutral-500` → `text-app-text-subtle`
- `bg-neutral-700` → `bg-app-bg-secondary`
- `hover:bg-neutral-700` → `hover:bg-app-hover`
- `bg-blue-500/20 text-blue-400` → `bg-app-male-subtle text-app-male`
- `bg-pink-500/20 text-pink-400` → `bg-app-female-subtle text-app-female`
- `placeholder-neutral-500` → `placeholder-app-placeholder`
- `bg-black/50` → `bg-app-overlay`

### Files Updated
- All components in `client/src/components/`
- All pages in `client/src/pages/`
- `client/src/index.css`
- `client/tailwind.config.js`

### Benefits
1. **DRY:** Color values defined in one place (CSS variables)
2. **Easy theme switching:** Toggle `.dark` class to switch themes
3. **Consistent:** All components use the same color palette
4. **Customizable:** Easy to adjust colors by changing variables
5. **Light mode friendly:** Proper contrast and colors for both themes

---

## Theme Color Consistency Fix (Phase 12.1) ✅

### Overview
Fixed light mode visibility issues by replacing all hardcoded Tailwind color classes (e.g., `text-green-400`, `text-amber-400`, `text-red-400`, `text-blue-400`) with theme-aware CSS variable-based colors that provide proper contrast in both light and dark modes.

### Problem
Many components used Tailwind's 400-shade colors (e.g., `text-green-400`) which are designed for dark backgrounds. In light mode, these colors have poor contrast against white/light backgrounds, making text nearly invisible.

### Solution
Replaced all hardcoded status colors with theme-aware equivalents:
- `text-green-400` → `text-app-success`
- `text-amber-400` → `text-app-warning`
- `text-red-400` → `text-app-error`
- `text-blue-400` → `text-app-accent`
- `bg-green-600/20` → `bg-app-success-subtle`
- `bg-amber-600/20` → `bg-app-warning-subtle`
- `bg-red-600/20` → `bg-app-error-subtle`

For non-semantic colors (provider brands like purple, cyan, orange, emerald), used explicit `dark:` variants:
- `text-purple-600 dark:text-purple-400`
- `bg-purple-600/10 dark:bg-purple-600/20`

### Files Updated
- `client/src/pages/BrowserSettingsPage.tsx` - CDP status, provider login badges
- `client/src/pages/ProvidersPage.tsx` - Provider cards, status badges, toggle buttons
- `client/src/pages/GenealogyProviders.tsx` - Platform colors, status icons
- `client/src/pages/GedcomPage.tsx` - Validation status display
- `client/src/components/Dashboard.tsx` - Platform badge colors, delete button
- `client/src/components/person/PersonDetail.tsx` - Platform config, birth/death icons, confidence badges
- `client/src/components/favorites/FavoriteButton.tsx` - Remove button

### Theme Variable Reference
CSS variables defined in `index.css` that adapt to light/dark mode:
| Light Mode | Dark Mode | Usage |
|------------|-----------|-------|
| `#22c55e` | `#22c55e` | Success (green) |
| `#f59e0b` | `#f59e0b` | Warning (amber) |
| `#ef4444` | `#ef4444` | Error (red) |
| `rgba(X, 0.1)` | `rgba(X, 0.2)` | Subtle backgrounds |

---

## Provider Login Credentials and Auto-Authentication (Phase 13) ✅

### Overview
Added the ability to save login credentials for genealogy providers (FamilySearch, Ancestry, WikiTree, 23andMe) so Playwright can automatically re-authenticate when sessions expire. Credentials are stored encrypted locally and never exposed via API.

### Bug Fix
Fixed the "Check Session" button navigating to a 404 page. The `getLoggedInUser()` method in `familysearch.scraper.ts` was navigating to `/settings/account` which no longer exists. Changed to extract user name from the user menu on the current page instead.

### New Types (shared/src/index.ts)
```typescript
// Added to UserProviderConfig
hasCredentials?: boolean;       // Whether credentials are stored
autoLoginEnabled?: boolean;     // Whether to auto-login when session expires

// New interfaces
interface ProviderCredentials {
  email?: string;
  username?: string;
  password?: string;
  lastUpdated?: string;
}

interface CredentialsStatus {
  hasCredentials: boolean;
  email?: string;
  username?: string;
  autoLoginEnabled: boolean;
  lastUpdated?: string;
}
```

### Credentials Service
**File:** `server/src/services/credentials.service.ts`

- Stores credentials in `data/credentials.json` (git-ignored)
- Uses AES-256-GCM encryption with a local key stored in `data/.credentials-key`
- Methods:
  - `saveCredentials(provider, credentials)` - Store encrypted credentials
  - `getCredentials(provider)` - Get decrypted credentials (internal use only)
  - `getCredentialsStatus(provider)` - Get status without password (safe for API)
  - `hasCredentials(provider)` - Check if credentials exist
  - `deleteCredentials(provider)` - Remove credentials

### Scraper Login Interface
**File:** `server/src/services/scrapers/base.scraper.ts`

Extended `ProviderScraper` interface with:
```typescript
interface LoginSelectors {
  usernameInput: string;
  passwordInput: string;
  submitButton: string;
  successIndicator: string;
  errorIndicator?: string;
}

interface ProviderScraper {
  // ... existing methods
  loginSelectors: LoginSelectors;
  performLogin(page, username, password): Promise<boolean>;
}
```

### Provider Login Selectors

| Provider | Email/Username | Password | Submit | Success |
|----------|---------------|----------|--------|---------|
| FamilySearch | `#userName` | `#password` | `button[type="submit"]` | `[data-testid="user-menu"]` |
| Ancestry | `#username` | `#password` | `#signInBtn` | `#navAccount` |
| WikiTree | `#wpName1` | `#wpPassword1` | `#wpLoginAttempt` | `#my-wikitree` |
| 23andMe | `input[name="email"]` | `input[name="password"]` | `button[type="submit"]` | `[data-test="user-menu"]` |

### API Endpoints
**File:** `server/src/routes/provider.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/scrape-providers/:provider/credentials | Save credentials |
| GET | /api/scrape-providers/:provider/credentials | Get status (no password) |
| DELETE | /api/scrape-providers/:provider/credentials | Delete credentials |
| POST | /api/scrape-providers/:provider/toggle-auto-login | Enable/disable auto-login |
| POST | /api/scrape-providers/:provider/auto-login | Trigger manual login attempt |

### Client API
**File:** `client/src/services/api.ts`

- `saveProviderCredentials(provider, { email?, username?, password })`
- `getProviderCredentialsStatus(provider)`
- `deleteProviderCredentials(provider)`
- `toggleAutoLogin(provider, enabled)`
- `triggerAutoLogin(provider)`

### Frontend UI
**File:** `client/src/components/providers/CredentialsModal.tsx`

Modal for entering credentials with:
- Email/username input (varies by provider)
- Password input with show/hide toggle
- Security warning about local storage
- Save/Cancel buttons

**File:** `client/src/pages/BrowserSettingsPage.tsx`

Each provider card now includes:
- "Creds" badge if credentials are stored
- "Add"/"Update" credentials button
- "Delete" credentials button (trash icon)
- "Auto" toggle (enable/disable auto-login)
- "Login Now" button to manually trigger login

### Data Files (git-ignored)
- `data/credentials.json` - Encrypted credentials storage
- `data/.credentials-key` - AES-256 encryption key

### Security Notes
- Credentials are encrypted using AES-256-GCM
- Encryption key is generated on first use and stored locally
- Password is never returned via API endpoints
- Files are git-ignored to prevent accidental commits
- Security warning shown to users in the modal

---

## SQLite Storage Layer & Migration Framework (Phase 14) ✅

### Overview
Major architectural upgrade introducing SQLite as a high-performance index layer while maintaining JSON files as the source of truth. This adds canonical ULID-based identities, full-text search via FTS5, recursive CTEs for path finding, and a comprehensive data migration framework.

### Identity Model
- **Canonical IDs**: ULIDs (26 chars, sortable, collision-resistant)
- **External IDs**: Provider-specific (FamilySearch, Ancestry, WikiTree, etc.)
- **Bidirectional lookup**: `idMappingService` with in-memory LRU cache

### Storage Architecture

**Hybrid Model:**
- `data/` - JSON files remain source of truth
- `data/sparsetree.db` - SQLite index for fast queries
- `data/blobs/` - Content-addressed media storage

**SQLite Tables:** (`server/src/db/schema.sql`)
- `person` - Canonical records with ULID primary keys
- `external_identity` - Maps provider IDs to canonical IDs
- `parent_edge` / `spouse_edge` - Relationship graphs with provenance
- `vital_event` - Birth, death, burial with dates/places
- `claim` - Extensible facts (occupation, religion, bio)
- `database_membership` - Multi-tree support
- `favorite` - Database-scoped favorites
- `blob` / `media` - Content-addressed storage
- `person_fts` - FTS5 virtual table for full-text search

### New Services

**`server/src/db/sqlite.service.ts`**
- Connection management with WAL mode
- Performance pragmas (cache_size, temp_store)
- Transaction support, batch inserts
- FTS5 search helpers

**`server/src/services/id-mapping.service.ts`**
- `getCanonicalId(externalId, source)` - Resolve external to canonical
- `getExternalIds(canonicalId)` - Get all external IDs for a person
- `createPerson()` - Generate new ULID and create record
- `registerExternalId()` - Link external ID to canonical
- `batchGetCanonicalIds()` - Bulk resolution

**`server/src/services/blob.service.ts`**
- `storeBlob(buffer)` - Store with SHA-256 deduplication
- `getBlob(hash)` - Retrieve by hash
- `createMedia()` - Link blob to person
- `getPrimaryPhoto()` - Get primary photo for person

### Service Updates

**`database.service.ts`**
- `isSqliteEnabled()` - Auto-detects SQLite availability
- Queries from SQLite with JSON fallback
- Builds Person objects from normalized tables

**`search.service.ts`**
- FTS5 MATCH queries for text search
- `quickSearch()` for autocomplete
- `searchGlobal()` for cross-database search

**`path.service.ts`**
- Recursive CTEs for shortest/longest/random paths
- `findAncestors()` / `findDescendants()` with depth limits

**`favorites.service.ts`**
- SQLite storage with JSON backup
- Database-scoped favorites

### Data Migration Framework

**`scripts/migrate.ts`**
- Runs both schema and data migrations
- Tracks applied migrations in `data/.data-version`
- Supports dry-run, status check, rollback
- Commands: `npm run migrate`, `npm run migrate:status`

**`server/src/db/migrations/`**
- Schema migrations with up/down functions
- Auto-applies pending migrations on init

### Update Script

**`./update.sh`**
- One-command updates from main branch
- Installs deps, builds, migrates, restarts PM2
- Options: `--dry-run`, `--no-restart`, `--branch=NAME`

### Files Added
- `server/src/db/schema.sql`
- `server/src/db/sqlite.service.ts`
- `server/src/db/migrations/index.ts`
- `server/src/db/migrations/001_initial.ts`
- `server/src/services/id-mapping.service.ts`
- `server/src/services/blob.service.ts`
- `scripts/migrate.ts`
- `update.sh`

### Files Modified
- `shared/src/index.ts` - Added `canonicalId`, `ExternalIdentity`, `Claim` types
- `server/src/services/database.service.ts` - SQLite with JSON fallback
- `server/src/services/search.service.ts` - FTS5 queries
- `server/src/services/path.service.ts` - Recursive CTEs
- `server/src/services/favorites.service.ts` - SQLite storage
- `server/src/services/augmentation.service.ts` - External identity registration
- `CLAUDE.md` - Migration documentation
- `package.json` - Migration npm scripts

---

## Canonical ID Migration Roadmap (Phase 15) 🔄

### Overview
Complete migration from FamilySearch IDs as primary keys to a canonical ULID-based system where SparseTree owns the identity layer. External provider IDs (FamilySearch, Ancestry, WikiTree, etc.) become references mapped to our canonical IDs.

### Current State ✅
- SQLite infrastructure ready (schema, services, migrations)
- ID mapping service with bidirectional lookup
- Services updated to query SQLite with JSON fallback
- Migration script ready (`scripts/migrate-to-sqlite.ts`)

### Phase 15.1: One-Time Data Migration 📋

**Goal:** Populate SQLite from existing JSON data.

**Steps:**
1. Run migration in dry-run mode to preview:
   ```bash
   npx tsx scripts/migrate-to-sqlite.ts --dry-run --verbose
   ```
2. Run actual migration:
   ```bash
   npx tsx scripts/migrate-to-sqlite.ts
   ```
3. Verify data integrity:
   - Compare person counts
   - Spot-check random records
   - Verify relationships

**What gets migrated:**
- All persons from `data/db-*.json` files
- Parent/spouse relationships
- Vital events (birth, death, burial)
- Occupations, aliases, religion as claims
- Favorites from `data/favorites/`
- Platform links from `data/augment/`

---

### Phase 15.2: Dual-Write Indexer 📋

**Goal:** Update `index.js` to write to both JSON (for raw cache) and SQLite (for serving).

**File:** `index.js`

**Changes needed:**
1. Import SQLite services
2. On each person fetch:
   - Continue writing raw API response to `data/person/{fsId}.json`
   - Create/update canonical person in SQLite
   - Register FamilySearch ID as external identity
   - Insert vital events, claims, relationships
3. On `saveDB()`:
   - Continue writing `db-{id}.json` for backwards compatibility
   - Update database_info and database_membership in SQLite

**Key considerations:**
- Generate ULID for new persons not in SQLite
- Reuse existing ULID if person already exists (lookup by FS ID)
- Handle relationship updates (person might gain new parents)

---

### Phase 15.3: API Route Evolution 📋

**Goal:** Routes accept both canonical ULIDs and FamilySearch IDs.

**Files to update:**
- `server/src/routes/persons.routes.ts`
- `server/src/routes/tree.routes.ts`
- `server/src/routes/path.routes.ts`

**Pattern:**
```typescript
// ID resolution at route level
const canonicalId = idMappingService.resolveId(params.personId, 'familysearch');
if (!canonicalId) {
  // Treat as canonical ID directly
  canonicalId = params.personId;
}
```

**New endpoints:**
- `GET /api/person/:id/identities` - All external IDs for a person
- `GET /api/person/:id/claims` - Claims with source provenance
- `POST /api/person/:id/link` - Link external ID to person
- `POST /api/persons/merge` - Merge two persons (admin)

---

### Phase 15.4: Photo Migration to Blobs 📋

**Goal:** Move photos to content-addressed storage.

**Current:** `data/photos/{fsId}.{ext}`
**Target:** `data/blobs/{hash[:2]}/{hash}.{ext}`

**Script:** `scripts/migrate-photos-to-blobs.ts`
1. For each photo in `data/photos/`:
   - Hash file with SHA-256
   - Move to blob storage
   - Create blob record in SQLite
   - Create media record linking to person
   - Create symlink from old path for backwards compatibility

---

### Phase 15.5: Client Updates 📋

**Goal:** UI displays canonical IDs and external ID mappings.

**Changes:**
- Show canonical ID in PersonDetail (collapsible)
- Show linked platforms with their IDs
- Update URL patterns (consider `/p/{ulid}` for clean URLs)
- Add "Link External ID" button for manual matching

---

### Phase 15.6: Deprecate JSON Graph Files (Future) 📋

**Goal:** SQLite becomes the only serving layer.

**When ready:**
1. Remove JSON fallback from services
2. Generate `db-{id}.json` on-demand for export only
3. Keep `data/person/*.json` as raw API cache (source of truth)
4. Update CLI tools to use SQLite directly

---

## Storage Architecture (Target State)

```
data/
├── person/              # Raw API cache (source of truth for provider data)
│   └── {fsId}.json
├── sparsetree.db        # SQLite index (serving layer)
├── blobs/               # Content-addressed media
│   └── {hash[:2]}/
│       └── {hash}.{ext}
├── augment/             # Rich augmentation data (keep for complex fields)
│   └── {fsId}.json
└── .data-version        # Migration state
```

**Identity flow:**
```
FamilySearch ID ──┐
Ancestry ID ──────┼──> external_identity table ──> canonical ULID ──> person table
WikiTree ID ──────┘
```

---

## Multi-Platform Sync Architecture (Phase 16) 📋

### Overview
Comprehensive architecture for syncing genealogy data across multiple providers (FamilySearch, Ancestry, WikiTree, etc.) with SparseTree's SQLite database as the canonical synthesized view. Each provider maintains its own cached view of records, while SQLite stores the merged, authoritative data.

### Provider Cache Structure

**Directory Layout:**
```
data/
├── cache/
│   ├── familysearch/
│   │   └── {fsPersonId}.json     # Raw FamilySearch API response
│   ├── ancestry/
│   │   └── {ancestryPersonId}.json
│   ├── wikitree/
│   │   └── {wikitreeId}.json
│   └── 23andme/
│       └── {23andmeId}.json
├── sparsetree.db                  # Canonical synthesized data
└── blobs/                         # Content-addressed media
```

**Why Provider IDs for Cache Files:**
- Each JSON file represents *that provider's view* of the person
- Provider IDs are stable identifiers within their system
- Allows quick lookup: "What does FamilySearch say about FS-ID-123?"
- Supports diffing: compare provider caches to detect changes
- Enables selective re-fetch without full sync
- Cache files are raw API responses, not processed data
- SQLite synthesizes these views into canonical records

**Cache File Content:**
```json
{
  "providerId": "KWZJ-VKB",
  "provider": "familysearch",
  "fetchedAt": "2024-01-15T10:30:00.000Z",
  "apiVersion": "1.0",
  "rawResponse": { /* Full API response */ },
  "etag": "abc123"  // For conditional fetches
}
```

---

### Download/Sync UI (Future)

**Goal:** Replace CLI indexer (`node index PERSON_ID`) with a web-based "Download" page for easier data acquisition.

**Route:** `/download` or `/sync`

**Features:**

1. **Provider Connection Panel**
   - Shows all configured providers
   - Connection status (logged in, session expired, not configured)
   - Quick link to login page
   - Rate limit status per provider

2. **Download Configuration**
   - Select root person (search/autocomplete from existing data or enter ID)
   - Choose depth (generations to fetch)
   - Select direction: ancestors only, descendants only, or both
   - Provider selection (which providers to pull from)
   - Options:
     - Skip already-cached persons
     - Force refresh (re-fetch even if cached)
     - Include spouse lines
     - Birth year cutoff

3. **Progress Tracking**
   - SSE-powered real-time progress
   - Total persons to fetch
   - Currently fetching (with name)
   - Success/error counts
   - Rate limit warnings
   - Estimated time remaining
   - Pause/resume capability
   - Cancel button

4. **Results Summary**
   - New persons added
   - Existing persons updated
   - Conflicts detected (link to conflict resolution)
   - Errors encountered with retry option

**API Endpoints:**
```
POST /api/download/start
  body: { rootId, depth, direction, providers[], options }
  returns: { jobId }

GET /api/download/:jobId/events
  SSE stream with progress updates

POST /api/download/:jobId/pause
POST /api/download/:jobId/resume
POST /api/download/:jobId/cancel

GET /api/download/:jobId/status
  returns: { state, progress, errors }
```

---

### Bidirectional Sync

**Pull: Provider → SQLite**
1. Fetch person data from provider (via API or scraping)
2. Store raw response in `data/cache/{provider}/{id}.json`
3. Parse provider-specific format to normalized Person
4. Match to existing canonical record via `external_identity` table
5. Create new canonical person if no match (generate ULID)
6. Update claims, vital events, relationships in SQLite
7. Flag conflicts for manual review

**Push: SQLite → Provider (via Playwright)**
1. User selects person to push
2. Look up external identity for target provider
3. Open provider's edit page in browser (Playwright)
4. Pre-fill form fields with canonical data
5. Highlight differences from current provider data
6. User reviews and manually submits (or auto-submit if confident)
7. Update provider cache after successful push

**Conflict Resolution Strategy:**
1. **Detection:** Compare field values across providers and canonical
2. **Display:** Show side-by-side comparison (FamilySearch | Ancestry | Canonical)
3. **Resolution options:**
   - Accept provider A's value
   - Accept provider B's value
   - Keep canonical (no change)
   - Manual edit (enter custom value)
   - Mark as uncertain (flag for later)
4. **Provenance:** Store which source provided accepted value
5. **Confidence scoring:** Track agreement across providers

**Conflict UI Route:** `/conflicts` or `/sync/conflicts`

---

### Cross-Platform ID Linking

**Problem:** User has trees on multiple platforms but no automatic linking between them.

**Solution:** Scripts to trace ancestry on other platforms given a connection point.

**Workflow:**
1. User identifies one person who exists on both platforms (e.g., FamilySearch KWZJ-VKB = Ancestry person/123456)
2. System registers this mapping in `external_identity` table
3. Script follows parent links on the new platform
4. For each ancestor:
   - Check if already linked (by name/date matching)
   - If confident match, auto-register mapping
   - If uncertain, queue for manual review
   - Cache provider data regardless

**Script:** `scripts/link-platform.ts`
```bash
# Start from a known connection point
npx tsx scripts/link-platform.ts \
  --canonical=01HRZ7E8XYZ... \
  --provider=ancestry \
  --external-id=123456 \
  --depth=10 \
  --match-threshold=0.8
```

**Matching Heuristics:**
- Name similarity (Levenshtein distance, nickname handling)
- Birth year within range (±5 years for estimates)
- Birth/death place similarity
- Parent name matching
- Spouse name matching
- Confidence score combining all factors

**Output:**
- Auto-linked: high confidence matches (>0.9)
- Review queue: medium confidence (0.7-0.9)
- No match: low confidence or new person

---

### Sample Data

**Goal:** Ship SparseTree with sample data for demos, testing, and onboarding.

**Root Person:** John le Strange (FamilySearch ID: `9CNK-KN3`)
- Well-documented historical figure
- Rich ancestry with ~5 generations of traceable ancestors
- Multiple notable figures in lineage
- Good test case for sparse tree visualization

**Directory:** `samples/`
```
samples/
├── README.md                      # Sample data documentation
├── john-le-strange/
│   ├── cache/
│   │   └── familysearch/
│   │       ├── 9CNK-KN3.json      # John le Strange
│   │       ├── {parent1}.json
│   │       └── ...
│   ├── sparsetree-sample.db       # Pre-built SQLite database
│   ├── augment/                   # Sample augmentations
│   │   └── 9CNK-KN3.json
│   └── favorites/                 # Sample favorites
│       └── default.json
└── import-sample.sh               # Script to import sample data
```

**Sample Database Contents:**
- ~50-100 persons (5 generations of John le Strange)
- Canonical ULIDs pre-assigned
- FamilySearch IDs registered in `external_identity`
- Sample favorites with tags (royalty, notable)
- Sample augmentations (Wikipedia links, bios)
- Sample sparse tree configuration

**Import Script:** `samples/import-sample.sh`
```bash
#!/bin/bash
# Import sample data for first-time users
cp -r samples/john-le-strange/cache/* data/cache/
cp samples/john-le-strange/sparsetree-sample.db data/sparsetree.db
cp -r samples/john-le-strange/augment/* data/augment/
cp -r samples/john-le-strange/favorites/* data/favorites/
echo "Sample data imported! Start exploring at /databases"
```

**Ready for Multi-Platform Mapping:**
- Sample external IDs for other platforms can be added later
- Users can practice linking to their Ancestry/WikiTree accounts
- Demonstrates the full workflow without requiring API access

---

## Future Work

- Add more provider scrapers (FindAGrave, Heritage, Geni)
- Improve 23AndMe scraper (currently limited due to canvas-based UI)
- Add batch photo download functionality
- Implement provider-specific search APIs where available
- Offline mode with SQLite sync
- **Phase 16 items:**
  - Implement Download/Sync UI (see Phase 16)
  - Build conflict resolution interface (see Phase 16)
  - Create cross-platform linking scripts (see Phase 16)
  - Package sample data for distribution (see Phase 16)
  - Person merge workflow (detect duplicates, merge records)
