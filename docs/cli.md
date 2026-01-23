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
FS_ACCESS_TOKEN=YOUR_TOKEN node index PERSON_ID [options]
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
FS_ACCESS_TOKEN=$TOKEN node index KWZJ-VKB --max=10

# Skip problematic IDs
FS_ACCESS_TOKEN=$TOKEN node index KWZJ-VKB --ignore=XXXX-123,YYYY-456

# Only include post-1500 ancestors
FS_ACCESS_TOKEN=$TOKEN node index KWZJ-VKB --oldest=1500
```

### Find Lineage Path

```bash
node find ROOT_ID ANCESTOR_ID [options]
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
node find KWZJ-VKB 9CNK-KN3

# Detect cyclic loops with longest path
node find KWZJ-VKB 9CNK-KN3 --method=l
```

### Export to TSV

```bash
node tsv DB_ID
```

Exports database to tab-separated values for spreadsheet analysis.

### Print Sorted by Date

```bash
node print DB_ID [--bio]
```

Print all persons sorted by birth date. Use `--bio` to include biographical text.

### Purge Cached Records

```bash
node purge ID1,ID2,...
```

Remove specific person files from the cache. Use this before re-downloading updated records from FamilySearch.

### Prune Unused Files

```bash
node prune DB_ID
```

Remove person files that are not part of the specified database. Useful for cleaning up after changing `--max` or `--ignore` settings.

### Rebuild Database

```bash
node rebuild DB_ID     # Rebuild specific database
node rebuild --all     # Rebuild all databases
```

Re-extract person data from cached JSON files using the latest schema. Useful after code updates that add new fields.

## Data Migration

### Run Migrations

```bash
npx tsx scripts/migrate.ts [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--dry-run` | Preview changes without applying |
| `--status` | Check migration status |
| `--rollback=N` | Rollback last N migrations |

### Migrate to SQLite

```bash
npx tsx scripts/migrate-to-sqlite.ts [options]
```

One-time migration of JSON data to SQLite database.

**Options:**
| Option | Description |
|--------|-------------|
| `--dry-run` | Preview without making changes |
| `--verbose` | Show detailed progress |

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
