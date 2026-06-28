# Done Log

Completed items archived from PLAN.md. For per-version release notes see `.changelog/`. For full phase histories see [docs/roadmap.md](./docs/roadmap.md).

## 2026-06-27

- **Search ordering regression fixed + search-service N+1 cleanup (PLAN "Next Up" #4)** — `getPersonsBatch` now re-indexes its results into the caller's requested order. SQLite's `WHERE person_id IN (...)` returns rows in table (rowid) order, so the live search path (`searchWithSqlite` → `getPersonsBatch`) was silently dropping its `ORDER BY display_name`, leaving the default search view unordered. Also removed the two dead, never-called N+1 service methods (`searchService.quickSearch`, `searchService.searchGlobal`) and the now-unused `idMappingService` import. New unit tests in `tests/unit/services/databaseBatch.spec.ts` guard the ordering and missing-id behavior. Deferred `externalId` parity for batch results to PLAN (no current consumer needs it).

## 2026-05-01

- **File size guard** — `scripts/check-file-sizes.ts` + `npm run check:file-sizes` wired into CI's build job. Tracks the nine god-files called out in PLAN.md and fails when any exceeds its budget. Prevents the regression we measured in the Phase 15.14 follow-up. Lock-in mechanism: when a file is split, lower its limit in `FILE_LIMITS`. Includes unit tests in `tests/unit/scripts/checkFileSizes.spec.ts`.

## 2026-04-28

- **Phase 18 foundation (AI Tree Auditor)** — `audit_run` / `audit_issue` / `audit_change` schema (migration 007), BFS walker with cursor serialization (pause/resume/cancel), SSE progress endpoint. Structural checks live: `impossible_date`, `parent_age_conflict`, `placeholder_name`, `missing_gender`, `orphaned_edge`, `unlinked_provider` (chain-aware), `date_mismatch`. Auto-run migrations on server startup.
- **Phase 18 issue resolution engine** — accept / reject / undo with `audit_change` log; bulk operations via REST API.
- **Phase 18 Audit Dashboard UI** — full audit page with issue list/filters, tree view with severity overlays, per-person `PersonAuditIssues` panel, audited/unaudited overlay, hint severity tier (gray + HelpCircle).
- **Phase 19.4 (initial pass)** — Place normalization (USA vs United States, UK vs Great Britain, US state abbreviations) before flagging differences. New `server/src/utils/normalizePlace.ts` + tests.

## 2026-04-25

- Dashboard On This Day — allow navigating ancestor anniversaries to any date.
- Mobile — prevent card overflow and enforce 40px touch targets.

## 2026-04-09

- Dashboard On This Day section showing ancestor birth/death/marriage anniversaries.
- **Phase 15.14 (partial)** — Route-level code splitting (all 19 page components lazy-loaded), Socket.IO removed (server + client), dead code purged (TreeView, ConnectionLine, batchInsert, dead shared types).

## 2026-04-06

- Split `augmentation.service.ts` god file into `augmentation.service.ts` (core CRUD), `platform-linking.service.ts`, `augmentation-photo.service.ts`, `provider-mapping.service.ts`; deduped scraper helpers.
- Dependency audits — lodash, path-to-regexp, socket.io-parser, picomatch patches.

## 2026-03-28

- Tree Statistics page with completeness dashboard, top surnames, lifespans, top birth countries/places, top occupations.
- DRY pass — `ensureDir()` utility, `BASE_URL` re-export, SSE helpers consolidated, provider constants/cache utilities deduped, augmentation routes/service deduped, photo status checks deduped, override/claim routes deduped.

## 2026-03-18

- Ancestry chain-aware unlinked provider checks + audited/unaudited tree overlay.

## 2026-03-05 (Better Audit remediation)

### Security & Secrets

- Server binds to localhost by default (was 0.0.0.0).
- npm audit fixes — lodash, path-to-regexp, picomatch, socket.io-parser.
- Predictable IDs replaced with `crypto.randomUUID()`.
- Stack traces gated behind `NODE_ENV` in error handler.
- CORS origins validated via URL constructor.
- Test-mode and test-runner endpoints gated behind `NODE_ENV`.
- SQLite DB file now created with `0o600` permissions.

### Code Quality

- `sync.service.ts` — silent `.catch(() => null/{})` replaced with logged warnings.
- `multi-platform-comparison.service.ts` — explicit return + logging in catch.
- `ai-discovery.service.ts` — try/catch JSON parsing replaced with functional `safeJsonParse`.
- `path.service.ts` — unsafe `queue.shift()!` replaced with safe shift + early return.
- Magic numbers extracted to named constants in `requestTimeout.ts`, `cache.service.ts`, `id-mapping.service.ts`, `map.routes.ts`.

### DRY & YAGNI

- `createSseManager()` factory replaces 3 duplicate SSE manager implementations.
- `useLocalStorage` hook replaces duplicate localStorage sync in `SidebarContext` / `ThemeContext`.
- `downloadImage()` utility (`server/src/utils/downloadImage.ts`) deduped from scraper + augmentation.
- `getPhotoPath(personId, platform)` consolidated 4 per-platform path methods.
- `ensureBrowserConnected()` helper extracted.
- `linkPlatform` factory in `augmentation.routes.ts` — 4 per-platform POSTs collapse to one.

### Bugs, Performance & Error Handling

- `pathLongest.ts` memory leak — reconstruct ancestors from `parentOf` chain on demand.
- `useSSE.ts` — addEventListener cleanup in unmount.
- `IntegrityPage.tsx` — EventSource error handler.
- `CopyButton.tsx` — `clearTimeout` in unmount.
- `TreeCanvas.tsx` — D3 zoom `.on('.zoom', null)` cleanup.
- `requestTimeout` — timer cleared on `res.on('finish'/'close')`.
- `geocode.service.ts` — fixed promise chaining + rate-limit deadlock.
- `asyncHandler` wired into `ai-discovery`, `ancestry-hints`, `augmentation` routes.

## Earlier (Phases 1–15.23)

For implementation detail see [docs/roadmap.md](./docs/roadmap.md).

- **Phases 1–5**: Shared types, enhanced person extraction, database rebuild, UI updates.
- **Phase 6**: Multi-provider genealogy system.
- **Phase 7**: Favorites & sparse family tree.
- **Phase 8**: FamilySearch-style ancestry tree.
- **Phases 9–10**: Browser-based provider system (Playwright CDP).
- **Phase 11**: Browser settings page.
- **Phase 12**: DRY theme system.
- **Phase 13**: Provider login credentials (AES-256-GCM).
- **Phase 14**: SQLite storage layer (better-sqlite3 + FTS5).
- **Phase 15**: Canonical ID migration (ULIDs).
- **Phase 15.8**: FamilySearch redirect/merge handling.
- **Phase 15.9**: Editable person profile pages (`local_override` table).
- **Phase 15.10**: FamilySearch bidirectional sync (download + upload).
- **Phase 15.11**: Multi-platform data comparison + unified provider cache.
- **Phase 15.12**: PersonDetail UX redesign + `ProviderDataTable`.
- **Phase 15.13**: Provider comparison table + LinkedIn integration.
- **Phase 15.15**: Parent provider ID discovery (single + BFS bulk).
- **Phase 15.16**: Ancestry photo upload via Playwright.
- **Phase 15.17**: Data integrity page + bulk discovery (SSE).
- **Phase 15.18**: Separate provider download from auto-apply ("Use" buttons).
- **Phase 15.19**: Normalize FamilySearch as downstream provider; legacy fallback removal.
- **Phase 15.20**: Relationship linking (parents, spouses, children).
- **Phase 15.21**: Tree visualization parity (Fan, Horizontal, Vertical, Columns, Focus).
- **Phase 15.22**: Ancestry free hints automation.
- **Phase 15.23**: Migration Map visualization (Leaflet + geocoding).
- **Server logging overhaul** — emoji-prefixed structured logger with timing.
- **Playwright scraper DRY** — `performLoginWithSelectors()`, `scrapeAncestorsBFS()`, `isPlaceholderImage()`.
