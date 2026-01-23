# SparseTree

A local web UI enhancement of [FamilySearchFinder](https://github.com/atomantic/FamilySearchFinder) - a genealogy toolkit for creating local databases of your family tree, validating data, curating favorites, and generating sparse family tree visualizations that can be printed on posters.

## What is SparseTree?

SparseTree connects to genealogy providers (starting with FamilySearch) to download and store your ancestry data locally. Once you have your data, you can:

- **Validate Data**: Detect cyclic loops (ancestors linked as their own descendants), date inconsistencies, and other data quality issues
- **Curate Favorites**: Mark interesting ancestors with notes about why they're notable (royalty, immigrants, founders, etc.)
- **Generate Sparse Trees**: Create visualizations showing only your selected favorites connected through their lineage - perfect for printing large format posters
- **Cross-Reference**: Link people to multiple genealogy platforms and Wikipedia for richer data

## Why Sparse Trees?

Most family tree visualizations become overwhelming quickly - 10 generations means over 1,000 direct ancestors. SparseTree lets you curate a selection of the most interesting people in your lineage and visualize just those connections, creating a meaningful narrative through history rather than an incomprehensible wall of names.

## Features

- **Local Database**: Download and store ancestry data as JSON for offline access and fast queries
- **Multiple Providers**: Support for FamilySearch, Ancestry, WikiTree, and 23andMe (via browser scraping)
- **Path Finding**: Find the shortest, longest, or random path between any two people in your tree
- **Data Export**: Export to TSV for spreadsheet analysis or GEDCOM for other genealogy software
- **Web Interface**: Modern React-based UI for browsing, searching, and visualizing your tree
- **Favorites System**: Tag and annotate interesting ancestors
- **Sparse Tree Visualization**: D3.js-powered interactive tree showing only your favorites
- **Ancestry Tree View**: FamilySearch-style expandable pedigree chart

## Quick Start

### Prerequisites

- Node.js 18+
- A FamilySearch account

### Installation

```bash
git clone https://github.com/atomantic/SparseTree.git
cd SparseTree
npm install
```

### Get Your Access Token

1. Log into [FamilySearch](https://www.familysearch.org/tree/pedigree/)
2. Open browser dev tools (F12)
3. Go to Network tab and find any API request
4. Copy the Authorization header value (without "Bearer" prefix)
5. Tokens last 24+ hours

### Download Your Tree

```bash
FS_ACCESS_TOKEN=YOUR_TOKEN node index YOUR_PERSON_ID
```

Replace `YOUR_PERSON_ID` with your FamilySearch person ID (found in the URL when viewing a person).

### Start the Web UI

```bash
npm run dev
```

- Frontend: http://localhost:6373
- Backend: http://localhost:6374

## CLI Commands

### Download ancestry data
```bash
FS_ACCESS_TOKEN=YOUR_TOKEN node index PERSON_ID
# Options:
#   --max=N          Limit to N generations
#   --ignore=ID1,ID2 Skip specific person IDs
#   --cache=all|complete|none  Cache behavior (default: all)
#   --oldest=YEAR    Only include people born after YEAR (supports BC notation)
#   --tsv=true       Also generate TSV file during indexing
```

### Find lineage path between two people
```bash
node find ROOT_ID ANCESTOR_ID
# Options:
#   --method=s|l|r   shortest/longest/random path (default: s)
```

### Export database to TSV
```bash
node tsv DB_ID
```

### Print sorted by date
```bash
node print DB_ID [--bio]
```

### Purge records from cache
```bash
node purge ID1,ID2
```

### Prune unused person files
```bash
node prune DB_ID
```

### Rebuild database with new person schema
```bash
node rebuild DB_ID
node rebuild --all
```

## Data Quality Notes

This tool works with FamilySearch's collaborative database. Be aware:

- **Cyclic Loops**: The database allows people to be linked as their own ancestors. Use `--method=l` (longest path) to detect these.
- **Questionable Links**: Deep ancestry (pre-1500s) often contains speculative connections. Take ancient lineages with appropriate skepticism.
- **User Contributions**: Anyone can edit FamilySearch. Verify important connections with primary sources.

When you find errors, you can fix them in the FamilySearch UI, then:
```bash
node purge AFFECTED_ID
FS_ACCESS_TOKEN=YOUR_TOKEN node index YOUR_ROOT_ID
```

## Project Structure

```
SparseTree/
├── client/          # React + Vite + Tailwind frontend
├── server/          # Express API backend
├── shared/          # TypeScript types
├── lib/             # Core library (API client, path finding, etc.)
├── data/            # Local data storage (see Data Architecture below)
├── index.js         # Download ancestry data
├── find.js          # Find lineage paths
├── tsv.js           # Export to TSV
├── print.js         # Print sorted by date
├── purge.js         # Remove cached records
├── prune.js         # Clean unused files
└── rebuild.js       # Rebuild database
```

## Data Architecture

SparseTree uses a **three-layer data model** designed for multi-provider sync with local override support:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Layer 3: Local Overrides                    │
│  User edits that take precedence and survive provider re-sync   │
│                    (SQLite: local_override)                     │
├─────────────────────────────────────────────────────────────────┤
│                    Layer 2: Normalized Data                     │
│  Extracted facts, relationships, life events in SQLite          │
│         (person, life_event, note, parent_edge, etc.)           │
├─────────────────────────────────────────────────────────────────┤
│                     Layer 1: Raw Provider Cache                 │
│  Immutable API responses from FamilySearch, Ancestry, etc.      │
│                    (data/person/*.json)                         │
└─────────────────────────────────────────────────────────────────┘
```

### Storage Layout

```
data/
├── sparsetree.db        # SQLite database (serving layer)
├── person/              # Raw FamilySearch API responses (source of truth)
│   └── {fsId}.json
├── blobs/               # Content-addressed media storage
│   └── {hash[:2]}/
│       └── {hash}.{ext}
├── augment/             # Rich augmentation data (Wikipedia links, etc.)
│   └── {fsId}.json
├── favorites/           # Legacy favorites (migrated to SQLite)
└── .data-version        # Migration tracking
```

### Identity Model

SparseTree uses **canonical ULIDs** as primary identifiers, with provider-specific IDs mapped via the `external_identity` table:

```
FamilySearch ID ──┐
Ancestry ID ──────┼──> external_identity ──> canonical ULID ──> person
WikiTree ID ──────┘
```

- **Canonical IDs**: 26-character ULIDs (e.g., `01HRJK7E8X...`) - owned by SparseTree
- **External IDs**: Provider-specific (e.g., FamilySearch `KWZJ-VKB`)
- **Bidirectional lookup**: API routes accept either format

### SQLite Schema

Core tables in `data/sparsetree.db`:

| Table | Purpose |
|-------|---------|
| `person` | Canonical person records (ULID primary key) |
| `external_identity` | Maps provider IDs to canonical IDs |
| `parent_edge` | Parent-child relationships |
| `spouse_edge` | Marriage relationships |
| `life_event` | All GEDCOM-X fact types (birth, death, occupation, military, titles, etc.) |
| `note` | Life sketches, stories, research notes |
| `local_override` | User edits that survive re-sync |
| `database_info` | Root entries and metadata |
| `database_membership` | Which persons belong to which trees |
| `favorite` | Favorited persons with tags |
| `blob` / `media` | Content-addressed photo storage |
| `person_fts` | FTS5 full-text search index |

### Life Event Types

SparseTree captures all GEDCOM-X standard fact types plus FamilySearch-specific extensions:

**Vital Events**: Birth, Death, Burial, Cremation, Christening, Baptism

**Religious**: Confirmation, Religion, Ordination, Bar/Bat Mitzvah

**Family**: Marriage, Divorce, Annulment, Adoption

**Occupation**: Occupation, Education, Retirement, Apprenticeship

**Military**: MilitaryService, MilitaryAward, MilitaryDischarge

**Residence**: Residence, Immigration, Emigration, Naturalization

**Legal**: Census, Will, Probate, LandTransaction, NationalId

**FamilySearch Custom**: TitleOfNobility, LifeSketch, CauseOfDeath, TribeName, Clan

### Computed Fields View

The `person_computed` view provides pre-calculated fields for AI-friendly search:

```sql
SELECT * FROM person_computed
WHERE age_at_death < 30
   OR title_of_nobility IS NOT NULL
   OR military_service LIKE '%general%';
```

Available computed fields: `age_at_death`, `child_count`, `first_marriage_year`, `age_at_first_marriage`, `title_of_nobility`, `primary_occupation`, `military_service`, `has_life_sketch`

### Data Sync Flow

**Download (Provider → SparseTree)**:
1. Fetch person from FamilySearch API
2. Store raw JSON in `data/person/{fsId}.json` (immutable cache)
3. Extract normalized data to SQLite tables
4. Register external ID mapping

**Local Edits**:
1. User makes edit in SparseTree UI
2. Edit stored in `local_override` table
3. UI shows override value, original preserved
4. Override survives re-download from provider

**Future: Upload (SparseTree → Provider)**:
1. Compare local data with provider cache
2. Open provider edit page via Playwright
3. Pre-fill form with local values
4. User reviews and submits

## License

ISC
