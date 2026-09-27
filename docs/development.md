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
- PostgreSQL 15+ for normalized queries and local writes; read-only JSON browsing remains available without it

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

### PostgreSQL database

Raw provider JSON in `data/person/` remains the source of truth and the read-only
fallback. PostgreSQL stores normalized query data, search indexes, local edits,
favorites, relationships, enrichment, and audit state. There is no SQLite runtime
or native SQLite addon. Existing `data/sparsetree.db` files are left untouched;
they can be read only by the explicit legacy metadata importer below.

PostgreSQL is optional for read-only browsing. Without `DATABASE_URL`, or when a
configured server is unavailable, the API starts with JSON-backed read-only views.
Writes that need PostgreSQL return an error rather than being replayed against JSON.
The application listener keeps its localhost/private-network default; configuring a
database does not change the listener or expose host controls.

#### Create and initialize a local database

Install PostgreSQL using your operating system's package manager, then create a
local role and database with your normal PostgreSQL administration tools. For a
local development server, for example:

```bash
createuser sparsetree --pwprompt
createdb --owner=sparsetree sparsetree
export DATABASE_URL='postgresql://sparsetree:<password>@localhost:5432/sparsetree'
```

Do not put database credentials in `ecosystem.config.cjs` or commit them. Apply the
baseline and pending forward-only migrations, then rebuild normalized rows from the
provider cache:

```bash
npm run migrate:status
npm run migrate
npx tsx scripts/rebuild.ts FAMILYSEARCH_ROOT_ID
```

The server also applies pending migrations before opening its listener when
`DATABASE_URL` is configured. `npm run migrate:dry-run` lists pending work without
applying it. The migration ledger records version, name, and SQL checksum; an
applied migration whose source changes is rejected. Rebuilds are transactional and
preserve canonical IDs and local rows. To rebuild a clean store, first create an
empty PostgreSQL database, then run the migration and rebuild commands above.

#### Transfer local data from an older installation

Stop application writes, rebuild provider identities in PostgreSQL, and then run
the explicit one-time importer against the old database file. It opens the source
read-only using Python's standard `sqlite3` module; the server and supported tools
do not load a SQLite driver.

```bash
npx tsx scripts/migrate-local-data-to-postgres.ts --sqlite data/sparsetree.db --dry-run
npx tsx scripts/migrate-local-data-to-postgres.ts --sqlite data/sparsetree.db
```

Keep the legacy file as a backup until the imported data has been checked. The
import is transactional, maps old identities to rebuilt PostgreSQL identities,
and leaves the source file and blob files in place. There is no automatic import,
conversion, or deletion of legacy database files.

#### Backups and recovery

Back up the PostgreSQL query store with PostgreSQL's standard tools:

```bash
pg_dump --format=custom --file=/path/to/sparsetree.dump "$DATABASE_URL"
pg_restore --list /path/to/sparsetree.dump
```

To restore, create or select the intended database first, then run
`pg_restore --clean --if-exists --dbname="$DATABASE_URL" /path/to/sparsetree.dump`.
Raw provider JSON is separate and remains the rebuild source, so back up both the
PostgreSQL database and `data/` when preserving a complete installation. A lost or
empty query store can be recreated by applying migrations and rebuilding from the
JSON cache.

When PostgreSQL is unreachable, the server starts with read-only JSON fallback.
Missing/empty stores and transient connection failures also select JSON for reads;
a later request retries PostgreSQL. If a PostgreSQL read fails partway through, its
partial results are discarded before retrying from JSON. SQL and programming errors
are surfaced. PostgreSQL writes are never retried against JSON after an uncertain
outcome, and database deletion preserves the JSON graph if PostgreSQL is unavailable.

#### Local metadata behavior

Local overrides and their claim/event IDs survive provider rebuilds and take
precedence on person reads. FamilySearch refreshes write raw JSON and normalized
PostgreSQL rows transactionally. Augmentation JSON files remain backups and are
imported lazily into PostgreSQL. The sample-data command rebuilds the sample graph
from a local JSON tree in PostgreSQL; it does not generate a SQLite database file.

Person search uses a GIN-indexed `person_search.search_document`, refreshed by
transactional person and alias/occupation claim triggers. Search keeps literal
phrase matching with a prefix on the final word: `John Smi` matches `John Smith`,
while `mit` does not. Punctuation separates words, case and common combining accents
are folded, and operators are literal words. Phrase matches cannot span fields.
Results, filters, counts, and pagination are calculated in PostgreSQL before people
are loaded.

The PostgreSQL integration tests create and remove a unique schema in the dedicated
test database named by `SPARSETREE_TEST_DATABASE_URL`. Do not point this variable at
a production database.

```bash
SPARSETREE_TEST_DATABASE_URL="$DATABASE_URL" npm run test:integration
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
