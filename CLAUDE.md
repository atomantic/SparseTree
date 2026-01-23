# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Overview

SparseTree is a genealogy toolkit for creating local databases of your family tree from multiple providers (FamilySearch, Ancestry, WikiTree, 23andMe), with a web UI for browsing, searching, and visualizing your tree. The "sparse tree" feature lets you mark interesting ancestors as favorites and generate simplified visualizations.

## Quick Reference

| Resource | Description |
|----------|-------------|
| [docs/architecture.md](./docs/architecture.md) | Data model, storage layout, identity system |
| [docs/api.md](./docs/api.md) | API endpoint reference |
| [docs/cli.md](./docs/cli.md) | CLI command reference |
| [docs/development.md](./docs/development.md) | Development setup, PM2, browser automation |
| [docs/providers.md](./docs/providers.md) | Genealogy provider configuration |
| [docs/roadmap.md](./docs/roadmap.md) | Detailed phase documentation |
| [PLAN.md](./PLAN.md) | High-level roadmap |

## Essential Commands

```bash
# Development
pm2 restart ecosystem.config.cjs     # Restart app (ports 6373/6374)
npm run build                        # Build all packages

# Migrations
npx tsx scripts/migrate.ts           # Run migrations
npx tsx scripts/migrate.ts --status  # Check status

# Update
./update.sh                          # Pull, build, migrate, restart

# Download ancestry
FS_ACCESS_TOKEN=TOKEN npx tsx scripts/index.ts PERSON_ID --max=10
```

## Project Structure

```
client/                         # React + Vite + Tailwind frontend
server/                         # Express API backend
  src/
    lib/                        # Core library modules
      config.ts                 # API credentials, rate limits
      sqlite-writer.ts          # Write to SQLite during indexing
      graph/                    # Path finding algorithms
      familysearch/             # FamilySearch API integration
    services/                   # Business logic
    db/                         # SQLite schema & service
shared/                         # TypeScript types
scripts/                        # CLI tools
  index.ts                      # Main indexer CLI
  find.ts                       # Path finder CLI
  prune.ts                      # Prune orphan cache
  purge.ts                      # Purge records
  rebuild.ts                    # Rebuild databases
  migrate.ts                    # Data migrations
data/                           # Local storage (git-ignored)
docs/                           # Documentation
```

## Architecture Summary

```
Layer 3: Local Overrides    → User edits (SQLite local_override)
Layer 2: Normalized Data    → SQLite (person, life_event, parent_edge, etc.)
Layer 1: Raw Provider Cache → JSON files (data/person/*.json)
```

- **Canonical IDs**: ULIDs (26-char, owned by SparseTree)
- **External IDs**: Provider-specific (FamilySearch, Ancestry, etc.)
- **SQLite**: Fast queries with FTS5 search, JSON as source of truth

## Git Workflow

- **dev**: Active development (auto-bumps patch on CI)
- **main**: Production releases only
- **Push pattern**: `git pull --rebase --autostash && git push`
- **Changelog**: Update `.changelog/v{major}.{minor}.x.md` with changes
- **Commit often**: After each feature or bug fix

## Code Guidelines

- ES modules (`"type": "module"`)
- Functional programming over classes
- No `try/catch` if avoidable
- No `window.alert`/`window.confirm` - use toast and modals
- Full URL paths for routes (no modals without deep links)
- DRY and YAGNI patterns
- Never use `pm2 kill` or `pm2 delete all`

## Key Files

| File | Purpose |
|------|---------|
| `server/src/lib/config.ts` | API credentials, rate limits |
| `server/src/lib/familysearch/transformer.js` | Transform API → person objects |
| `server/src/lib/sqlite-writer.ts` | Write to SQLite during indexing |
| `server/src/lib/graph/*.ts` | Path finding algorithms |
| `server/src/db/schema.sql` | Full SQLite schema |
| `server/src/services/id-mapping.service.ts` | Canonical ↔ external ID lookup |
| `ecosystem.config.cjs` | PM2 configuration |

## Browser Automation

```bash
./.browser/start.sh                  # Start Chrome with CDP
# Default CDP port: 9920
# Profile: .browser/data/
```

Web UI: `/settings/browser` for connection, `/providers/genealogy` for logins.

## Notes

- Database has cyclic loops - use `--method=l` (longest path) to detect
- SQLite auto-enables when `data/sparsetree.db` exists
- Rate limiting built into API calls
- Credentials encrypted with AES-256-GCM in `data/credentials.json`
