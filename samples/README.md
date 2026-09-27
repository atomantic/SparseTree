# SparseTree Sample Data

This directory contains the canonical ID mapping used by the sample-data loader.

## Sample Person: John le Strange

- **FamilySearch ID**: 9CNK-KN3
- **Generations**: 5 (ancestors only)

`id-mapping.json` stores the stable mapping between canonical ULIDs and
FamilySearch IDs. The sample graph is loaded into the configured PostgreSQL
query store; no database file is shipped or detected automatically.

To rebuild the sample database from a local JSON tree:

```bash
DATABASE_URL=... npx tsx scripts/create-sample-data.ts
```
