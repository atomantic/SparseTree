# SparseTree Development Plan

For project mission and milestones, see [GOALS.md](./GOALS.md).
For completed work, see [DONE.md](./DONE.md).
For phase-by-phase implementation history, see [docs/roadmap.md](./docs/roadmap.md).

**Version:** 0.9.x

## Next Up

1. **Reverse god-file regression** — `PersonDetail.tsx` (1360), `ProviderDataTable.tsx` (1243), `database.service.ts` (1446), `auditor-agent.service.ts` (1233 — new), `multi-platform-comparison.service.ts` (1099), `api.ts` (1249), `VerticalFamilyView.tsx` (977), `favorites.service.ts` (872), `person.routes.ts` (965). Extract `usePersonData` / `usePersonOverrides` hooks, `PhotoThumbnail` / `ComparisonCell` / `ProviderRow` sub-components, and split `database.service.ts` along entity lines. Split `auditor-agent.service.ts` into walker + per-check modules.
2. **Critical-path unit tests** — `credentials.service.ts` (encryption), `validation.ts` (input sanitization), `errorHandler.ts`, `requestTimeout.ts`, `augmentation.service.ts`, `auditor-agent.service.ts` all currently have **zero** tests. (`database.service.ts` and `search.service.ts` now have integration coverage but no unit tests of internal helpers.)
3. **Phase 18 remaining checks** — implement `place_mismatch`, `name_mismatch`, `missing_parents`, `duplicate_suspect`, `stale_record` checks in `auditor-agent.service.ts` (types are declared in `shared/src/index.ts:918` but not yet wired). Reuse `multi-platform-comparison.service.ts` for the `*_mismatch` family.
4. **Search N+1** — `searchWithSqlite` still calls `getPerson()` per result inside `Promise.all`. Replace with a single `WHERE person_id IN (...)` batch query.
5. **Phase 19 Guided Verification** — review-session schema (`verification_session`, `person_review`, `edge_review`, `provider_match_review`, `review_decision`) and root-to-ancestor BFS review queue (19.1 + 19.2).

## Backlog

### Cleanup & Security

- [ ] Routine dep refresh — 22 packages outdated (`@tailwindcss/vite`, `better-sqlite3`, `happy-dom`, `msw`, `vite`, `vitest`, `typescript`, `lucide-react`, etc.). Patch/minor only; defer React 19 (see Future).
- [ ] Remove `LegacyAugmentation` interface + `migrateAugmentation` / `isLegacyFormat` helpers in `augmentation.service.ts` once no callers remain.
- [ ] Deprecate non-db-scoped favorites routes (`GET/POST/PUT/DELETE /:personId` in `favorites.routes.ts:166-214`) — duplicates db-scoped endpoints.
- [ ] Add allowlist guard on `browserService.navigateTo()` — currently accepts arbitrary URLs (SSRF risk); restrict to known genealogy domains.
- [ ] Validate `:personId` route param consistently (path-traversal-safe `isCanonicalId` check across all routes that touch the filesystem).
- [ ] Fix `ReportsPage.tsx:264` hardcoded `bg-gray-900 text-gray-300` output console — use theme tokens.

### Performance

- [ ] Optimize `buildPersonFromSqlite()` — 6 sequential queries per call, called in loops at `database.service.ts:442,489,768`. Replace with JOINs or batched queries.
- [ ] Add composite index `vital_event(person_id, place)` for search query performance (no migration covers this yet).
- [ ] Convert `LRUCache` class (`cache.service.ts`, ~210 lines) to factory function to match project's functional style.
- [ ] Add batch person-load endpoint (person + parents + spouses + photo status) — eliminates N+1 on `PersonDetail` mount.

### DRY (still pending from Phase 15.14)

- [ ] Replace 7 boolean `has*Photo` states in `PersonDetail.tsx` with a single `Record<string, boolean>` + batch `/api/persons/:id/photo-status` endpoint.
- [ ] Extract `PLATFORM_REGISTRY` lookup in `PersonDetail.tsx` to replace 3 repeated conditional chains (`linkFn`, `photoCheckFn`, `photoRefreshFn`).
- [ ] Extract shared `PROVIDER_COLORS` / display constants to one module — currently duplicated across `IntegrityPage`, `TreeStatsPage`, `GenealogyProviders`.
- [ ] Extract `useBrowserStatusSSE()` and `useBrowserActions()` hooks (duplicated in `IndexerPage`, `GenealogyProviders`, `BrowserSettingsPage`).
- [ ] Extract `<OutputConsole>` and `<GoogleIcon>` components.
- [ ] Remove the last `buildLifespan` duplicate in `sync.service.ts:200,393,400` (other call sites now use `server/src/utils/lifespan.ts`).
- [ ] Merge `registerExternalIdentityIfEnabled` and `registerProviderMappingIfEnabled` into one helper.
- [ ] Replace per-platform `linkWikipedia/linkAncestry/linkWikiTree/linkLinkedIn` in `client/src/services/api.ts` with generic `linkPlatform(personId, platform, url)`.
- [ ] Standardize route error handling on `asyncHandler` — `person.routes.ts` still uses ad-hoc `.catch(next)` (lines 69, 131, 146).

### Test Quality (from Better Audit)

- [ ] Strengthen weak assertions: `tests/unit/lib/json2person.spec.ts:118,198`, `pathRandom.spec.ts:54`, `pathLongest.spec.ts:120`, `pathShortest.spec.ts:115`, `tests/integration/api/persons.spec.ts:22`, `search.spec.ts:31`.
- [ ] `tests/integration/setup.ts:85` — make integration test DB use real services instead of stubs.

### Phase 16: Multi-Platform Sync (remaining)

- [ ] Golden Copy view mode — merged/curated data with source badges.
- [ ] Download/sync UI with progress tracking.
- [ ] Bidirectional sync with Ancestry / WikiTree (name, dates, places — currently only photos).
- [ ] Cross-platform ID linking with matching heuristics.
- [ ] Conflict resolution UI with per-field value selection.

### Phase 18: AI Tree Auditor (remaining)

- [ ] Implement remaining declared checks: `place_mismatch`, `name_mismatch`, `missing_parents`, `duplicate_suspect`, `stale_record` (types declared, walker not wired).
- [ ] Stale record refresh action — re-pull from provider when `stale_record` issue is accepted.
- [ ] Health score on Audit Dashboard (issue density per generation, trend across runs).

### Phase 19: Guided Verification (remaining sub-phases)

- [ ] 19.3 Ancestry match queue — search Ancestry, score candidates with explainable components, side-by-side review.
- [ ] 19.4 (remaining) — detail-loss vs spelling-conflict statuses; "more detail" / "less detail" alongside `match` / `different`; tests for middle-name omission and date-precision variation.
- [ ] 19.5 Linkage confidence scoring — person/provider, parent edge, path-level scores with weakest-link explanation.
- [ ] 19.6 Notable ancestor path analysis — count all distinct paths, paternal/maternal mix, pedigree-collapse detection.
- [ ] 19.7 Audit signal quality for ancient/historical lines — BC/AD handling, era-aware thresholds, mythic-vs-modern separation.
- [ ] 19.8 UI integration — review status + confidence chips on PersonDetail, generation/branch/confidence filters on Integrity page.
- [ ] 19.9 Automation guardrails — dry-run defaults, exportable review reports.

## Future / Ideas

- CI guard that fails when target files exceed line limits (PersonDetail.tsx, ProviderDataTable.tsx, database.service.ts) — prevents the regression we just measured.
- React 19 upgrade — currently on 18.3 (and react-leaflet 4→5). Audit hooks behavior, types, react-leaflet breaking changes; gate behind a branch.
- Stats trends over time — recent `TreeStatsPage` is a snapshot; chart per-database growth across audit runs.
- Mobile-first review flow — recent mobile fixes (40px touch targets, card overflow) suggest demand for a phone-friendly verification queue.
- GEDCOM import/export — listed as a non-goal in GOALS.md; revisit if user demand emerges.

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: Local Overrides — user edits survive provider re-sync │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Normalized Data — facts, relationships, events (SQL)  │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Raw Provider Cache — immutable JSON from providers    │
└─────────────────────────────────────────────────────────────────┘
```

**SparseTree SQLite is the canonical source of truth.** Provider cache is for comparison only; local overrides take precedence. No legacy fallback code — use migration scripts when storage moves. All providers (FamilySearch, Ancestry, WikiTree, etc.) are equal downstream sources.

See [docs/architecture.md](./docs/architecture.md) for full detail.
