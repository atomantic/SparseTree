# Release Changelogs

This directory contains **all** release notes for SparseTree. Unlike traditional projects that maintain a root `CHANGELOG.md` file, we use version-specific files that evolve with development and automatically archive on release.

**No root CHANGELOG.md needed** - all changelog content lives in this directory.

## Structure

Each minor version series has its own markdown file following the naming convention:

```
v{major}.{minor}.x.md
```

The "x" is a literal character, not a placeholder - it represents the entire minor version series (e.g., all 0.2.x releases share `v0.2.x.md`).

Examples:
- `v0.1.x.md` - Used for releases 0.1.1, 0.1.2, 0.1.3, etc.
- `v0.2.x.md` - Used for releases 0.2.1, 0.2.2, 0.2.3, etc.
- `v1.0.x.md` - Used for releases 1.0.1, 1.0.2, 1.0.3, etc.

## Format

Each changelog file should follow this structure:

```markdown
# Release v{major}.{minor}.x - {Descriptive Title}

Released: YYYY-MM-DD

## Overview

A brief summary of the release, highlighting the main theme or most important changes.

## 🎉 New Features

### Feature Category 1
- Feature description with technical details
- Another feature in this category

## 🐛 Bug Fixes

### Fix Category
- Description of what was fixed
- Impact and technical details

## 🔧 Improvements

### Improvement Category
- What was improved
- Why it matters

## 🗑️ Removed

### Deprecated Features
- What was removed
- Why it was removed

## 📦 Installation

\`\`\`bash
git clone https://github.com/atomantic/SparseTree.git
cd SparseTree
npm run install:all
pm2 start ecosystem.config.cjs
\`\`\`

## 🔗 Full Changelog

**Full Diff**: https://github.com/atomantic/SparseTree/compare/v{prev}...v{major}.{minor}.x
```

## Workflow

### During Development

Update `.changelog/v0.2.x.md` **every time** you add features and fixes:
- Add entries under appropriate emoji sections (🎉 Features, 🐛 Fixes, 🔧 Improvements)
- Keep the version in the file as `v0.2.x` (literal x)
- Don't worry about the final patch number - it will be substituted automatically

### Before Merging to Main

Final review before release:
- Ensure all changes are documented
- Add release date (update "YYYY-MM-DD" to actual date)
- Review and polish the content
- Commit the changelog file

### On Release

The GitHub Actions workflow automatically:
1. Reads `.changelog/v0.2.x.md`
2. Replaces all instances of `0.2.x` with the actual version (e.g., `0.2.5`)
3. Creates the GitHub release with the substituted changelog
4. Renames `v0.2.x.md` → `v0.2.5.md` (preserves git history)
5. Bumps dev to next minor version

### After Release

- Create a new `v0.3.x.md` for the next minor version
- Copy the previous version as a template

## Best Practices

### Do:
- Update the changelog file **as you work** (not just before release)
- Use clear, descriptive section headings
- Group related changes together
- Include technical details where helpful
- Explain the "why" not just the "what"
- Use emoji section headers for visual organization

### Don't:
- Create a root `CHANGELOG.md` file
- Use vague descriptions like "various improvements"
- Include internal implementation details users don't care about
- Leave placeholder or TODO content
- Change the version from `v0.2.x` to specific patch numbers during development
