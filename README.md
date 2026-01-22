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
├── data/            # Local data storage
│   ├── person/      # Raw person JSON files
│   ├── db-*.json    # Compiled graph databases
│   └── augment/     # Favorites and augmentation data
├── index.js         # Download ancestry data
├── find.js          # Find lineage paths
├── tsv.js           # Export to TSV
├── print.js         # Print sorted by date
├── purge.js         # Remove cached records
├── prune.js         # Clean unused files
└── rebuild.js       # Rebuild database
```

## License

ISC
