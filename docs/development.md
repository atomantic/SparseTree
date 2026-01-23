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

- **dev**: Active development (auto-bumps patch on CI pass)
- **main**: Production releases only

### Pushing Changes

The dev branch receives auto version bump commits from CI. Always use rebase:

```bash
git pull --rebase --autostash && git push
```

### Commit Guidelines

- Create commits after each feature or bug fix
- Run lint before committing
- Update `.changelog/v{major}.{minor}.x.md` with changes

### Release Changelog

All release notes are maintained in `.changelog/v{major}.{minor}.x.md` files:

1. Add entries under appropriate emoji sections during development
2. Keep version as `0.3.x` (CI replaces with actual version on release)
3. Final review before merging `dev → main`

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
