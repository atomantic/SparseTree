#!/usr/bin/env python3
"""Read supported local metadata tables from a legacy SQLite snapshot as JSON."""

import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

TABLES = (
    'person', 'external_identity', 'database_info', 'database_membership', 'vital_event',
    'claim', 'local_override', 'favorite', 'discovery_dismissed', 'blob', 'media',
    'description', 'provider_mapping', 'place_geocode', 'unusual_death_keyword',
    'parent_edge', 'spouse_edge',
)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit('Usage: export-legacy-local-data.py <snapshot.db>')
    uri = Path(sys.argv[1]).resolve().as_uri() + '?mode=ro'
    with closing(sqlite3.connect(uri, uri=True)) as source:
        source.row_factory = sqlite3.Row
        source.execute('PRAGMA query_only = ON')
        source.execute('PRAGMA trusted_schema = OFF')
        tables = {
            row['name']
            for row in source.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        if 'person' not in tables:
            raise SystemExit('The source is not a SparseTree SQLite database.')
        snapshot = {
            table: [dict(row) for row in source.execute(f'SELECT * FROM "{table}"')]
            if table in tables else []
            for table in TABLES
        }
        print(json.dumps(snapshot, separators=(',', ':')))


if __name__ == '__main__':
    main()
