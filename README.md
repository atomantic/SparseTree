# SparseTree

A genealogy toolkit for creating local databases of your family tree, curating favorites, and generating sparse family tree visualizations.

## What is SparseTree?

SparseTree connects to genealogy providers (FamilySearch, Ancestry, WikiTree, 23andMe) to download and store your ancestry data locally. Once you have your data, you can:

- **Validate Data**: Detect cyclic loops, date inconsistencies, and other data quality issues
- **Curate Favorites**: Mark interesting ancestors with notes (royalty, immigrants, founders, etc.)
- **Generate Sparse Trees**: Visualize only your selected favorites connected through their lineage
- **Cross-Reference**: Link people to multiple genealogy platforms and Wikipedia

## Why Sparse Trees?

Most family tree visualizations become overwhelming quickly - 10 generations means over 1,000 direct ancestors. SparseTree lets you curate the most interesting people and visualize just those connections.

## Quick Start

### Prerequisites

- Node.js 18+
- A FamilySearch account

### Installation

```bash
git clone https://github.com/atomantic/SparseTree.git
cd SparseTree
npm install
npm run build
```

### Get Your Access Token

1. Log into [FamilySearch](https://www.familysearch.org/tree/pedigree/)
2. Open browser dev tools (F12) → Network tab
3. Copy the Authorization header value (without "Bearer" prefix)

### Download Your Tree

```bash
FS_ACCESS_TOKEN=YOUR_TOKEN node index YOUR_PERSON_ID --max=10
```

### Start the Web UI

```bash
pm2 start ecosystem.config.cjs
```

- **Frontend**: http://localhost:6373
- **Backend**: http://localhost:6374

## Features

| Feature | Description |
|---------|-------------|
| Local Database | Download and store ancestry data as JSON + SQLite |
| Multiple Providers | FamilySearch, Ancestry, WikiTree, 23andMe |
| Path Finding | Find shortest/longest/random paths between ancestors |
| Data Export | TSV for spreadsheets, GEDCOM for other software |
| Favorites | Tag and annotate interesting ancestors |
| Sparse Tree | D3.js visualization of favorites only |
| Ancestry View | FamilySearch-style expandable pedigree |

## Documentation

| Document | Description |
|----------|-------------|
| [docs/cli.md](./docs/cli.md) | CLI command reference |
| [docs/architecture.md](./docs/architecture.md) | Data model and storage |
| [docs/api.md](./docs/api.md) | API endpoint reference |
| [docs/development.md](./docs/development.md) | Development setup |
| [docs/providers.md](./docs/providers.md) | Provider configuration |
| [PLAN.md](./PLAN.md) | Development roadmap |

## CLI Commands

```bash
# Download ancestry (up to 10 generations)
FS_ACCESS_TOKEN=TOKEN node index PERSON_ID --max=10

# Find path between two people
node find ROOT_ID ANCESTOR_ID --method=s  # shortest
node find ROOT_ID ANCESTOR_ID --method=l  # longest (detects cycles)

# Export to TSV
node tsv DB_ID

# Rebuild database after code updates
node rebuild DB_ID
```

See [docs/cli.md](./docs/cli.md) for all commands and options.

## Data Quality

FamilySearch is a collaborative database. Be aware:

- **Cyclic Loops**: People can be linked as their own ancestors. Use `--method=l` to detect.
- **Questionable Links**: Deep ancestry (pre-1500s) often contains speculative connections.
- **User Contributions**: Anyone can edit. Verify important connections with primary sources.

## Updating

```bash
./update.sh                    # Pull, build, migrate, restart
./update.sh --dry-run          # Preview changes
```

## License

ISC
