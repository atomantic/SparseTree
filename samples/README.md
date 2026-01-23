# SparseTree Sample Data

This directory contains sample genealogy data for testing and demonstration.

## Sample Person: John le Strange

- **FamilySearch ID**: 9CNK-KN3
- **Generations**: 5 (ancestors only)
- **Total Persons**: 11

## Files

- `sample.db` - SQLite database with canonical IDs
- `id-mapping.json` - Mapping between canonical ULIDs and FamilySearch IDs

## Database Statistics

| Table | Count |
|-------|-------|
| Persons | 11 |
| External IDs | 11 |
| Parent Edges | 10 |
| Spouse Edges | 10 |
| Vital Events | 27 |
| Claims | 50 |

## Usage

The sample database is automatically detected by SparseTree when present.
It uses canonical ULID identifiers with FamilySearch IDs mapped in the
`external_identity` table.

To regenerate this sample data:
```bash
npx tsx scripts/create-sample-data.ts
```
