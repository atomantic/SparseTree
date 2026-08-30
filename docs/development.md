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
`data/person/` remain the source of truth. The existing SQLite/JSON runtime stays
active until the later cutover work is complete, so `DATABASE_URL` is optional for
now.

To make a standard connection URL available to the staged service, export it before
starting the process:

```bash
export DATABASE_URL='postgresql://sparsetree:password@localhost:5432/sparsetree'
pm2 restart ecosystem.config.cjs --update-env
```

Credentials are not stored in `ecosystem.config.cjs`. When `DATABASE_URL` is absent,
indexing and rebuild commands keep their current SQLite/JSON behavior. When it is
present, the completed JSON graph is also synchronized into PostgreSQL in one
transaction; application reads still use SQLite/JSON until the later cutover slices.
An unreachable configured database fails that explicit PostgreSQL write instead of
silently leaving a partially refreshed query store.

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
  npm test -- --run tests/integration/db/postgresWriter.spec.ts
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
