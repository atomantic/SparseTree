# API Reference

Backend runs on port 6374 by default. All endpoints return JSON with `{ success: boolean, data?: T, error?: string }`.

## Databases (Roots)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/databases` | List all root databases |
| POST | `/api/databases` | Create root from person ID |
| GET | `/api/databases/:id` | Get database info |
| PUT | `/api/databases/:id` | Update database (max generations) |
| DELETE | `/api/databases/:id` | Delete database |
| GET | `/api/databases/:id/refresh/events` | SSE: Refresh person count |

## Persons

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/persons/:dbId` | List persons (paginated) |
| GET | `/api/persons/:dbId/:personId` | Get person details |
| GET | `/api/persons/:dbId/:personId/tree` | Get tree data for D3 |
| GET | `/api/persons/:dbId/:personId/identities` | Get external IDs |
| POST | `/api/persons/:dbId/:personId/link` | Link external identity |

## Search

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search/:dbId` | Search with filters |

**Query params:** `q`, `location`, `occupation`, `birthAfter`, `birthBefore`, `page`, `limit`

## Path Finding

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/path/:dbId` | Find path between two people |

**Body:** `{ source, target, method: 'shortest' | 'longest' | 'random' }`

## Ancestry Tree

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ancestry-tree/:dbId/:personId` | Get ancestry tree (4 gen default) |
| POST | `/api/ancestry-tree/:dbId/expand` | Expand specific parents |

## Favorites

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/favorites` | List all favorites |
| GET | `/api/favorites/tags` | Get all tags |
| GET | `/api/favorites/:personId` | Get favorite status |
| POST | `/api/favorites/:personId` | Mark as favorite |
| PUT | `/api/favorites/:personId` | Update favorite |
| DELETE | `/api/favorites/:personId` | Remove from favorites |
| GET | `/api/favorites/in-database/:dbId` | Get favorites in database |
| GET | `/api/favorites/sparse-tree/:dbId` | Get sparse tree data |

### Database-Scoped Favorites

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/favorites/db/:dbId` | List favorites in database |
| GET | `/api/favorites/db/:dbId/:personId` | Get favorite status |
| POST | `/api/favorites/db/:dbId/:personId` | Mark as favorite |
| PUT | `/api/favorites/db/:dbId/:personId` | Update favorite |
| DELETE | `/api/favorites/db/:dbId/:personId` | Remove from favorites |
| GET | `/api/favorites/db/:dbId/tags` | Get tags for database |
| GET | `/api/favorites/db/:dbId/sparse-tree` | Get sparse tree data |

## Augmentation

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/augment/:personId` | Get augmentation data |
| PUT | `/api/augment/:personId` | Update augmentation |
| POST | `/api/augment/:personId/wikipedia` | Link Wikipedia |
| POST | `/api/augment/:personId/ancestry` | Link Ancestry |
| POST | `/api/augment/:personId/wikitree` | Link WikiTree |
| POST | `/api/augment/:personId/provider-link` | Link to any provider |
| GET | `/api/augment/:personId/provider-links` | Get all provider links |
| DELETE | `/api/augment/:personId/provider-link/:providerId` | Unlink provider |
| POST | `/api/augment/:personId/fetch-photo/:platform` | Fetch photo from platform |

## Browser Automation

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/browser/status` | Get browser status |
| GET | `/api/browser/config` | Get browser config |
| PUT | `/api/browser/config` | Update browser config |
| POST | `/api/browser/connect` | Connect to CDP |
| POST | `/api/browser/disconnect` | Disconnect from CDP |
| POST | `/api/browser/launch` | Launch browser process |
| GET | `/api/browser/running` | Check if browser running |
| GET | `/api/browser/events` | SSE: Browser status updates |

## Providers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scrape-providers` | List all providers |
| GET | `/api/scrape-providers/:provider` | Get provider config |
| PUT | `/api/scrape-providers/:provider` | Update provider config |
| POST | `/api/scrape-providers/:provider/toggle` | Enable/disable |
| POST | `/api/scrape-providers/:provider/check-session` | Check login status |
| POST | `/api/scrape-providers/:provider/login` | Open login page |
| POST | `/api/scrape-providers/:provider/login-google` | Open Google SSO (FS only) |
| GET | `/api/scrape-providers/:provider/trees` | List available trees |
| POST | `/api/scrape-providers/:provider/scrape/:personId` | Scrape person |

### Provider Credentials

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scrape-providers/:provider/credentials` | Save credentials |
| GET | `/api/scrape-providers/:provider/credentials` | Get status (no password) |
| DELETE | `/api/scrape-providers/:provider/credentials` | Delete credentials |
| POST | `/api/scrape-providers/:provider/toggle-auto-login` | Toggle auto-login |
| POST | `/api/scrape-providers/:provider/auto-login` | Trigger login attempt |

## GEDCOM

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/gedcom/export/:dbId` | Download GEDCOM file |
| POST | `/api/gedcom/import` | Import GEDCOM |
| POST | `/api/gedcom/validate` | Validate GEDCOM |
| POST | `/api/gedcom/preview` | Preview GEDCOM contents |

## Sync

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sync/:dbId/:personId/compare` | Compare across providers |
| POST | `/api/sync/:dbId/:personId/import` | Import from provider |
| POST | `/api/sync/:dbId/:personId/push` | Open edit page |
| POST | `/api/sync/:dbId/:personId/find-match` | Find matching person |
| POST | `/api/sync/database/:dbId` | Start batch sync |
| GET | `/api/sync/database/:dbId/events` | SSE: Sync progress |

## Indexer

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/indexer/status` | Get indexer status |
| POST | `/api/indexer/start` | Start indexing |
| POST | `/api/indexer/stop` | Stop indexing |
| GET | `/api/indexer/events` | SSE: Indexer progress |

## Export

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export/:dbId/tsv` | Download as TSV |
| GET | `/api/export/:dbId/json` | Download as JSON |
