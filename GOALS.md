# Goals

SparseTree exists to give genealogy researchers full ownership of their family tree data, free from the limitations of any single platform.

## Own Your Ancestry Data

Genealogy platforms like FamilySearch, Ancestry, WikiTree, and 23andMe each hold fragments of your family history. SparseTree downloads and normalizes data from all of them into a single local SQLite database, giving you a unified, offline-capable record of your direct lineage that you control.

- Download ancestors from any supported provider via browser automation
- Store everything locally: people, relationships, life events, photos, sources
- Canonical identity system (ULIDs) that maps to every provider's IDs
- No vendor lock-in: your data lives on your machine in open formats (SQLite + JSON)

## Visualize Your Tree

Multiple visualization modes let you explore your ancestry in the way that makes the most sense for the question you're asking.

- **Fan Chart** -- radial view with paternal/maternal lineage coloring
- **Horizontal Pedigree** -- classic left-to-right ancestor expansion
- **Vertical Family** -- top-down generational layout
- **Generational Columns** -- side-by-side generation comparison
- **Focus Navigator** -- single-person deep dive
- **Migration Map** -- plot ancestors on a world map with migration lines and time filtering

## Build Sparse Trees

Not every ancestor is equally interesting. The sparse tree feature lets you mark favorites (royalty, immigrants, revolutionaries, founders, notable figures) and generate simplified visualizations that skip uninteresting generations, showing only the lineage paths that matter to you.

- Tag ancestors with categories (royalty, immigrant, revolutionary, founder, notable)
- Add personal notes explaining why someone is interesting
- Generate pedigree views that collapse intermediate generations
- Sparse tree migration maps showing only your curated ancestors

## Curate and Correct Data Across Platforms

Provider data is often incomplete, inconsistent, or wrong. SparseTree treats itself as the canonical source of truth and every provider as a downstream data source, letting you compare, correct, and push changes back.

- **Side-by-side comparison** of person data across all linked providers
- **Field-level diff** showing matches, differences, and missing data per provider
- **Local overrides** that survive re-downloads from providers
- **Bidirectional sync** -- download from providers, upload corrections back via browser automation
- **Explicit apply** -- downloaded provider data is never auto-applied; you choose what to accept
- **Photo management** -- download, compare, and upload photos across platforms
- **Parent discovery** -- automatically find and link provider-specific IDs for ancestors
- **Hint automation** -- process free record hints on Ancestry automatically
- **Data integrity dashboard** -- find orphaned edges, missing provider links, and stale records

## Non-Goals

- Replacing genealogy platforms -- SparseTree is a local toolkit, not a hosted service
- Collaborative editing -- this is a single-user, local-first application
- GEDCOM import/export -- not yet supported (may come later)
