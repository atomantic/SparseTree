# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-01-21

### Added
- **Ancestry.com Linking**: Link persons to their Ancestry.com profiles with automatic photo extraction
  - Browser-based scraping with auto-login support using saved credentials
  - Srcset parsing to extract highest resolution photos (5x = maxside=1800)
  - Auto-launches/connects browser when needed
- **WikiTree Linking**: Link persons to their WikiTree profiles with photo extraction
  - HTTP-based scraping (no auth required for public profiles)
  - Extracts profile photo and description
- **Manual Photo Selection**: "Use Photo" button for each linked platform
  - Separated linking from photo fetching for user control
  - Support for FamilySearch, Wikipedia, Ancestry, and WikiTree photos
  - Photos stored locally with platform-specific naming (`{personId}-ancestry.jpg`, etc.)
- **Unified Platforms UI**: Consolidated all platform links into single "Platforms" section in PersonDetail
  - FamilySearch, Wikipedia, Ancestry, WikiTree all shown together
  - Link and "Use Photo" buttons for each platform

### Changed
- **Photo Priority**: Updated sparse tree view to use photos in order:
  1. Ancestry (highest priority)
  2. WikiTree
  3. Wikipedia
  4. FamilySearch scraped (lowest priority)
- **PlatformReference**: Added `photoUrl` field to store discovered photo URLs before downloading

### Fixed
- Browser auto-connects when linking Ancestry profiles (no more "Browser not connected" errors)
- Ancestry photo now appears in sparse tree view

## [0.1.1] - Previous

- Browser status polling replaced with SSE
- CDP browser integration for indexer
- Ancestry tree line improvements

## [0.1.0] - Initial Release

- Initial version with FamilySearch indexing, Wikipedia linking, favorites, and sparse tree visualization
