# Release Changelogs

This directory contains detailed release notes for each version of SparseTree. These files are used by the GitHub Actions release workflow to create rich, user-friendly release descriptions.

**No root CHANGELOG.md needed** - all changelog content lives in this directory.

## Structure

### NEXT.md — Unreleased Changes Accumulator

During development, all changelog entries are appended to `NEXT.md`. This file accumulates changes across multiple commits until a release is created.

- `/cam` (commit all my work) automatically adds entries to `NEXT.md`
- `/release` renames `NEXT.md` to `v{version}.md` and finalizes it with the version number and release date
- Do NOT create versioned changelog files manually — `/release` handles that

### Versioned Files

Each release has its own markdown file:

```
v{major}.{minor}.{patch}.md
```

These are created automatically by `/release` from `NEXT.md`.

## Format

Each changelog file should follow this structure:

```markdown
# Release v{version}

Released: YYYY-MM-DD

## Overview

A brief summary of the release.

## Added

- Feature descriptions

## Changed

- What was changed

## Fixed

- Description of what was fixed

## Removed

- What was removed

## Full Changelog

**Full Diff**: https://github.com/atomantic/SparseTree/compare/v{prev}...v{current}
```

## Workflow Integration

The GitHub Actions release workflow (`.github/workflows/release.yml`) automatically:

1. Checks for a changelog file matching the version in `package.json`
2. If found, uses it as the GitHub release description
3. If not found, falls back to generating a simple changelog from git commits

## Development Workflow

1. **During Development**: Each `/cam` commit appends entries to `NEXT.md` under the appropriate section (Added, Changed, Fixed, Removed)

2. **During Release** (`/release`):
   - Determines the version bump from conventional commit prefixes
   - Bumps `package.json` version
   - Renames `NEXT.md` → `v{new_version}.md`
   - Adds version header, release date, and diff link
   - Commits the version bump + finalized changelog

## Best Practices

### Do:
- Update the changelog **as you work** via `/cam`
- Use clear, descriptive entries
- Group related changes together
- Explain the "why" not just the "what"

### Don't:
- Create versioned changelog files manually (use `/release`)
- Bump the version in `/cam` — only `/release` does that
- Use vague descriptions like "various improvements"
- Leave placeholder or TODO content

## Maintenance

### Updating Past Releases

If you need to update a past release's changelog:

1. Edit the `.changelog/v{version}.md` file
2. Update the GitHub release manually:
   ```bash
   gh release edit v{version} --notes-file .changelog/v{version}.md
   ```
