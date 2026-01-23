-- SparseTree SQLite Schema
-- ULID-based canonical identity with multi-provider support

-- ============================================================================
-- CORE IDENTITY
-- ============================================================================

-- Canonical persons - single source of truth
CREATE TABLE IF NOT EXISTS person (
    person_id TEXT PRIMARY KEY,  -- ULID (26 chars, sortable)
    display_name TEXT NOT NULL,
    birth_name TEXT,
    gender TEXT CHECK(gender IN ('male', 'female', 'unknown')),
    living INTEGER DEFAULT 0,
    bio TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_person_display_name ON person(display_name);
CREATE INDEX IF NOT EXISTS idx_person_gender ON person(gender);

-- Provider ID mappings (N:1 to person)
-- Maps external provider IDs (FamilySearch, Ancestry, etc.) to canonical ULIDs
CREATE TABLE IF NOT EXISTS external_identity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    source TEXT NOT NULL,        -- 'familysearch', 'ancestry', 'wikitree', '23andme', 'geni'
    external_id TEXT NOT NULL,   -- Provider's ID (e.g., 'GW21-BZR')
    url TEXT,                    -- Profile URL on provider
    confidence REAL DEFAULT 1.0, -- 0.0-1.0 confidence this is the same person
    last_seen_at TEXT,
    UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_identity_person ON external_identity(person_id);
CREATE INDEX IF NOT EXISTS idx_external_identity_source ON external_identity(source);
CREATE INDEX IF NOT EXISTS idx_external_identity_lookup ON external_identity(source, external_id);

-- ============================================================================
-- RELATIONSHIPS
-- ============================================================================

-- Parent-child relationships with provenance
CREATE TABLE IF NOT EXISTS parent_edge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    parent_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    parent_role TEXT CHECK(parent_role IN ('father', 'mother', 'parent')),
    confidence REAL DEFAULT 1.0,
    source TEXT,                 -- Which provider asserted this relationship
    UNIQUE(child_id, parent_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_edge_child ON parent_edge(child_id);
CREATE INDEX IF NOT EXISTS idx_parent_edge_parent ON parent_edge(parent_id);

-- Spouse relationships
CREATE TABLE IF NOT EXISTS spouse_edge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person1_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    person2_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    marriage_date TEXT,
    marriage_place TEXT,
    divorce_date TEXT,
    confidence REAL DEFAULT 1.0,
    source TEXT,
    UNIQUE(person1_id, person2_id)
);

CREATE INDEX IF NOT EXISTS idx_spouse_edge_person1 ON spouse_edge(person1_id);
CREATE INDEX IF NOT EXISTS idx_spouse_edge_person2 ON spouse_edge(person2_id);

-- ============================================================================
-- VITAL EVENTS
-- ============================================================================

-- Birth, death, burial, and other vital events
CREATE TABLE IF NOT EXISTS vital_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK(event_type IN ('birth', 'death', 'burial', 'christening', 'marriage', 'divorce')),
    date_original TEXT,          -- Original text (e.g., "abt 1523", "12 Mar 1847")
    date_formal TEXT,            -- ISO-like normalized (+1523, -0500 for 500 BC)
    date_year INTEGER,           -- Extracted year for range queries (negative for BC)
    place TEXT,
    place_id TEXT,               -- Standardized place ID if available
    source TEXT,
    confidence REAL DEFAULT 1.0,
    UNIQUE(person_id, event_type, source)  -- Allow multiple sources per event type
);

CREATE INDEX IF NOT EXISTS idx_vital_event_person ON vital_event(person_id);
CREATE INDEX IF NOT EXISTS idx_vital_event_type ON vital_event(event_type);
CREATE INDEX IF NOT EXISTS idx_vital_event_year ON vital_event(date_year);
CREATE INDEX IF NOT EXISTS idx_vital_event_place ON vital_event(place);

-- ============================================================================
-- EXTENSIBLE CLAIMS/FACTS
-- ============================================================================

-- General-purpose claim storage for occupations, religions, aliases, etc.
CREATE TABLE IF NOT EXISTS claim (
    claim_id TEXT PRIMARY KEY,   -- ULID
    person_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    predicate TEXT NOT NULL,     -- 'occupation', 'religion', 'alias', 'nationality', etc.
    value_text TEXT,
    value_date TEXT,             -- For date-based claims
    source TEXT,
    confidence REAL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_claim_person ON claim(person_id);
CREATE INDEX IF NOT EXISTS idx_claim_predicate ON claim(predicate);
CREATE INDEX IF NOT EXISTS idx_claim_person_predicate ON claim(person_id, predicate);

-- ============================================================================
-- DATABASE MEMBERSHIP
-- ============================================================================

-- Which persons belong to which databases (for multi-tree support)
CREATE TABLE IF NOT EXISTS database_membership (
    db_id TEXT NOT NULL,
    person_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    is_root INTEGER DEFAULT 0,
    generation INTEGER,          -- Distance from root (0 = root, 1 = parents, etc.)
    PRIMARY KEY(db_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_database_membership_db ON database_membership(db_id);
CREATE INDEX IF NOT EXISTS idx_database_membership_root ON database_membership(db_id, is_root);

-- Database metadata
CREATE TABLE IF NOT EXISTS database_info (
    db_id TEXT PRIMARY KEY,
    root_id TEXT REFERENCES person(person_id),
    root_name TEXT,
    source_provider TEXT,
    max_generations INTEGER,
    person_count INTEGER DEFAULT 0,
    is_sample INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- FAVORITES
-- ============================================================================

-- Per-database favorites
CREATE TABLE IF NOT EXISTS favorite (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    db_id TEXT NOT NULL,
    person_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    why_interesting TEXT,
    tags TEXT,                   -- JSON array of tags
    added_at TEXT DEFAULT (datetime('now')),
    UNIQUE(db_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_favorite_db ON favorite(db_id);
CREATE INDEX IF NOT EXISTS idx_favorite_person ON favorite(person_id);
CREATE INDEX IF NOT EXISTS idx_favorite_added_at ON favorite(added_at DESC);

-- ============================================================================
-- MEDIA / BLOBS
-- ============================================================================

-- Content-addressed blob storage
CREATE TABLE IF NOT EXISTS blob (
    blob_hash TEXT PRIMARY KEY,  -- SHA-256 of content
    path TEXT NOT NULL,          -- Relative path in data/blobs/
    mime_type TEXT,
    size_bytes INTEGER,
    width INTEGER,
    height INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Media items linked to persons
CREATE TABLE IF NOT EXISTS media (
    media_id TEXT PRIMARY KEY,   -- ULID
    person_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    blob_hash TEXT REFERENCES blob(blob_hash) ON DELETE SET NULL,
    source TEXT NOT NULL,        -- 'familysearch', 'wikipedia', 'ancestry', etc.
    source_url TEXT,             -- Original URL
    is_primary INTEGER DEFAULT 0,
    caption TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_person ON media(person_id);
CREATE INDEX IF NOT EXISTS idx_media_primary ON media(person_id, is_primary);

-- ============================================================================
-- DESCRIPTIONS / ENRICHMENT
-- ============================================================================

-- Multi-source descriptions
CREATE TABLE IF NOT EXISTS description (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    source TEXT NOT NULL,        -- 'wikipedia', 'familysearch', 'custom', etc.
    language TEXT DEFAULT 'en',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(person_id, source)
);

CREATE INDEX IF NOT EXISTS idx_description_person ON description(person_id);

-- ============================================================================
-- PROVIDER MAPPINGS (for cross-platform account linking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS provider_mapping (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    provider TEXT NOT NULL,      -- 'familysearch', 'ancestry', 'wikitree'
    account_id TEXT,             -- Account ID on that provider
    match_method TEXT,           -- 'exact', 'fuzzy', 'manual'
    match_confidence REAL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(person_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_provider_mapping_person ON provider_mapping(person_id);

-- ============================================================================
-- FULL-TEXT SEARCH
-- ============================================================================

-- FTS5 virtual table for fast text search
-- Note: We store content directly (not external content mode) for simplicity
CREATE VIRTUAL TABLE IF NOT EXISTS person_fts USING fts5(
    person_id UNINDEXED,
    display_name,
    birth_name,
    aliases,
    bio,
    occupations
);

-- ============================================================================
-- MIGRATION TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS migration (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update timestamp on person modification
CREATE TRIGGER IF NOT EXISTS update_person_timestamp
AFTER UPDATE ON person
BEGIN
    UPDATE person SET updated_at = datetime('now') WHERE person_id = NEW.person_id;
END;

-- Update database timestamp on membership change
CREATE TRIGGER IF NOT EXISTS update_database_timestamp
AFTER INSERT ON database_membership
BEGIN
    UPDATE database_info SET updated_at = datetime('now') WHERE db_id = NEW.db_id;
END;
