# Unreleased Changes

## Added

- Tree auditor agent: BFS-walks family tree validating data integrity (impossible dates, parent age conflicts, placeholder names, unlinked providers)
- Audit persistence in SQLite with pause/resume/cancel support via cursor serialization
- Audit REST API with SSE event streaming, issue accept/reject/undo, bulk operations
- Audit UI: full audit page with issue list/filters, tree view with severity overlays, per-person audit issues panel
- Auto-run schema migrations on server startup
- `hint` severity tier for low-priority audit issues (gray styling, HelpCircle icon)

## Changed

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

- Platform comparison now treats equivalent date formats as matches (e.g., "1979-07-31" vs "31 JUL 1979")
- `isLegacyFormat` augmentation type guard no longer crashes on string/null input

## Removed
