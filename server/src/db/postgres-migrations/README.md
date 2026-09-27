# PostgreSQL migrations

Add forward-only SQL migrations here as `NNN_short_name.sql`, starting at `002`.
The baseline is `postgres-schema.sql` at version `001`. Applied migrations are
tracked with their name and SHA-256 checksum; never edit an applied file. Add a
new version for every later schema change.
