# Development Roadmap

This document tracks all implemented and planned development phases.

## Status Legend

- ✅ Completed
- 🔄 In Progress
- 📋 Planned

---

## Phase 1: Shared Type Definitions ✅

**File:** `shared/src/index.ts`

Added types for:
- `VitalEvent` - Birth/death/burial with date, dateFormal, place, placeId
- `Person` - Enhanced with gender, living, birth/death/burial objects, occupations[], spouses[], alternateNames[], lastModified
- `PlatformReference` - Cross-platform linking (familysearch, wikipedia, findagrave, etc.)
- `PersonPhoto` - Photo with url, source, localPath, isPrimary
- `PersonDescription` - Description with text, source, language
- `PersonAugmentation` - Multi-platform augmentation record

---

## Phase 2: Enhanced Person Extraction ✅

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

Maintains backwards compatibility with computed fields: `lifespan`, `location`, `occupation`

---

## Phase 3: Database Rebuild Script ✅

**File:** `rebuild.js`

```bash
node rebuild DB_ID           # Rebuild specific database
node rebuild --all           # Rebuild all databases
```

---

## Phase 4: Augmentation Migration ✅

**File:** `server/src/services/augmentation.service.ts`

- Multi-platform support with `platforms[]` array
- Photos array with url, source, localPath, isPrimary
- Descriptions array with text, source, language
- Automatic migration of legacy Wikipedia-only augmentations
- Helper methods: `addPlatform()`, `addPhoto()`, `addDescription()`, `getPrimaryPhoto()`, etc.

---

## Phase 5: UI Updates ✅

- Gender badge (male/female)
- Alternate names list
- Separate Birth/Death/Burial cards
- All occupations as badges
- Spouses section with links
- Platform badges showing linked sources

---

## Phase 6: Multi-Provider Genealogy System ✅

Supported providers: FamilySearch, MyHeritage, Geni, WikiTree, FindMyPast, Ancestry, Find A Grave

**Routes:** `/providers/genealogy`, `/providers/genealogy/new`, `/providers/genealogy/:id/edit`

**Storage:** `data/genealogy-providers.json`

---

## Phase 7: Favorites & Sparse Family Tree ✅

- Mark people as favorites with notes
- Tag system (royalty, immigrant, revolutionary, founder, notable, etc.)
- Sparse tree visualization showing only favorites
- Generation skip labels on edges

**Routes:** `/favorites`, `/favorites/sparse-tree/:dbId`

---

## Phase 8: FamilySearch-Style Ancestry Tree ✅

- Paired father/mother cards with gender-colored borders
- Circular photos with fallback placeholders
- Click-to-expand lazy loading
- Horizontal layout with D3.js zoom/pan

**Routes:** `/tree/:dbId`, `/tree/:dbId/:personId`

---

## Phase 9: Browser-Based Provider System ✅

Replaced API-based system with browser scraping automation:

| Provider | Login URL |
|----------|-----------|
| FamilySearch | familysearch.org/auth/familysearch/login |
| Ancestry | ancestry.com/account/signin |
| 23AndMe | you.23andme.com/ |
| WikiTree | wikitree.com/wiki/Special:Userlogin |

**Scraper interface:** `server/src/services/scrapers/base.scraper.ts`

---

## Phase 10: Browser Scrape Options ✅

- Toggle browser scraping per provider
- Confirm browser login status
- Track login confirmation timestamps

---

## Phase 11: Browser Settings Page ✅

- CDP configuration (port, auto-connect)
- Browser process status
- Playwright connection management
- Launch browser from UI

**Route:** `/settings/browser`

---

## Phase 12: DRY Theme System ✅

- CSS variables for all colors
- Tailwind utilities (`text-app-*`, `bg-app-*`, etc.)
- Light/dark mode toggle
- Theme persistence in localStorage

---

## Phase 13: Provider Login Credentials ✅

- Encrypted credential storage (AES-256-GCM)
- Auto-login on session expiration
- Per-provider login selectors

**Storage:** `data/credentials.json`, `data/.credentials-key`

---

## Phase 14: SQLite Storage Layer ✅

Major upgrade introducing SQLite as serving layer:

- Canonical ULID-based identities
- FTS5 full-text search
- Recursive CTEs for path finding
- Data migration framework
- Content-addressed blob storage

See [Architecture](./architecture.md) for details.

---

## Phase 15: Canonical ID Migration ✅

- 138,853 persons migrated with canonical ULIDs
- Dual-write indexer (JSON + SQLite)
- API routes accept both ULIDs and FamilySearch IDs
- Photos migrated to blob storage
- UI displays canonical IDs

### Sub-phases:
- 15.1: One-time data migration ✅
- 15.2: Dual-write indexer ✅
- 15.3: API route evolution ✅
- 15.4: Photo migration to blobs ✅
- 15.5: Client updates ✅
- 15.6: Expanded SQLite schema ✅

---

## Phase 16: Multi-Platform Sync 📋

### Provider Cache Structure

```
data/
├── cache/
│   ├── familysearch/
│   │   └── {fsPersonId}.json
│   ├── ancestry/
│   │   └── {ancestryPersonId}.json
│   └── wikitree/
│       └── {wikitreeId}.json
└── sparsetree.db
```

### Planned Features

1. **Download/Sync UI** (`/download` or `/sync`)
   - Provider connection panel
   - Download configuration (depth, direction, providers)
   - Real-time progress tracking via SSE
   - Pause/resume/cancel

2. **Bidirectional Sync**
   - Pull: Provider → SQLite
   - Push: SQLite → Provider (via Playwright)
   - Conflict resolution UI

3. **Cross-Platform ID Linking**
   - Script to trace ancestry on other platforms
   - Matching heuristics (name, dates, places)
   - Confidence scoring

4. **Sample Data**
   - Ship with John le Strange (9CNK-KN3) sample
   - Pre-built SQLite database
   - Import script for onboarding

---

## Phase 17: Real-Time Event System 📋

Replace SSE endpoints with Socket.IO for proper bidirectional communication.

### Goals

- Centralized event hub for all async operations
- Bidirectional communication (e.g., cancel operations)
- Reconnection handling
- Event namespacing by feature

### Implementation Plan

1. **Server Setup**
   ```bash
   npm install socket.io -w server
   ```

   ```typescript
   // server/src/socket.ts
   import { Server } from 'socket.io';

   export const io = new Server(server, {
     cors: { origin: ['http://localhost:6373'] }
   });

   io.on('connection', (socket) => {
     // Join rooms by feature
     socket.on('subscribe:database', (dbId) => {
       socket.join(`db:${dbId}`);
     });
   });
   ```

2. **Client Setup**
   ```bash
   npm install socket.io-client -w client
   ```

   ```typescript
   // client/src/services/socket.ts
   import { io } from 'socket.io-client';

   export const socket = io('http://localhost:6374');
   ```

3. **Event Categories**
   - `database:refresh:progress` - Refresh progress
   - `database:refresh:complete` - Refresh done
   - `indexer:progress` - Indexing progress
   - `sync:progress` - Sync progress
   - `browser:status` - Browser connection changes
   - `provider:session` - Login status changes

4. **Migration Path**
   - Keep SSE endpoints for backwards compatibility
   - Add Socket.IO alongside
   - Migrate client code gradually
   - Remove SSE endpoints in future version

### Benefits

- Cancel long-running operations
- Multi-tab coordination
- Server-initiated updates
- Reduced HTTP overhead

---

## Future Work

- Add more provider scrapers (FindAGrave, Heritage, Geni)
- Improve 23AndMe scraper (canvas-based UI)
- Batch photo download
- Provider-specific search APIs
- Offline mode with sync
- GEDCOM-X format support
- Person merge workflow
