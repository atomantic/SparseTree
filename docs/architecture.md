# Data Architecture

SparseTree uses a hybrid storage model with SQLite as the serving layer and JSON files as the raw data cache.

## Three-Layer Data Model

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

## Storage Layout

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
├── credentials.json     # Encrypted provider credentials (git-ignored)
├── browser-config.json  # Browser automation settings
├── provider-config.json # Provider enable/disable settings
└── .data-version        # Migration tracking
```

## Identity Model

SparseTree uses **canonical ULIDs** as primary identifiers, with provider-specific IDs mapped via the `external_identity` table:

```
FamilySearch ID ──┐
Ancestry ID ──────┼──> external_identity ──> canonical ULID ──> person
WikiTree ID ──────┘
```

- **Canonical IDs**: 26-character ULIDs (e.g., `01HRJK7E8X...`) - owned by SparseTree
- **External IDs**: Provider-specific (e.g., FamilySearch `KWZJ-VKB`)
- **Bidirectional lookup**: API routes accept either format

## SQLite Schema

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
| `claim` | Extensible facts with provenance |
| `source_citation` | Source references for facts |
| `database_info` | Root entries and metadata |
| `database_membership` | Which persons belong to which trees |
| `favorite` | Favorited persons with tags |
| `blob` / `media` | Content-addressed photo storage |
| `person_fts` | FTS5 full-text search index |

Full schema: `server/src/db/schema.sql`

## Life Event Types

SparseTree captures all GEDCOM-X standard fact types plus FamilySearch-specific extensions:

**Vital Events**: Birth, Death, Burial, Cremation, Christening, Baptism

**Religious**: Confirmation, Religion, Ordination, Bar/Bat Mitzvah

**Family**: Marriage, Divorce, Annulment, Adoption

**Occupation**: Occupation, Education, Retirement, Apprenticeship

**Military**: MilitaryService, MilitaryAward, MilitaryDischarge

**Residence**: Residence, Immigration, Emigration, Naturalization

**Legal**: Census, Will, Probate, LandTransaction, NationalId

**FamilySearch Custom**: TitleOfNobility, LifeSketch, CauseOfDeath, TribeName, Clan

Type constants: `shared/src/fact-types.ts`

## Computed Fields View

The `person_computed` view provides pre-calculated fields for AI-friendly search:

```sql
SELECT * FROM person_computed
WHERE age_at_death < 30
   OR title_of_nobility IS NOT NULL
   OR military_service LIKE '%general%';
```

Available computed fields:
- `age_at_death` - Calculated lifespan
- `child_count` - Number of known children
- `first_marriage_year` - Year of first marriage
- `age_at_first_marriage` - Age when first married
- `title_of_nobility` - Noble/royal titles
- `primary_occupation` - Main occupation
- `military_service` - Military service summary
- `has_life_sketch` - Boolean for biographical notes

## Data Sync Flow

### Download (Provider → SparseTree)

1. Fetch person from FamilySearch API
2. Store raw JSON in `data/person/{fsId}.json` (immutable cache)
3. Extract normalized data to SQLite tables
4. Register external ID mapping
5. Download photos to blob storage

### Local Edits

1. User makes edit in SparseTree UI
2. Edit stored in `local_override` table
3. UI shows override value, original preserved
4. Override survives re-download from provider

### Future: Upload (SparseTree → Provider)

1. Compare local data with provider cache
2. Open provider edit page via Playwright
3. Pre-fill form with local values
4. User reviews and submits
