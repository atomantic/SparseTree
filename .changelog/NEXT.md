# Unreleased Changes

## Browser automation

- SparseTree now reuses an already-running shared browser (e.g. PortOS's Chrome on CDP port 5556) instead of always launching its own. When a shared browser is reachable it connects to that one and skips starting a second Chrome process; it only launches its own browser (port 9920) as a fallback when no shared browser is found. The Browser settings page shows whether the active browser is "Shared" or "Own", and the shared ports / preference are configurable.

## App launch

- Starting the app (via `pm2 start` or `./update.sh`) now automatically opens the SparseTree UI in a browser tab once the dev server is ready, so you no longer have to remember and type the local URL.

## Data storage resilience

- The app now falls back to reading family-tree data from JSON files when the SQLite database driver can't be loaded, instead of every page failing to load. Previously a missing/incompatible native SQLite binary caused all data endpoints (and avatars on the dashboard and sidebar) to return errors.

## Internal

- Provider comparison cards no longer emit an invalid nested-`<button>` HTML warning under React 19 (the card header is now a `role="button"` element, keeping click and keyboard toggling).
- SQLite driver is now loaded lazily so the server can start and serve JSON-backed data even when the native binding is unavailable.
- Dev server binds all interfaces and accepts Tailscale `*.ts.net` hostnames, so the UI is reachable across the tailnet (over plain HTTP, or HTTPS when fronted by `tailscale serve`).
- PM2 launches the vite UI via the repo-root bin path with an explicit node interpreter, fixing a crash loop (`ERR_MODULE_NOT_FOUND`) that left port 6373 down when npm hoisted vite out of the client workspace.

## Added

- Cause of Death: capture, search, and "unusual death" classification for ancestors. New `/deaths` page lists everyone with a recorded cause; inline editor on the person page edits cause + circumstance (writes through `local_override` so edits survive provider resyncs); manual "Mark unusual" toggle plus auto-classification against a seeded keyword list (drowned, slain, devoured, struck by lightning, etc., editable via `/api/deaths/keywords`). Sparse Tree page gains a `?source=unusual-deaths` toggle that renders a tree seeded from unusual-death ancestors instead of favorites — your "unusual cause of death tree."
- On This Day: dashboard section showing ancestors with birth/death anniversaries on today's date
- Tree auditor agent: BFS-walks family tree validating data integrity (impossible dates, parent age conflicts, placeholder names, unlinked providers)
- Audit persistence in SQLite with pause/resume/cancel support via cursor serialization
- Audit REST API with SSE event streaming, issue accept/reject/undo, bulk operations
- Audit UI: full audit page with issue list/filters, tree view with severity overlays, per-person audit issues panel
- Auto-run schema migrations on server startup
- `hint` severity tier for low-priority audit issues (gray styling, HelpCircle icon)
- File size guard: `npm run check:file-sizes` (wired into CI) fails the build if tracked god-files grow beyond their recorded budget. Locks in shrinkage wins from the Phase 15 god-file remediation

## Changed

- On This Day: dashboard section now supports navigating to any date with prev/next day buttons, a date picker, and a one-click "jump to today" button (shows empty state and loading state instead of disappearing)
- Route-level code splitting: all 19 page components lazy-loaded via `React.lazy()` with Suspense fallback in Layout
- Dashboard refresh/calculate-generations now return data synchronously instead of fire-and-forget with Socket.IO
- Split 1457-line `augmentation.service.ts` god file into focused services: `platform-linking.service.ts` (URL parsing, scrapers, link* functions), `augmentation-photo.service.ts` (photo paths, fetch-from-platform), `provider-mapping.service.ts` (provider mapping CRUD)
- Extracted shared `fetchHtml` and `normalizePhotoUrl` utilities; consolidated duplicate `normalizePhotoUrl` from `multi-platform-comparison.service.ts`
- Extracted `ensureAncestryLoggedIn` and `extractAncestryPhotoFromPage` helpers to dedupe Ancestry login + srcset logic
- Renamed `coverage_gap` audit check to `unlinked_provider` for clarity
- Split provider linkage check into primary (FamilySearch, Ancestry) at `info` severity and optional (WikiTree, 23andMe) at `hint` severity
- Removed `unlinked_provider` from default enabled checks (opt-in only)
- Ancestry unlinked_provider check now only flags when child in BFS chain already has ancestry link (chain-aware)
- Audit tree overlay distinguishes "Clean" (audited, no issues) from "Unaudited" persons
- Issue overlay API returns audited person IDs alongside issue data
- Unlinked provider issue detail shows linked providers with checkmarks and missing provider as addition

## Fixed

- Platform comparison now treats equivalent place spellings as matches: "Dallas, Texas, USA" vs "Dallas, Texas, United States" (and U.S.A. / United States of America / state abbreviations like TX vs Texas, UK vs United Kingdom, etc.) — no longer flagged as `different`. Place containment is now suffix-based, so "Texas" no longer falsely matches "Texarkana"
- Platform comparison now treats equivalent date formats as matches (e.g., "1979-07-31" vs "31 JUL 1979")
- `isLegacyFormat` augmentation type guard no longer crashes on string/null input
- DELETE database route no longer sends success response on error (headers-already-sent crash)

## Security

- Resolved Dependabot advisories where a clean fix existed: bumped the bundled WebSocket library used by the (transitive) Socket.IO client to a patched version (fixes a memory-disclosure and a denial-of-service advisory), and the bundled cookie library in the FamilySearch SDK to a patched version (fixes a cookie-attribute-injection advisory). Remaining open advisories are confined to the local-only `pm2` dev/ops tool and the deprecated `request` HTTP client inside the FamilySearch SDK — neither is exposed to untrusted input, and both require upstream/SDK replacement to clear.
- SSRF guard on browser navigation: `browserService.navigateTo()` (and the `POST /api/browser/navigate` route) now reject any URL outside an allowlist of genealogy domains (`familysearch.org`, `ancestry.com`, `wikitree.com`, `23andme.com`, `wikipedia.org`, `wikimedia.org`, `linkedin.com`, `findagrave.com`, `geni.com` and their subdomains). Previously the authenticated CDP browser could be driven to arbitrary request-supplied URLs (cloud metadata endpoints, internal services). The guard validates the request-supplied URL; it intentionally does not chase redirect hops, since allowlisted genealogy sites legitimately redirect off-domain during auth (e.g. FamilySearch → Google SSO) — acceptable for a single-user private-network deployment. Allowlist + `isAllowedNavigationUrl()` live in `server/src/utils/validation.ts` with unit coverage in `tests/unit/utils/validation.spec.ts`.

## Removed

- Socket.IO: removed server (`socket.service.ts`, `socket.io` dep) and client (`socket.ts`, `useSocket.ts` hooks), replaced with synchronous API + existing SSE
- Dead code: `TreeView` component, `ConnectionLine` component, `batchInsert()` (had SQL injection risk), `getCanonicalDbId()` identity function
- Dead `/socket.io` Vite proxy config
