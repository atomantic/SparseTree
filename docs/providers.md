# Genealogy Providers

SparseTree supports multiple genealogy platforms via browser-based scraping.

## Supported Providers

| Provider | Status | Login | Notes |
|----------|--------|-------|-------|
| FamilySearch | Full support | Browser + Google SSO | Primary provider |
| Ancestry | Partial | Browser | Requires subscription |
| WikiTree | Partial | Browser | Public profiles |
| 23andMe | Limited | Browser | Canvas-based UI challenges |

## Configuration

Navigate to `/providers/genealogy` in the web UI to:

- Check login status for each provider
- Log in via the connected browser
- Save credentials for auto-login
- Enable/disable providers

## Authentication Flow

### Manual Login

1. Connect to browser at `/settings/browser`
2. Click "Login" on provider card
3. Complete login in browser window
4. Click "Check Session" to verify

### Google SSO (FamilySearch)

1. Connect to browser
2. Click "Login with Google" on FamilySearch card
3. Google sign-in completes automatically if already logged into Google

### Auto-Login

1. Save credentials via "Add Credentials" button
2. Enable "Auto-login" toggle
3. System will auto-login when session expires

**Security Note:** Credentials are stored encrypted in `data/credentials.json` using AES-256-GCM. The encryption key is stored in `data/.credentials-key`. Both files are git-ignored.

## Provider URLs

| Provider | Login URL | Tree URL Pattern |
|----------|-----------|------------------|
| FamilySearch | familysearch.org/auth/familysearch/login | familysearch.org/tree/pedigree/landscape/{id} |
| Ancestry | ancestry.com/account/signin | ancestry.com/family-tree/tree/{treeId}/family |
| 23AndMe | you.23andme.com/ | you.23andme.com/family/tree/ |
| WikiTree | wikitree.com/wiki/Special:Userlogin | wikitree.com/wiki/{WikiTreeId} |

## Rate Limiting

Each provider has configurable rate limits to avoid being blocked:

| Provider | Default Min | Default Max |
|----------|-------------|-------------|
| FamilySearch | 100ms | 300ms |
| Ancestry | 200ms | 500ms |
| WikiTree | 100ms | 300ms |
| 23andMe | 500ms | 1000ms |

Configure via `data/provider-config.json` or the web UI.

## Scraper Architecture

Scrapers implement the `ProviderScraper` interface:

```typescript
interface ProviderScraper {
  provider: BuiltInProvider;
  displayName: string;
  loginUrl: string;

  checkLoginStatus(page): Promise<boolean>;
  getLoggedInUser(page): Promise<{name?, userId?} | null>;
  listTrees(page): Promise<ProviderTreeInfo[]>;
  scrapePersonById(page, id): Promise<ScrapedPersonData>;
  scrapeAncestors(page, rootId, maxGen): AsyncGenerator<ScrapedPersonData>;

  loginSelectors: LoginSelectors;
  performLogin(page, username, password): Promise<boolean>;
}
```

Scrapers: `server/src/services/scrapers/`

## Browser Settings

Navigate to `/settings/browser` for:

- CDP port configuration (default: 9920)
- Auto-connect on server start
- View open browser pages
- Launch/connect/disconnect browser

### Manual Browser Launch

```bash
CDP_PORT=9920 ./.browser/start.sh
```

Profile data persists in `.browser/data/`.

## GEDCOM Import/Export

Navigate to `/tools/gedcom` for:

### Import

1. Upload `.ged` file
2. Preview contents
3. Validate format
4. Import to new database

### Export

1. Select database
2. Download as `.ged` file

Supports GEDCOM 5.5.1 format.
