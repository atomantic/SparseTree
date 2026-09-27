# CLI Commands

SparseTree provides several command-line tools for managing genealogy data.

## Prerequisites

For FamilySearch commands, you need an access token:

1. Log into [FamilySearch](https://www.familysearch.org/tree/pedigree/)
2. Open browser dev tools (F12)
3. Go to Network tab and find any API request
4. Copy the Authorization header value (without "Bearer" prefix)
5. Tokens last 24+ hours

## Commands

### Download Ancestry Data

```bash
FS_ACCESS_TOKEN=YOUR_TOKEN npx tsx scripts/index.ts PERSON_ID [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--max=N` | Limit to N generations |
| `--ignore=ID1,ID2` | Skip specific person IDs |
| `--cache=all\|complete\|none` | Cache behavior (default: all) |
| `--oldest=YEAR` | Only include people born after YEAR (supports BC notation) |
| `--tsv=true` | Also generate TSV file during indexing |

**Examples:**
```bash
# Download 10 generations from a person
FS_ACCESS_TOKEN=$TOKEN npx tsx scripts/index.ts KWZJ-VKB --max=10

# Skip problematic IDs
FS_ACCESS_TOKEN=$TOKEN npx tsx scripts/index.ts KWZJ-VKB --ignore=XXXX-123,YYYY-456

# Only include post-1500 ancestors
FS_ACCESS_TOKEN=$TOKEN npx tsx scripts/index.ts KWZJ-VKB --oldest=1500
```

### Find Lineage Path

```bash
npx tsx scripts/find.ts ROOT_ID ANCESTOR_ID [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--method=s` | Shortest path (default) |
| `--method=l` | Longest path (useful for detecting cycles) |
| `--method=r` | Random path |

**Examples:**
```bash
# Find shortest path between two people
npx tsx scripts/find.ts KWZJ-VKB 9CNK-KN3

# Detect cyclic loops with longest path
npx tsx scripts/find.ts KWZJ-VKB 9CNK-KN3 --method=l
```

### Print Sorted by Date

```bash
npx tsx scripts/print.ts DB_ID [--bio]
```

Print all persons sorted by birth date. Use `--bio` to include biographical text.

### Purge Cached Records

```bash
npx tsx scripts/purge.ts ID1,ID2,...
```

Remove specific person files from the cache. Use this before re-downloading updated records from FamilySearch.

### Prune Unused Files

```bash
npx tsx scripts/prune.ts
```

Remove cached person files that are not represented in the PostgreSQL query store. Set `DATABASE_URL`; the command refuses to proceed when the store has no FamilySearch identities.

### Rebuild Database

```bash
npx tsx scripts/rebuild.ts DB_ID     # Rebuild specific database
npx tsx scripts/rebuild.ts --all     # Rebuild all databases
npx tsx scripts/rebuild.ts DB_ID --max=10
```

Re-extract person data from cached JSON files using the latest schema. Useful after code updates that add new fields.

With `DATABASE_URL` set, the command also rebuilds PostgreSQL transactionally by
walking `data/person/*.json` from `DB_ID`. A specific root can populate a clean
PostgreSQL store even when no `db-DB_ID.json` exists. Without `DATABASE_URL`, it
rebuilds the JSON graph only.

## Data Migration

### Run Migrations

```bash
npm run migrate [-- --status|--dry-run]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--dry-run` | List migrations that would be applied |
| `--status` | Show applied and pending PostgreSQL migrations |

PostgreSQL migrations are forward-only. Add a new versioned migration instead of
editing one that has already been applied.

```bash
npx tsx scripts/migrate-local-data-to-postgres.ts --sqlite data/sparsetree.db --dry-run
npx tsx scripts/migrate-local-data-to-postgres.ts --sqlite data/sparsetree.db
```

This explicit legacy importer transfers local metadata from an older SQLite file;
it does not alter or delete the source file. See the [database setup and recovery guide](./development.md#postgresql-database) before importing.

### Migrate Photos to Blobs

```bash
npx tsx scripts/migrate-photos-to-blobs.ts [options]
```

Move photos from `data/photos/` to content-addressed blob storage.

**Options:**
| Option | Description |
|--------|-------------|
| `--dry-run` | Preview without making changes |
| `--keep-originals` | Don't delete original files |

## Update Script

```bash
./update.sh [options]
```

One-command updates: pulls latest code, installs dependencies, builds, runs migrations, and restarts PM2.

**Options:**
| Option | Description |
|--------|-------------|
| `--dry-run` | Preview what would happen |
| `--no-restart` | Don't restart PM2 |
| `--branch=NAME` | Pull from specific branch |
