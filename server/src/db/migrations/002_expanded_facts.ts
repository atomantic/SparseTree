/**
 * Expanded facts migration
 * Adds tables for comprehensive life events, notes, source citations,
 * and local overrides for bidirectional sync with genealogy providers.
 */

import { sqliteService } from '../sqlite.service.js';

export const name = '002_expanded_facts';

export function up(): void {
  // ============================================================================
  // LIFE EVENTS - Flexible event storage for all GEDCOM-X and provider fact types
  // ============================================================================
  // Supports: Birth, Death, Burial, Christening, Baptism, Marriage, Divorce,
  // Occupation, Residence, MilitaryService, Religion, Ethnicity, Immigration,
  // Emigration, Naturalization, Education, Retirement, Will, Probate,
  // Census, TitleOfNobility, and custom types
  sqliteService.run(`
    CREATE TABLE IF NOT EXISTS life_event (
      event_id TEXT PRIMARY KEY,           -- ULID
      person_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,            -- GEDCOM-X URI or custom type
      event_role TEXT DEFAULT 'principal', -- principal, witness, officiant, etc.

      -- Temporal data
      date_original TEXT,                  -- Original text (e.g., "abt 1523", "12 Mar 1847")
      date_formal TEXT,                    -- GEDCOM-X formal date (+1523, -0500 for 500 BC)
      date_year INTEGER,                   -- Extracted year for range queries
      date_month INTEGER,
      date_day INTEGER,
      date_end_year INTEGER,               -- For date ranges

      -- Location data
      place_original TEXT,                 -- Original place text
      place_normalized TEXT,               -- Standardized place name
      place_id TEXT,                       -- FamilySearch/GeoNames place ID

      -- Event details
      value TEXT,                          -- Primary value (e.g., occupation name, title)
      description TEXT,                    -- Extended description/notes
      cause TEXT,                          -- For death events

      -- Provenance
      source TEXT NOT NULL,                -- Provider: 'familysearch', 'ancestry', 'local'
      source_id TEXT,                      -- Provider's fact ID
      confidence REAL DEFAULT 1.0,

      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_life_event_person ON life_event(person_id)');
  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_life_event_type ON life_event(event_type)');
  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_life_event_year ON life_event(date_year)');
  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_life_event_place ON life_event(place_normalized)');
  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_life_event_source ON life_event(source)');
  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_life_event_source_id ON life_event(source, source_id)');

  // ============================================================================
  // NOTES - For LifeSketch, stories, research notes, and other text content
  // ============================================================================
  sqliteService.run(`
    CREATE TABLE IF NOT EXISTS note (
      note_id TEXT PRIMARY KEY,            -- ULID
      person_id TEXT NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
      note_type TEXT NOT NULL,             -- 'life_sketch', 'research', 'story', 'memorial', 'custom'
      title TEXT,
      content TEXT NOT NULL,
      content_type TEXT DEFAULT 'text',    -- 'text', 'markdown', 'html'
      language TEXT DEFAULT 'en',

      -- Provenance
      source TEXT NOT NULL,                -- 'familysearch', 'local', 'ai_generated'
      source_id TEXT,                      -- Provider's note/memory ID
      author TEXT,

      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_note_person ON note(person_id)');
  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_note_type ON note(note_type)');
  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_note_source ON note(source)');

  // ============================================================================
  // SOURCE CITATIONS - Track where facts came from for provenance
  // ============================================================================
  sqliteService.run(`
    CREATE TABLE IF NOT EXISTS source_citation (
      citation_id TEXT PRIMARY KEY,        -- ULID

      -- What this citation supports
      entity_type TEXT NOT NULL,           -- 'life_event', 'note', 'person', 'relationship'
      entity_id TEXT NOT NULL,             -- ID of the entity being cited

      -- Citation details
      source_type TEXT,                    -- 'record', 'document', 'book', 'website', 'oral'
      title TEXT,
      author TEXT,
      publisher TEXT,
      publication_date TEXT,
      url TEXT,
      repository TEXT,
      call_number TEXT,
      page TEXT,

      -- Provider reference
      provider TEXT,                       -- 'familysearch', 'ancestry', etc.
      provider_source_id TEXT,             -- Provider's source ID

      notes TEXT,
      confidence REAL DEFAULT 1.0,

      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_source_citation_entity ON source_citation(entity_type, entity_id)');
  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_source_citation_provider ON source_citation(provider, provider_source_id)');

  // ============================================================================
  // LOCAL OVERRIDES - User edits that survive re-sync from providers
  // ============================================================================
  // This implements the three-layer data model:
  // 1. Raw provider data (JSON cache files)
  // 2. Provider data in SQLite (life_event, person, etc.)
  // 3. Local overrides (this table) - takes precedence in UI
  sqliteService.run(`
    CREATE TABLE IF NOT EXISTS local_override (
      override_id TEXT PRIMARY KEY,        -- ULID

      -- What is being overridden
      entity_type TEXT NOT NULL,           -- 'person', 'life_event', 'relationship', 'note'
      entity_id TEXT NOT NULL,             -- ID of the entity being overridden
      field_name TEXT NOT NULL,            -- Which field is overridden

      -- Override values
      original_value TEXT,                 -- What the provider had (for diff/revert)
      override_value TEXT,                 -- User's value

      -- Metadata
      reason TEXT,                         -- Why the user made this change
      source TEXT DEFAULT 'local',         -- 'local', 'research', 'family_knowledge'

      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),

      UNIQUE(entity_type, entity_id, field_name)
    )
  `);

  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_local_override_entity ON local_override(entity_type, entity_id)');

  // ============================================================================
  // SYNC LOG - Track when entities were last synced from providers
  // ============================================================================
  sqliteService.run(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,           -- 'person', 'database'
      entity_id TEXT NOT NULL,
      provider TEXT NOT NULL,              -- 'familysearch', 'ancestry'
      sync_type TEXT NOT NULL,             -- 'full', 'incremental', 'manual'
      status TEXT NOT NULL,                -- 'success', 'partial', 'failed'
      records_added INTEGER DEFAULT 0,
      records_updated INTEGER DEFAULT 0,
      records_unchanged INTEGER DEFAULT 0,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync_log(entity_type, entity_id)');
  sqliteService.run('CREATE INDEX IF NOT EXISTS idx_sync_log_provider ON sync_log(provider)');

  // ============================================================================
  // COMPUTED FIELDS VIEW - Age at death, marriage, etc. for AI search
  // ============================================================================
  sqliteService.run(`
    CREATE VIEW IF NOT EXISTS person_computed AS
    SELECT
      p.person_id,
      p.display_name,
      p.gender,

      -- Birth info
      birth.date_year AS birth_year,
      birth.place_original AS birth_place,

      -- Death info
      death.date_year AS death_year,
      death.place_original AS death_place,
      death.cause AS death_cause,

      -- Computed age at death
      CASE
        WHEN birth.date_year IS NOT NULL AND death.date_year IS NOT NULL
        THEN death.date_year - birth.date_year
        ELSE NULL
      END AS age_at_death,

      -- Count of children
      (SELECT COUNT(*) FROM parent_edge WHERE parent_id = p.person_id) AS child_count,

      -- First marriage year
      (SELECT MIN(date_year) FROM life_event
       WHERE person_id = p.person_id AND event_type = 'http://gedcomx.org/Marriage') AS first_marriage_year,

      -- Age at first marriage
      CASE
        WHEN birth.date_year IS NOT NULL AND
             (SELECT MIN(date_year) FROM life_event
              WHERE person_id = p.person_id AND event_type = 'http://gedcomx.org/Marriage') IS NOT NULL
        THEN (SELECT MIN(date_year) FROM life_event
              WHERE person_id = p.person_id AND event_type = 'http://gedcomx.org/Marriage') - birth.date_year
        ELSE NULL
      END AS age_at_first_marriage,

      -- Title of nobility
      (SELECT value FROM life_event
       WHERE person_id = p.person_id AND event_type = 'data:,TitleOfNobility'
       LIMIT 1) AS title_of_nobility,

      -- Primary occupation
      (SELECT value FROM life_event
       WHERE person_id = p.person_id AND event_type = 'http://gedcomx.org/Occupation'
       LIMIT 1) AS primary_occupation,

      -- Military service
      (SELECT value FROM life_event
       WHERE person_id = p.person_id AND event_type = 'http://gedcomx.org/MilitaryService'
       LIMIT 1) AS military_service,

      -- Has life sketch
      (SELECT 1 FROM note WHERE person_id = p.person_id AND note_type = 'life_sketch' LIMIT 1) AS has_life_sketch

    FROM person p
    LEFT JOIN life_event birth ON birth.person_id = p.person_id
      AND birth.event_type = 'http://gedcomx.org/Birth'
    LEFT JOIN life_event death ON death.person_id = p.person_id
      AND death.event_type = 'http://gedcomx.org/Death'
  `);

  console.log('[Migration 002] Expanded facts tables created');
}

export function down(): void {
  // Drop in reverse order
  sqliteService.run('DROP VIEW IF EXISTS person_computed');
  sqliteService.run('DROP TABLE IF EXISTS sync_log');
  sqliteService.run('DROP TABLE IF EXISTS local_override');
  sqliteService.run('DROP TABLE IF EXISTS source_citation');
  sqliteService.run('DROP TABLE IF EXISTS note');
  sqliteService.run('DROP TABLE IF EXISTS life_event');

  console.log('[Migration 002] Expanded facts tables dropped');
}
