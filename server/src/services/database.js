/**
 * Database Service
 * Handles SQLite database initialization and schema management
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const SCHEMA_VERSION = 1;

/**
 * Initialize the SQLite database with schema
 */
export function initializeDatabase(dataRoot) {
  const dbPath = path.join(dataRoot, 'writers-guild.db');

  // Ensure data directory exists
  if (!fs.existsSync(dataRoot)) {
    fs.mkdirSync(dataRoot, { recursive: true });
  }

  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');

  // Create schema
  createSchema(db);

  return db;
}

/**
 * Create database schema
 */
function createSchema(db) {
  // Check current schema version
  const versionRow = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'
  `).get();

  if (!versionRow) {
    // Fresh database - create all tables
    createAllTables(db);
  } else {
    // Check if migration needed
    const currentVersion = db.prepare('SELECT version FROM schema_version').get();
    if (currentVersion && currentVersion.version < SCHEMA_VERSION) {
      migrateSchema(db, currentVersion.version);
    }
  }
}

/**
 * Create all database tables
 */
function createAllTables(db) {
  db.exec(`
    -- Schema version tracking
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
    INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION});

    -- Settings table (single row)
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      show_reasoning INTEGER DEFAULT 1,
      auto_save INTEGER DEFAULT 1,
      show_prompt INTEGER DEFAULT 1,
      third_person INTEGER DEFAULT 1,
      filter_asterisks INTEGER DEFAULT 1,
      include_dialogue_examples INTEGER DEFAULT 0,
      lorebook_scan_depth INTEGER DEFAULT 2000,
      lorebook_token_budget INTEGER DEFAULT 1800,
      lorebook_recursion_depth INTEGER DEFAULT 3,
      lorebook_enable_recursion INTEGER DEFAULT 1,
      default_persona_id TEXT,
      default_preset_id TEXT
    );

    -- Insert default settings
    INSERT OR IGNORE INTO settings (id) VALUES (1);

    -- Stories table
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      content TEXT DEFAULT '',
      persona_character_id TEXT,
      config_preset_id TEXT,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );

    -- Characters table (V2 card format stored as JSON)
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      image BLOB,
      thumbnail BLOB,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );

    -- Create index for character name lookups
    CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(name);

    -- Lorebooks table
    CREATE TABLE IF NOT EXISTS lorebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      scan_depth INTEGER,
      token_budget INTEGER,
      recursive_scanning INTEGER DEFAULT 0,
      extensions TEXT DEFAULT '{}',
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );

    -- Lorebook entries table
    CREATE TABLE IF NOT EXISTS lorebook_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lorebook_id TEXT NOT NULL,
      keys TEXT NOT NULL DEFAULT '[]',
      secondary_keys TEXT NOT NULL DEFAULT '[]',
      content TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      constant INTEGER DEFAULT 0,
      selective INTEGER DEFAULT 0,
      selective_logic INTEGER DEFAULT 0,
      insertion_order INTEGER DEFAULT 0,
      position INTEGER DEFAULT 0,
      case_sensitive INTEGER DEFAULT 0,
      match_whole_words INTEGER DEFAULT 0,
      use_regex INTEGER DEFAULT 0,
      probability INTEGER DEFAULT 100,
      use_probability INTEGER DEFAULT 0,
      depth INTEGER DEFAULT 0,
      scan_depth INTEGER,
      entry_group TEXT DEFAULT '',
      prevent_recursion INTEGER DEFAULT 0,
      delay_until_recursion INTEGER DEFAULT 0,
      display_index INTEGER DEFAULT 0,
      extensions TEXT DEFAULT '{}',
      FOREIGN KEY (lorebook_id) REFERENCES lorebooks(id) ON DELETE CASCADE
    );

    -- Create index for lorebook entry lookups
    CREATE INDEX IF NOT EXISTS idx_lorebook_entries_lorebook ON lorebook_entries(lorebook_id);

    -- Configuration presets table
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT DEFAULT 'deepseek',
      api_config TEXT NOT NULL DEFAULT '{}',
      generation_settings TEXT NOT NULL DEFAULT '{}',
      lorebook_settings TEXT NOT NULL DEFAULT '{}',
      prompt_templates TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER DEFAULT 0
    );

    -- Story-Character junction table (many-to-many)
    CREATE TABLE IF NOT EXISTS story_characters (
      story_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      PRIMARY KEY (story_id, character_id),
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    -- Story-Lorebook junction table (many-to-many)
    CREATE TABLE IF NOT EXISTS story_lorebooks (
      story_id TEXT NOT NULL,
      lorebook_id TEXT NOT NULL,
      PRIMARY KEY (story_id, lorebook_id),
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
      FOREIGN KEY (lorebook_id) REFERENCES lorebooks(id) ON DELETE CASCADE
    );

    -- Character-Lorebook relationship (one-to-one optional)
    -- Stored in characters.data JSON as extensions.ursceal_lorebook_id
  `);

  console.log('Database schema created successfully');
}

/**
 * Migrate schema to latest version
 */
function migrateSchema(db, fromVersion) {
  console.log(`Migrating database from version ${fromVersion} to ${SCHEMA_VERSION}`);

  // Future migrations would go here
  // if (fromVersion < 2) { ... }

  db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
}

export { SCHEMA_VERSION };
