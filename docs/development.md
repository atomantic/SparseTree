# Development Guide

## Project Structure

```
SparseTree/
├── client/          # React + Vite + Tailwind frontend
├── server/          # Express API backend
├── shared/          # TypeScript types shared between client/server
├── lib/             # Core library (API client, path finding, etc.)
├── scripts/         # Migration and utility scripts
├── data/            # Local data storage (git-ignored)
├── .browser/        # Browser automation profile
├── docs/            # Documentation
└── .changelog/      # Release notes by version
```

## Setup

### Prerequisites

- Node.js 18+
- npm 9+
- PostgreSQL 15+ (optional during the staged query-store migration)

### Installation

```bash
git clone https://github.com/atomantic/SparseTree.git
cd SparseTree
npm install
npm run build
```

### Development Mode

The app runs via PM2 with auto-restart on file changes:

```bash
pm2 start ecosystem.config.cjs
```

- **Frontend**: http://localhost:6373
- **Backend**: http://localhost:6374

To restart after config changes:

```bash
pm2 restart ecosystem.config.cjs
```

**Note:** Don't use `pm2 kill` or `pm2 delete all` as this server may have multiple PM2 apps running.

### PostgreSQL query store (staged)

PostgreSQL is being introduced as a rebuildable query layer while JSON files in
`data/person/` remain the source of truth. Core database/person reads and full/quick person search now use
PostgreSQL when `DATABASE_URL` is configured and the store has been rebuilt.
`DATABASE_URL` remains optional: without it, core reads use the existing
`data/db-*.json` and bundled sample graphs. Relationships, audit state, local
overrides, favorites, discovery dismissals, media metadata, geocodes, and
augmentation state now use PostgreSQL. The remaining SQLite startup and CLI
cutover is tracked separately in #155.

To make a standard connection URL available to the staged service, export it before
starting the process:

```bash
export DATABASE_URL='postgresql://sparsetree:password@localhost:5432/sparsetree'
pm2 restart ecosystem.config.cjs --update-env
```

Credentials are not stored in `ecosystem.config.cjs`. When `DATABASE_URL` is absent,
indexing and rebuild commands keep their current SQLite/JSON behavior. When it is
present, the completed JSON graph is also synchronized into PostgreSQL in one
transaction; core application reads use the rebuilt PostgreSQL data.
An unreachable configured database fails that explicit PostgreSQL write instead of
silently leaving a partially refreshed query store.

Core read availability is checked lazily before the first request. An empty or
missing store, connection refusal, connection loss, or a connection/query timeout
selects JSON fallback. If the connection fails partway through a read, the whole
read is replayed against JSON; partial PostgreSQL results are discarded. Connection
acquisition is limited to two seconds and individual queries to ten seconds. After
a failed check/read, the next request after five seconds can retry PostgreSQL;
`databaseService.reinitialize()` forces an immediate recheck. SQL syntax errors
and other programming errors are surfaced instead of being hidden as outages.

JSON fallback retains the graph's provider IDs and any canonical IDs already in
the JSON. Root/person aliases learned during this process are also retained in
memory for requests that were already using canonical URLs. Refresh the database
list after a restart with PostgreSQL unavailable to use the JSON root IDs. JSON
statistics report available graph facts; store-only favorite, provider, and media
counts are zero/empty in that mode.

### Local user data during the PostgreSQL cutover

After rebuilding provider data into PostgreSQL, import the existing SQLite user
metadata before resuming edits. Keep application writes stopped during this
explicit, one-time transfer and retain the SQLite file as a backup:

```bash
npx tsx scripts/migrate-local-data-to-postgres.ts --sqlite data/sparsetree.db --dry-run
npx tsx scripts/migrate-local-data-to-postgres.ts --sqlite data/sparsetree.db
```

Both commands use the configured `DATABASE_URL`. The importer opens SQLite in
read-only mode and maps person/database/event/claim IDs through the rebuilt
provider identities. It copies local overrides and claims, local relationships,
favorites/tags, dismissals, media/blob metadata, provider mappings/descriptions,
unusual-death metadata, and geocode caches in one PostgreSQL transaction. Blob
files retain their relative paths under `data/`; they are not moved.

Existing PostgreSQL rows win conflicts. Missing or ambiguous identity mappings,
unsupported override entities, or a manual unusual-death flag that could replace
a newer PostgreSQL edit abort the entire import. Reconcile those records before
retrying. Dry runs roll back all rows and the migration marker; successful imports
record `postgres_004_local_data_import`, making reruns safe after later user edits
or deletions. The CLI prints counts and bounded errors, without record contents or
connection credentials.

Augmentation JSON files are imported lazily into `person_augmentation.data` JSONB
when first read and remain file backups. Concurrent augmentation/favorite/link
mutations serialize per canonical person. Local overrides and their claim/event
IDs survive provider JSON rebuilds and take precedence on person reads. Refreshing
from FamilySearch writes the raw provider JSON cache and synchronizes normalized
rows and redirected identities in one PostgreSQL transaction.

Person search uses a GIN-indexed `person_search.search_document`, refreshed by
transactional person and alias/occupation claim triggers (all sources, including
local claims). First PostgreSQL search initializes the schema and upgrades/backfills
older staged documents once; subsequent requests reuse initialization. Rebuilding
from JSON also applies the upgrade. Neither path needs `person_fts` or SQLite
migration `003_rebuild_fts`; those remain solely for legacy SQLite tooling.

Search retains literal phrase matching with a prefix on the final word:
`John Smi` matches `John Smith`, while `mit` does not match `Smith`. Punctuation
separates words, case and common combining accents are folded, and operators are
literal words rather than executable query syntax. Names, birth names, aliases,
biography and occupations all use the `simple` dictionary (no stemming/stop words).
`pg_trgm` is unnecessary for these prefix fixtures; typo tolerance and arbitrary
substring matching are not added. Name/alias/occupation weights are retained in the
vector, but both existing endpoints continue alphabetical ordering, with person ID
as a deterministic tie-breaker. Phrase matches cannot span different fields.
Counts, filters and pagination are computed in PostgreSQL before loading people.
JSON outage fallback retains the existing in-memory substring search; generation
and stored-photo filters still require PostgreSQL in that mode.

Writes are never replayed against JSON after an uncertain PostgreSQL outcome.
Root creation/configuration requires the query store. When PostgreSQL is
configured, database deletion requires it to be available and commits removal of
the root, memberships, and favorites before deleting the matching JSON graph.
Any query-store failure preserves JSON. Bundled sample roots remain protected.

To rebuild a clean PostgreSQL query store directly from the read-only person cache:

```bash
DATABASE_URL='postgresql://sparsetree:password@localhost:5432/sparsetree' \
  npx tsx scripts/rebuild.ts FAMILYSEARCH_ROOT_ID

# Limit traversal to the same ancestor depth as an index run
DATABASE_URL="$DATABASE_URL" npx tsx scripts/rebuild.ts FAMILYSEARCH_ROOT_ID --max=10
```

The root and its parents are loaded from `data/person/*.json`; no rows are copied
from `data/sparsetree.db`. Re-running the command updates provider-derived rows in
place while preserving canonical ULIDs and local rows that reference them.

The PostgreSQL integration test creates and removes a unique schema inside the
database named by `SPARSETREE_TEST_DATABASE_URL`:

```bash
SPARSETREE_TEST_DATABASE_URL="$DATABASE_URL" \
  npm test -- --run tests/integration/db
```

## Build

```bash
npm run build                    # Build all workspaces
npm run build -w client          # Build client only
npm run build -w server          # Build server only
npm run build -w shared          # Build shared types only
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build all packages |
| `npm run dev` | Start development servers |
| `npm run migrate` | Run pending data migrations |
| `npm run migrate:status` | Check migration status |
| `npm run migrate:dry-run` | Preview migrations |

## Browser Automation

SparseTree uses Playwright to connect to a persistent Chrome instance for genealogy provider scraping.

### Start the Browser

```bash
./.browser/start.sh
```

Or with custom CDP port:

```bash
CDP_PORT=9920 ./.browser/start.sh
```

The browser profile is stored in `.browser/data/` to persist logins.

### Connect via Web UI

1. Navigate to `/settings/browser`
2. Click "Connect" to attach Playwright
3. Navigate to `/providers/genealogy` to log into providers

### CDP Configuration

- Default port: `9920`
- Config file: `data/browser-config.json`
- Auto-connect: Can be enabled to connect on server start

## Git Workflow

### Branches

- **main**: Active development
- **release**: Push `main` to `release` to trigger the GitHub Release workflow

### Pushing Changes

Always use rebase:

```bash
git pull --rebase --autostash && git push
```

### Releasing

```bash
# 1. Bump version in package.json
# 2. Ensure .changelog/v{major}.{minor}.x.md is up to date
# 3. Push to main, then trigger release:
git push origin main:release
```

The release workflow will create a GitHub Release, archive the changelog on `main`, and fast-forward the `release` branch to match.

### Commit Guidelines

- Create commits after each feature or bug fix
- Run lint before committing
- Update `.changelog/v{major}.{minor}.x.md` with changes

### Release Changelog

All release notes are maintained in `.changelog/v{major}.{minor}.x.md` files:

1. Add entries under appropriate emoji sections during development
2. Keep version as `0.3.x` (CI replaces with actual version on release)
3. Final review before pushing to `release`

See `.changelog/README.md` for detailed format.

## Testing

```bash
npm test                         # Run all tests
npm test -w server               # Server tests only
npm test -w client               # Client tests only
```

## Code Style

- ES modules (`"type": "module"` in package.json)
- Functional programming preferred over classes
- No `try/catch` if it can be avoided
- No `window.alert`/`window.confirm` - use toast and modals
- DRY and YAGNI design patterns
- Full URL paths for routes (no spawning modals without deep links)

## Theme System

CSS variables in `client/src/index.css` with Tailwind utilities:

- Use `text-app-*`, `bg-app-*`, `border-app-*` classes
- Theme toggle in sidebar footer
- Dark mode: `.dark` class on `<html>`

See `client/tailwind.config.js` for all theme utilities.

## API access boundary

The API and Vite development/preview servers bind to loopback (`localhost`) by default.
Only `localhost`, `127.0.0.1`, and `::1` are considered local binds. Any other
`HOST` (API) or `VITE_HOST` (development UI/proxy) requires a non-empty
`SPARSETREE_API_TOKEN` supplied privately in the process environment. PM2 passes
these settings through; never put the token in tracked configuration or a
`VITE_` environment variable, which could bundle it into client code.

When a token is configured, every HTTP handler (including AI Toolkit and health)
requires `Authorization: Bearer <token>`, even if the API itself uses a loopback
bind. This also protects a development proxy forwarding requests to a local API.
Missing/malformed credentials return 401; incorrect credentials return 403.
The token is neither logged nor returned. The current web UI has no token entry
flow: keep its normal development use on loopback, and use authenticated API
clients for external access. Do not inject a token into a proxy for all callers.

`CORS_ORIGIN` is a comma-separated list of exact HTTP(S) origins (default:
`http://localhost:6373`); wildcards, paths and embedded credentials are rejected.
CORS does not grant API access, and credentialed CORS is disabled. Keep deployments
on private networks. Independently configured proxies must preserve bearer
headers and must not expose a token-free local listener. Browser/CDP access remains private. FamilySearch browser
session tokens are available only to internal refresh/indexing jobs through
`browserService.getFamilySearchToken()`; `/api/browser/token` no longer exists.
